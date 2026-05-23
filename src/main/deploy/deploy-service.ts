/**
 * 部署引擎 — 增量发布、临时目录 + rename 原子切换、失败回滚清理。
 *
 * 流程：
 *   1. 读取项目 / 服务器 / 凭据
 *   2. simple-git 计算 from..to 的变更清单
 *   3. 创建 deployments 行（status=running）+ deployment_files 行
 *   4. 打开 Transport，上传 ADD/MODIFY/RENAME(new) 到 <remoteBase>/.deploy-tmp-<depId>/
 *   5. 全部上传成功后，逐个 rename 覆盖到目标位置（rename 前先删除目标，避免协议差异）
 *   6. 处理 DELETE 与 RENAME(oldPath) 的远端删除
 *   7. 清理 tmp 目录；更新 deployments 行
 *   8. 失败：清理 tmp，把 deployment 标记 failed
 *
 * 日志通过 onLog 回调向外推送（IPC handler 负责转发到渲染端）。
 */
import simpleGit from 'simple-git';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type { ChangedFile, FileAction, ServerRecord, ProjectRecord, DeployStatus } from '../../shared/types';
import { getDb } from '../db/database';
import { readCredential } from '../security/credential-vault';
import { loadIgnoreFilter } from './ignore';
import { TransportPool } from './transport-pool';

/** 并发上传连接数；后续可改为读取配置。 */
const UPLOAD_CONCURRENCY = 4;

function openDeployLog(deploymentId: number): { filePath: string; append: (e: DeployLogEvent) => void; close: () => void } {
  const dir = path.join(app.getPath('userData'), 'deploy-logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${deploymentId}.log`);
  const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
  return {
    filePath,
    append(e: DeployLogEvent): void {
      const prog = e.progress ? ` [${e.progress.done}/${e.progress.total}]` : '';
      stream.write(`[${e.timestamp}] ${e.level.toUpperCase()}${prog} ${e.message}\n`);
    },
    close(): void {
      stream.end();
    },
  };
}

export interface DeployRunParams {
  projectId: number;
  serverId: number;
  fromCommit: string | null;
  toCommit: string;
}

export type DeployLogLevel = 'info' | 'warn' | 'error';

export interface DeployLogEvent {
  deploymentId: number;
  level: DeployLogLevel;
  message: string;
  /** 文件级进度（可选） */
  progress?: { done: number; total: number };
  timestamp: string;
}

export interface DeployResult {
  deploymentId: number;
  status: DeployStatus;
  fileCount: number;
  message?: string;
}

type LogSink = (e: DeployLogEvent) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function joinPosix(...parts: string[]): string {
  return path.posix.join(...parts.map((p) => p.replace(/\\/g, '/')));
}

/** 执行本地 shell 命令；按行回调 onLine。返回 exit code（null 视为 -1）。 */
function runShell(
  cmd: string,
  cwd: string,
  onLine: (line: string, channel: 'stdout' | 'stderr') => void,
): Promise<number> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd, windowsHide: true })
      : spawn('sh', ['-c', cmd], { cwd });
    const buf: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    const pipe = (key: 'stdout' | 'stderr', data: Buffer): void => {
      buf[key] += data.toString('utf8');
      let idx: number;
      while ((idx = buf[key].indexOf('\n')) >= 0) {
        const line = buf[key].slice(0, idx).replace(/\r$/, '');
        buf[key] = buf[key].slice(idx + 1);
        if (line.length > 0) onLine(line, key);
      }
    };
    child.stdout.on('data', (d) => pipe('stdout', d));
    child.stderr.on('data', (d) => pipe('stderr', d));
    child.on('error', (err) => {
      onLine(`spawn 失败：${err.message}`, 'stderr');
      resolve(-1);
    });
    child.on('close', (code) => {
      for (const k of ['stdout', 'stderr'] as const) {
        if (buf[k].length > 0) onLine(buf[k], k);
      }
      resolve(code ?? -1);
    });
  });
}

function loadServer(id: number): ServerRecord {
  const row = getDb()
    .prepare('SELECT * FROM servers WHERE id = ?')
    .get(id) as
    | {
        id: number;
        name: string;
        protocol: 'sftp' | 'ftp';
        host: string;
        port: number;
        username: string;
        auth_type: 'password' | 'privateKey';
        credential_ref: string;
        remote_base_path: string;
        created_at: string;
      }
    | undefined;
  if (!row) throw new Error(`服务器不存在: ${id}`);
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    credentialRef: row.credential_ref,
    remoteBasePath: row.remote_base_path,
    createdAt: row.created_at,
  };
}

