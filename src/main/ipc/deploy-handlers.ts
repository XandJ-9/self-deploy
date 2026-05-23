import { ipcMain, webContents } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc-channels';
import type {
  ChangedFile,
  DeploymentDetail,
  DeploymentFileRecord,
  DeploymentRecord,
  DeploySource,
  FileAction,
  FileDeployStatus,
} from '../../shared/types';
import { getDb } from '../db/database';
import { runDeploy, runRollback, type DeployLogEvent } from '../deploy/deploy-service';
import { loadIgnoreFilter } from '../deploy/ignore';
import { scanFolder } from '../deploy/folder-scan';

const GitSourceSchema = z.object({
  type: z.literal('git'),
  fromCommit: z.string().nullable(),
  toCommit: z.string().min(1),
});

const FolderSourceSchema = z.object({
  type: z.literal('folder'),
  sourceDir: z.string().default(''),
});

const SourceSchema = z.discriminatedUnion('type', [GitSourceSchema, FolderSourceSchema]);

const RunSchema = z
  .object({
    projectId: z.number().int().positive(),
    serverId: z.number().int().positive(),
    source: SourceSchema.optional(),
    // 旧入参兼容（git 模式直传 fromCommit/toCommit）
    fromCommit: z.string().nullable().optional(),
    toCommit: z.string().optional(),
  })
  .transform((v) => {
    if (v.source) {
      return { projectId: v.projectId, serverId: v.serverId, source: v.source };
    }
    if (typeof v.toCommit === 'string' && v.toCommit.length > 0) {
      const src: DeploySource = {
        type: 'git',
        fromCommit: v.fromCommit ?? null,
        toCommit: v.toCommit,
      };
      return { projectId: v.projectId, serverId: v.serverId, source: src };
    }
    throw new Error('缺少 source 或 toCommit');
  });

const ScanFolderSchema = z.object({
  projectId: z.number().int().positive(),
  sourceDir: z.string().default(''),
});

const HistoryQuerySchema = z
  .object({
    projectId: z.number().int().positive().optional(),
    serverId: z.number().int().positive().optional(),
    status: z.enum(['pending', 'running', 'success', 'failed', 'rolledback']).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .optional();

const IdSchema = z.number().int().positive();

interface DeploymentRow {
  id: number;
  project_id: number;
  server_id: number;
  from_commit: string | null;
  to_commit: string;
  file_count: number;
  status: DeploymentRecord['status'];
  log_path: string | null;
  started_at: string;
  finished_at: string | null;
}

interface DeploymentFileRow {
  path: string;
  action: FileAction;
  status: FileDeployStatus;
  size: number | null;
}

function rowToRecord(r: DeploymentRow): DeploymentRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    serverId: r.server_id,
    fromCommit: r.from_commit,
    toCommit: r.to_commit,
    fileCount: r.file_count,
    status: r.status,
    logPath: r.log_path,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function broadcast(evt: DeployLogEvent): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.send(IPC.Deploy.OnLog, evt);
  }
}

export function registerDeployHandlers(): void {
  ipcMain.handle(IPC.Deploy.Preview, async () => {
    return { ok: false, message: '请使用 git:diff 预览变更' };
  });

  ipcMain.handle(IPC.Deploy.ScanFolder, (_e, raw: unknown): ChangedFile[] => {
    const input = ScanFolderSchema.parse(raw);
    const row = getDb()
      .prepare('SELECT local_path, exclude_patterns FROM projects WHERE id = ?')
      .get(input.projectId) as { local_path: string; exclude_patterns: string } | undefined;
    if (!row) throw new Error(`项目不存在: ${input.projectId}`);
    const excludes = JSON.parse(row.exclude_patterns) as string[];
    const filter = loadIgnoreFilter(row.local_path, excludes);
    const result = scanFolder(row.local_path, input.sourceDir, filter);
    return result.files;
  });

  ipcMain.handle(IPC.Deploy.Run, async (_e, raw: unknown) => {
    const input = RunSchema.parse(raw);
    return runDeploy(input, broadcast);
  });

  ipcMain.handle(IPC.Deploy.History, (_e, raw?: unknown): DeploymentRecord[] => {
    // 兼容旧调用：直接传 projectId 数字
    let filter: z.infer<typeof HistoryQuerySchema> = undefined;
    if (typeof raw === 'number') {
      filter = { projectId: raw };
    } else if (raw && typeof raw === 'object') {
      filter = HistoryQuerySchema.parse(raw);
    }

    const conditions: string[] = [];
    const args: (string | number)[] = [];
    if (filter?.projectId) {
      conditions.push('project_id = ?');
      args.push(filter.projectId);
    }
    if (filter?.serverId) {
      conditions.push('server_id = ?');
      args.push(filter.serverId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      args.push(filter.status);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = filter?.limit ?? 100;
    const sql = `SELECT * FROM deployments ${where} ORDER BY id DESC LIMIT ${limit}`;
    const rows = getDb().prepare(sql).all(...args) as DeploymentRow[];
    return rows.map(rowToRecord);
  });

  ipcMain.handle(IPC.Deploy.Detail, (_e, raw: unknown): DeploymentDetail => {
    const id = IdSchema.parse(raw);
    const row = getDb().prepare('SELECT * FROM deployments WHERE id = ?').get(id) as
      | DeploymentRow
      | undefined;
    if (!row) throw new Error(`部署记录不存在: #${id}`);
    const fileRows = getDb()
      .prepare(
        'SELECT path, action, status, size FROM deployment_files WHERE deployment_id = ? ORDER BY path',
      )
      .all(id) as DeploymentFileRow[];
    const files: DeploymentFileRecord[] = fileRows.map((f) => ({
      path: f.path,
      action: f.action,
      status: f.status,
      size: f.size,
    }));
    return { record: rowToRecord(row), files };
  });

  ipcMain.handle(IPC.Deploy.Rollback, async (_e, raw: unknown) => {
    const id = IdSchema.parse(raw);
    return runRollback(id, broadcast);
  });

  ipcMain.handle(IPC.Deploy.Log, async (_e, raw: unknown): Promise<{ path: string | null; content: string }> => {
    const id = IdSchema.parse(raw);
    const row = getDb().prepare('SELECT log_path FROM deployments WHERE id = ?').get(id) as
      | { log_path: string | null }
      | undefined;
    if (!row) throw new Error(`部署记录不存在: #${id}`);
    const p = row.log_path;
    if (!p) return { path: null, content: '' };
    try {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(p, 'utf8');
      return { path: p, content };
    } catch (err) {
      return { path: p, content: `（无法读取日志文件：${(err as Error).message}）` };
    }
  });
}
