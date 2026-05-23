import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Table, Space, Button, Tag, App as AntdApp, Progress } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { ProjectRecord, GitCommit, ChangedFile, ServerRecord } from '@shared/types';
import PageHero from '../components/PageHero';

interface DeployLogEvent {
  deploymentId: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  progress?: { done: number; total: number };
  timestamp: string;
}

interface DeployResult {
  deploymentId: number;
  status: 'success' | 'failed' | 'running' | 'pending' | 'rolledback';
  fileCount: number;
  message?: string;
}

export default function DeployPage() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [serverId, setServerId] = useState<number | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [fromCommit, setFromCommit] = useState<string | null>(null);
  const [toCommit, setToCommit] = useState<string | null>(null);
  const [diff, setDiff] = useState<ChangedFile[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<DeployLogEvent[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.api
      .invoke<ProjectRecord[]>(window.api.channels.Project.List)
      .then(setProjects);
    void window.api
      .invoke<ServerRecord[]>(window.api.channels.Server.List)
      .then(setServers);
  }, []);

  // 订阅部署日志
  useEffect(() => {
    const off = window.api.on(window.api.channels.Deploy.OnLog, (...args: unknown[]) => {
      const evt = args[0] as DeployLogEvent;
      setLogs((prev) => [...prev, evt]);
      if (evt.progress) setProgress(evt.progress);
    });
    return off;
  }, []);

  // 日志滚动到底
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const server = useMemo(() => servers.find((s) => s.id === serverId), [servers, serverId]);

  /** 预览实际部署根路径：POSIX join(remoteBasePath, project.remotePath)。 */
  const deployRoot = useMemo(() => {
    if (!project || !server) return null;
    const base = (server.remoteBasePath || '/').replace(/\\/g, '/');
    const sub = (project.remotePath || '').replace(/\\/g, '/');
    const joined = (base + '/' + sub).replace(/\/+/g, '/');
    return joined === '' ? '/' : joined;
  }, [project, server]);

  // 项目变化时，自动选择默认服务器
  useEffect(() => {
    if (project?.defaultServerId) setServerId(project.defaultServerId);
  }, [project]);

  const loadCommits = async (path: string): Promise<void> => {
    try {
      const list = await window.api.invoke<GitCommit[]>(
        window.api.channels.Git.ListCommits,
        path,
        100,
      );
      setCommits(list);
    } catch (e) {
      message.error('读取 Git 提交失败：' + (e as Error).message);
      setCommits([]);
    }
  };

  useEffect(() => {
    if (project) void loadCommits(project.localPath);
  }, [project]);

  const computeDiff = async (): Promise<void> => {
    if (!project || !toCommit) return;
    const result = await window.api.invoke<ChangedFile[]>(
      window.api.channels.Git.Diff,
      project.localPath,
      fromCommit,
      toCommit,
    );
    setDiff(result);
  };

  const runDeploy = async (): Promise<void> => {
    if (!projectId || !serverId || !toCommit) {
      message.warning('请先选择项目、服务器与目标提交');
      return;
    }
    setRunning(true);
    setLogs([]);
    setProgress(null);
    try {
      const result = await window.api.invoke<DeployResult>(window.api.channels.Deploy.Run, {
        projectId,
        serverId,
        fromCommit,
        toCommit,
      });
      if (result.status === 'success') {
        message.success(`部署 #${result.deploymentId} 完成（${result.fileCount} 个文件）`);
      } else {
        message.error(`部署 #${result.deploymentId} 失败：${result.message ?? ''}`);
      }
    } catch (e) {
      message.error('部署调用失败：' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const canRun = !!projectId && !!serverId && !!toCommit && !running;

  return (
    <>
      <PageHero
        title="部署"
        description="选择项目 → 选择服务器 → 选择 Git 提交区间 → 预览变更 → 执行同步"
        actions={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={!canRun}
            loading={running}
            onClick={runDeploy}
          >
            执行部署
          </Button>
        }
      />

      <div className="step-grid">
        <section className="glass-card step">
          <div className="step-head">
            <span className="step-index">1</span>
            <div>
              <div className="step-title">项目与服务器</div>
              <div className="step-sub">绑定本地仓库与发布目标</div>
            </div>
          </div>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Select
              style={{ width: '100%' }}
              placeholder="选择项目"
              value={projectId ?? undefined}
              onChange={(v) => {
                setProjectId(v);
                setFromCommit(null);
                setToCommit(null);
                setDiff([]);
              }}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Select
              style={{ width: '100%' }}
              placeholder="选择目标服务器"
              value={serverId ?? undefined}
              onChange={(v) => setServerId(v)}
              options={servers.map((s) => ({
                value: s.id,
                label: `${s.name}  (${s.protocol}://${s.host}:${s.port})`,
              }))}
            />
            {deployRoot && (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.65)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6,
                  padding: '8px 10px',
                }}
              >
                实际部署到：<code style={{ color: '#7dd3fc' }}>{deployRoot}</code>
                <div style={{ opacity: 0.6, marginTop: 4 }}>
                  = 服务器 remoteBasePath（{server?.remoteBasePath || '/'}）+ 项目 remotePath（
                  {project?.remotePath || '空'}）。请确认该路径在服务器（chroot 后）视角下可写。
                </div>
              </div>
            )}
          </Space>
        </section>

        <section className="glass-card step">
          <div className="step-head">
            <span className="step-index">2</span>
            <div>
              <div className="step-title">提交区间</div>
              <div className="step-sub">From 留空 = 全量首次部署</div>
            </div>
          </div>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="From：留空 = 首次全量"
              value={fromCommit ?? undefined}
              onChange={(v) => setFromCommit(v ?? null)}
              options={commits.map((c) => ({
                value: c.hash,
                label: `${c.shortHash}  ${c.message}`,
              }))}
            />
            <Select
              style={{ width: '100%' }}
              placeholder="To：要部署到的提交"
              value={toCommit ?? undefined}
              onChange={(v) => setToCommit(v)}
              options={commits.map((c) => ({
                value: c.hash,
                label: `${c.shortHash}  ${c.message}`,
              }))}
            />
            <Button type="primary" block disabled={!toCommit} onClick={computeDiff}>
              计算变更
            </Button>
          </Space>
        </section>

        <section className="glass-card step step-stat">
          <div className="step-head">
            <span className="step-index">3</span>
            <div>
              <div className="step-title">变更统计</div>
              <div className="step-sub">本次将同步的文件</div>
            </div>
          </div>
          <div className="stat-row">
            <div className="stat-item stat-add">
              <div className="stat-num">{diff.filter((d) => d.action === 'ADD').length}</div>
              <div className="stat-label">新增</div>
            </div>
            <div className="stat-item stat-mod">
              <div className="stat-num">{diff.filter((d) => d.action === 'MODIFY').length}</div>
              <div className="stat-label">修改</div>
            </div>
            <div className="stat-item stat-del">
              <div className="stat-num">{diff.filter((d) => d.action === 'DELETE').length}</div>
              <div className="stat-label">删除</div>
            </div>
            <div className="stat-item stat-ren">
              <div className="stat-num">{diff.filter((d) => d.action === 'RENAME').length}</div>
              <div className="stat-label">重命名</div>
            </div>
          </div>
        </section>
      </div>

      <div className="glass-card">
        <div style={{ marginBottom: 12, fontWeight: 500 }}>
          变更文件清单（{diff.length}）
        </div>
        <Table<ChangedFile>
          rowKey={(r) => r.path + r.action}
          dataSource={diff}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            {
              title: '动作',
              dataIndex: 'action',
              width: 110,
              render: (a: ChangedFile['action']) => {
                const color =
                  a === 'ADD' ? 'green' : a === 'DELETE' ? 'red' : a === 'RENAME' ? 'blue' : 'gold';
                return <Tag color={color}>{a}</Tag>;
              },
            },
            { title: '路径', dataIndex: 'path', ellipsis: true },
            { title: '原路径', dataIndex: 'oldPath', ellipsis: true },
          ]}
        />
      </div>

      {(running || logs.length > 0) && (
        <div className="glass-card" style={{ marginTop: 16 }}>
          <div
            style={{
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 500 }}>部署日志</span>
            {progress && (
              <Progress
                style={{ width: 240 }}
                percent={progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100)}
                size="small"
                status={running ? 'active' : 'success'}
              />
            )}
          </div>
          <div
            ref={logBoxRef}
            style={{
              maxHeight: 320,
              overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: 12,
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            {logs.map((l, i) => {
              const color =
                l.level === 'error' ? '#ff6b6b' : l.level === 'warn' ? '#ffd166' : 'rgba(255,255,255,0.85)';
              return (
                <div key={i} style={{ color, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  [{l.timestamp.slice(11, 19)}] {l.message}
                </div>
              );
            })}
            {logs.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>等待日志…</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