function loadProject(id: number): ProjectRecord {
  const row = getDb()
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as
    | {
        id: number;
        name: string;
        local_path: string;
        default_server_id: number | null;
        remote_path: string;
        exclude_patterns: string;
        pre_deploy_cmd: string | null;
        post_deploy_cmd: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) throw new Error(`项目不存在: ${id}`);
  return {
    id: row.id,
    name: row.name,
    localPath: row.local_path,
    defaultServerId: row.default_server_id,
    remotePath: row.remote_path,
    excludePatterns: JSON.parse(row.exclude_patterns) as string[],
    preDeployCmd: row.pre_deploy_cmd,
    postDeployCmd: row.post_deploy_cmd,
    createdAt: row.created_at,
  };
}

function mapStatus(s: string): FileAction {
  if (s.startsWith('A')) return 'ADD';
  if (s.startsWith('D')) return 'DELETE';
  if (s.startsWith('R')) return 'RENAME';
  return 'MODIFY';
}

async function diffFiles(repoPath: string, from: string | null, to: string): Promise<ChangedFile[]> {
  const git = simpleGit({ baseDir: repoPath });
  if (!from) {
    const raw = await git.raw(['ls-tree', '-r', '--name-only', to]);
    return raw
      .split('\n')
      .filter(Boolean)
      .map((p) => ({ path: p, action: 'ADD' as FileAction }));
  }
  const raw = await git.raw(['diff', '--name-status', `${from}..${to}`]);
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line): ChangedFile => {
      const parts = line.split('\t');
      const status = parts[0];
      if (status.startsWith('R') && parts.length >= 3) {
        return { path: parts[2], oldPath: parts[1], action: 'RENAME' };
      }
      return { path: parts[1] ?? '', action: mapStatus(status) };
    });
}

/**
 * 将仓库内某个文件在指定 commit 的内容写入临时本地文件，返回本地路径。
 * 适用于工作区已 checkout 到其它分支、或文件已被删除的场景。
 */
async function checkoutBlob(repoPath: string, commit: string, relPath: string): Promise<string> {
  const git = simpleGit({ baseDir: repoPath });
  const content = await git.raw(['show', `${commit}:${relPath}`]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfdeploy-blob-'));
  const localPath = path.join(tmpDir, path.basename(relPath));
  fs.writeFileSync(localPath, content);
  return localPath;
}

function emit(sink: LogSink, deploymentId: number, level: DeployLogLevel, message: string, progress?: DeployLogEvent['progress']): void {
  sink({ deploymentId, level, message, progress, timestamp: nowIso() });
}

export async function runDeploy(params: DeployRunParams, onLog: LogSink): Promise<DeployResult> {
  const project = loadProject(params.projectId);
  const server = loadServer(params.serverId);

  const changes = await diffFiles(project.localPath, params.fromCommit, params.toCommit);
  return executeDeployment({
    project,
    server,
    fromCommit: params.fromCommit,
    toCommit: params.toCommit,
    sourceCommit: params.toCommit,
    changes,
    mode: 'deploy',
    onLog,
  });
}

/**
 * 回滚指定 deployment：把远端状态恢复到该 deployment 执行前。
 *
 * 实现原理：反向 diff（toCommit → fromCommit），复用 executeDeployment。
 * 文件内容来自原 deployment 的 fromCommit，自然抵消原 deployment 的所有改动。
 * 新生成的 deployment 行状态为 'rolledback'，方便历史区分。
 */
export async function runRollback(originDeploymentId: number, onLog: LogSink): Promise<DeployResult> {
  const origin = getDb()
    .prepare('SELECT * FROM deployments WHERE id = ?')
    .get(originDeploymentId) as
    | {
        id: number;
        project_id: number;
        server_id: number;
        from_commit: string | null;
        to_commit: string;
        status: DeployStatus;
      }
    | undefined;
  if (!origin) throw new Error(`部署记录不存在: #${originDeploymentId}`);
  if (origin.status !== 'success') {
    throw new Error(`仅成功状态的部署可回滚，当前状态：${origin.status}`);
  }
  if (!origin.from_commit) {
    throw new Error('该部署是首次部署（无 fromCommit），无法回滚到上一状态');
  }

  const project = loadProject(origin.project_id);
  const server = loadServer(origin.server_id);

  // 反向 diff：把 toCommit 上的内容回退到 fromCommit
  const changes = await diffFiles(project.localPath, origin.to_commit, origin.from_commit);
  return executeDeployment({
    project,
    server,
    fromCommit: origin.to_commit,
    toCommit: origin.from_commit,
    sourceCommit: origin.from_commit,
    changes,
    mode: 'rollback',
    originDeploymentId,
    onLog,
  });
}

interface ExecuteDeploymentParams {
  project: ProjectRecord;
  server: ServerRecord;
  /** 写入 deployments 行的 from_commit */
  fromCommit: string | null;
  /** 写入 deployments 行的 to_commit */
  toCommit: string;
  /** 上传内容来自的 commit（rollback 时与 toCommit 相同；正常部署时也相同） */
  sourceCommit: string;
  changes: ChangedFile[];
  mode: 'deploy' | 'rollback';
  /** 仅 rollback：被回滚的原 deployment id，用于日志 */
  originDeploymentId?: number;
  onLog: LogSink;
}

async function executeDeployment(p: ExecuteDeploymentParams): Promise<DeployResult> {
  const { project, server, fromCommit, toCommit, sourceCommit, changes, mode } = p;

  // 应用 .deployignore + excludePatterns 过滤
  const filter = loadIgnoreFilter(project.localPath, project.excludePatterns);
  const kept: ChangedFile[] = [];
  const skipped: ChangedFile[] = [];
  for (const c of changes) {
    // DELETE 项也按 path 过滤；RENAME 旧路径用 oldPath 判断是否忽略
    const shouldSkip =
      filter.ignores(c.path) || (c.action === 'RENAME' && c.oldPath ? filter.ignores(c.oldPath) : false);
    if (shouldSkip) skipped.push(c);
    else kept.push(c);
  }

  const fileCount = kept.length;
  const successStatus: DeployStatus = mode === 'rollback' ? 'rolledback' : 'success';
  const actionWord = mode === 'rollback' ? '回滚' : '部署';

  // 1) 创建 deployment 行
  const insertDep = getDb()
    .prepare(
      `INSERT INTO deployments(project_id, server_id, from_commit, to_commit, file_count, status)
       VALUES (?, ?, ?, ?, ?, 'running')`,
    )
    .run(project.id, server.id, fromCommit, toCommit, fileCount);
  const deploymentId = Number(insertDep.lastInsertRowid);

  // 1.5) 打开日志文件，并把 onLog 包装为双写
  const logFile = openDeployLog(deploymentId);
  const onLog: LogSink = (e) => {
    logFile.append(e);
    p.onLog(e);
  };

  // 2) deployment_files：kept=pending、skipped=skipped
  const insertFile = getDb().prepare(
    `INSERT INTO deployment_files(deployment_id, path, action, status) VALUES (?, ?, ?, ?)`,
  );
  const txn = getDb().transaction((keepRows: ChangedFile[], skipRows: ChangedFile[]) => {
    for (const c of keepRows) insertFile.run(deploymentId, c.path, c.action, 'pending');
    for (const c of skipRows) insertFile.run(deploymentId, c.path, c.action, 'skipped');
  });
  txn(kept, skipped);

  if (mode === 'rollback' && p.originDeploymentId) {
    emit(onLog, deploymentId, 'info', `回滚 #${p.originDeploymentId} → 新建 ${actionWord} #${deploymentId}，反向变更 ${fileCount} 个`);
  } else {
    emit(onLog, deploymentId, 'info', `开始${actionWord} #${deploymentId}，变更文件 ${fileCount} 个`);
  }
  if (skipped.length > 0) {
    emit(onLog, deploymentId, 'info', `命中忽略规则：跳过 ${skipped.length} 个文件（.deployignore + excludePatterns，共 ${filter.ruleCount} 条规则）`);
  }

  if (fileCount === 0) {
    getDb()
      .prepare(`UPDATE deployments SET status=?, log_path=?, finished_at=? WHERE id = ?`)
      .run(successStatus, logFile.filePath, nowIso(), deploymentId);
    emit(onLog, deploymentId, 'info', `无变更，${actionWord}完成`);
    logFile.close();
    return { deploymentId, status: successStatus, fileCount: 0 };
  }

  const updateFileStatus = getDb().prepare(
    `UPDATE deployment_files SET status = ? WHERE deployment_id = ? AND path = ?`,
  );

  const secret = readCredential(server.credentialRef);
  let pool: TransportPool | null = null;
  const tmpRoot = joinPosix(server.remoteBasePath || '/', `.deploy-tmp-${deploymentId}`);

  const toUpload = kept.filter((c) => c.action !== 'DELETE');
  const toDelete: { path: string }[] = kept
    .filter((c) => c.action === 'DELETE')
    .map((c) => ({ path: c.path }))
    .concat(
      kept
        .filter((c) => c.action === 'RENAME' && c.oldPath)
        .map((c) => ({ path: c.oldPath as string })),
    );

  try {
    // 0) 部署前 Hook：本地 shell，失败即中断
    const preCmd = project.preDeployCmd?.trim();
    if (preCmd) {
      emit(onLog, deploymentId, 'info', `执行部署前命令：${preCmd}`);
      const code = await runShell(preCmd, project.localPath, (line, ch) => {
        emit(onLog, deploymentId, ch === 'stderr' ? 'warn' : 'info', `[pre] ${line}`);
      });
      if (code !== 0) {
        throw new Error(`部署前命令非零退出（${code}）`);
      }
      emit(onLog, deploymentId, 'info', `部署前命令完成`);
    }

    const poolSize = Math.min(UPLOAD_CONCURRENCY, Math.max(1, toUpload.length));
    emit(onLog, deploymentId, 'info', `连接 ${server.protocol.toUpperCase()} ${server.host}:${server.port}（并发 ${poolSize}）`);
    pool = await TransportPool.create(server, secret, poolSize);
    const primary = pool.primary();
    const deployRoot = joinPosix(server.remoteBasePath || '/', project.remotePath || '/');
    emit(onLog, deploymentId, 'info', `${actionWord}目标根路径 ${deployRoot}（= remoteBasePath + project.remotePath）`);
    emit(onLog, deploymentId, 'info', `创建临时目录 ${tmpRoot}`);
    await primary.mkdirp(tmpRoot);

    // 3) 上传到临时目录（并发，每条连接处理多个文件）
    let done = 0;
    await pool.runAll(toUpload, async (c, t) => {
      const localAbs = path.join(project.localPath, c.path);
      let srcPath = localAbs;
      let cleanupTmpLocal = false;
      // rollback 模式：工作区文件未必匹配 sourceCommit；直接从 git 取，避免误用工作区
      if (mode === 'rollback' || !fs.existsSync(localAbs)) {
        srcPath = await checkoutBlob(project.localPath, sourceCommit, c.path);
        cleanupTmpLocal = true;
      }
      const tmpRemote = joinPosix(tmpRoot, c.path);
      try {
        await t.put(srcPath, tmpRemote);
        done += 1;
        emit(onLog, deploymentId, 'info', `上传 ${c.path}`, { done, total: toUpload.length });
      } finally {
        if (cleanupTmpLocal) {
          try {
            fs.rmSync(path.dirname(srcPath), { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    });

    // 4) 原子切换（串行，避免远端目录竞争）
    emit(onLog, deploymentId, 'info', '上传完成，开始切换到目标路径');
    for (const c of toUpload) {
      const tmpRemote = joinPosix(tmpRoot, c.path);
      const target = joinPosix(server.remoteBasePath || '/', project.remotePath || '/', c.path);
      await primary.mkdirp(path.posix.dirname(target));
      await primary.remove(target);
      await primary.rename(tmpRemote, target);
      updateFileStatus.run('success', deploymentId, c.path);
    }

    // 5) 删除远端文件
    for (const d of toDelete) {
      const target = joinPosix(server.remoteBasePath || '/', project.remotePath || '/', d.path);
      emit(onLog, deploymentId, 'info', `删除远端 ${d.path}`);
      await primary.remove(target);
      updateFileStatus.run('success', deploymentId, d.path);
    }

    emit(onLog, deploymentId, 'info', `清理临时目录 ${tmpRoot}`);
    await primary.removeDir(tmpRoot);

    // 6) 部署后 Hook：失败仅告警，不影响成功状态
    const postCmd = project.postDeployCmd?.trim();
    if (postCmd) {
      emit(onLog, deploymentId, 'info', `执行部署后命令：${postCmd}`);
      const code = await runShell(postCmd, project.localPath, (line, ch) => {
        emit(onLog, deploymentId, ch === 'stderr' ? 'warn' : 'info', `[post] ${line}`);
      });
      if (code !== 0) {
        emit(onLog, deploymentId, 'warn', `部署后命令非零退出（${code}），不影响${actionWord}成功状态`);
      } else {
        emit(onLog, deploymentId, 'info', `部署后命令完成`);
      }
    }

    getDb()
      .prepare(`UPDATE deployments SET status=?, log_path=?, finished_at=? WHERE id = ?`)
      .run(successStatus, logFile.filePath, nowIso(), deploymentId);
    emit(onLog, deploymentId, 'info', `${actionWord} #${deploymentId} 成功`);
    return { deploymentId, status: successStatus, fileCount };
  } catch (err) {
    const message = (err as Error).message;
    emit(onLog, deploymentId, 'error', `${actionWord}失败：${message}`);
    if (pool) {
      try {
        await pool.primary().removeDir(tmpRoot);
        emit(onLog, deploymentId, 'info', `已清理临时目录 ${tmpRoot}`);
      } catch (cleanupErr) {
        emit(onLog, deploymentId, 'warn', `清理临时目录失败：${(cleanupErr as Error).message}`);
      }
    }
    getDb()
      .prepare(`UPDATE deployments SET status='failed', log_path=?, finished_at=? WHERE id = ?`)
      .run(logFile.filePath, nowIso(), deploymentId);
    return { deploymentId, status: 'failed', fileCount, message };
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch {
        /* ignore */
      }
    }
    logFile.close();
  }
}
