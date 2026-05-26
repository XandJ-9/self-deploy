import { useEffect, useMemo, useState } from 'react';
import AntdApp from 'antd/es/app';
import Button from 'antd/es/button';
import Drawer from 'antd/es/drawer';
import Popconfirm from 'antd/es/popconfirm';
import Select from 'antd/es/select';
import Space from 'antd/es/space';
import Table from 'antd/es/table';
import Tag from 'antd/es/tag';
import Tooltip from 'antd/es/tooltip';
import { ReloadOutlined, RollbackOutlined, EyeOutlined, FileTextOutlined } from '@ant-design/icons';
import type {
  DeploymentRecord,
  DeploymentDetail,
  DeployStatus,
  ProjectRecord,
  ServerRecord,
} from '@domain/index';
import PageHero from '../components/PageHero';

const STATUS_META: Record<DeployStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: '排队' },
  running: { color: 'processing', label: '执行中' },
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
  rolledback: { color: 'warning', label: '回滚' },
};

const ACTION_COLOR: Record<string, string> = {
  ADD: 'green',
  MODIFY: 'gold',
  DELETE: 'red',
  RENAME: 'blue',
};

const FILE_STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  success: 'success',
  failed: 'error',
  skipped: 'default',
};

interface HistoryFilter {
  projectId?: number;
  serverId?: number;
  status?: DeployStatus;
}

export default function HistoryPage() {
  const { message, modal } = AntdApp.useApp();
  const [list, setList] = useState<DeploymentRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DeploymentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [logText, setLogText] = useState<string>('');
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<number | null>(null);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const serverMap = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);

  const loadList = async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await window.api.invoke<DeploymentRecord[]>(
        window.api.channels.Deploy.History,
        filter,
      );
      setList(rows);
    } catch (e) {
      message.error('加载部署历史失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([
      window.api.invoke<ProjectRecord[]>(window.api.channels.Project.List).then(setProjects),
      window.api.invoke<ServerRecord[]>(window.api.channels.Server.List).then(setServers),
    ]);
  }, []);

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const openDetail = async (id: number): Promise<void> => {
    try {
      const d = await window.api.invoke<DeploymentDetail>(
        window.api.channels.Deploy.Detail,
        id,
      );
      setDetail(d);
      setDetailOpen(true);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openLog = async (id: number): Promise<void> => {
    setLogLoading(true);
    setLogOpen(true);
    setLogText('');
    try {
      const r = await window.api.invoke<{ path: string | null; content: string }>(
        window.api.channels.Deploy.Log,
        id,
      );
      setLogText(r.path ? r.content || '（日志为空）' : '（该部署没有日志文件，可能是旧版本生成的记录）');
    } catch (e) {
      setLogText(`读取失败：${(e as Error).message}`);
    } finally {
      setLogLoading(false);
    }
  };

  const doRollback = async (id: number): Promise<void> => {
    setRollingBackId(id);
    try {
      const r = await window.api.invoke<{ deploymentId: number; status: DeployStatus; message?: string }>(
        window.api.channels.Deploy.Rollback,
        id,
      );
      if (r.status === 'rolledback') {
        message.success(`已生成回滚部署 #${r.deploymentId}`);
      } else {
        message.error(`回滚失败：${r.message ?? r.status}`);
      }
      await loadList();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRollingBackId(null);
    }
  };

  const formatTime = (s: string | null): string =>
    s ? new Date(s).toLocaleString() : '-';

  const formatDuration = (a: string, b: string | null): string => {
    if (!b) return '进行中';
    const ms = new Date(b).getTime() - new Date(a).getTime();
    if (ms < 1000) return ms + 'ms';
    if (ms < 60_000) return (ms / 1000).toFixed(1) + 's';
    return Math.floor(ms / 60_000) + 'm' + Math.floor((ms % 60_000) / 1000) + 's';
  };

  return (
    <>
      <PageHero
        title="部署历史"
        description="查看历史部署记录、变更详情，并支持一键回滚至上一状态"
      />

      <div className="glass-card" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="按项目筛选"
            style={{ width: 200 }}
            value={filter.projectId}
            onChange={(v) => setFilter((f) => ({ ...f, projectId: v }))}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Select
            allowClear
            placeholder="按服务器筛选"
            style={{ width: 200 }}
            value={filter.serverId}
            onChange={(v) => setFilter((f) => ({ ...f, serverId: v }))}
            options={servers.map((s) => ({
              value: s.id,
              label: `${s.name} (${s.protocol})`,
            }))}
          />
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 160 }}
            value={filter.status}
            onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
            options={(Object.keys(STATUS_META) as DeployStatus[]).map((s) => ({
              value: s,
              label: STATUS_META[s].label,
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadList()} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <div className="glass-card">
        <Table<DeploymentRecord>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={list}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: '#', dataIndex: 'id', width: 70 },
            {
              title: '项目',
              dataIndex: 'projectId',
              width: 160,
              render: (id: number) => projectMap.get(id)?.name ?? `#${id}`,
            },
            {
              title: '服务器',
              dataIndex: 'serverId',
              width: 180,
              render: (id: number) => {
                const s = serverMap.get(id);
                return s ? `${s.name} (${s.protocol})` : `#${id}`;
              },
            },
            {
              title: '提交区间',
              width: 200,
              render: (_v, r) => (
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {r.fromCommit ? r.fromCommit.slice(0, 7) : '∅'} → {r.toCommit.slice(0, 7)}
                </span>
              ),
            },
            { title: '文件数', dataIndex: 'fileCount', width: 80 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: DeployStatus) => (
                <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>
              ),
            },
            {
              title: '开始时间',
              dataIndex: 'startedAt',
              width: 180,
              render: formatTime,
            },
            {
              title: '耗时',
              width: 100,
              render: (_v, r) => formatDuration(r.startedAt, r.finishedAt),
            },
            {
              title: '操作',
              width: 180,
              fixed: 'right',
              render: (_v, r) => (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => void openDetail(r.id)}
                  >
                    详情
                  </Button>
                  <Tooltip
                    title={
                      r.status !== 'success'
                        ? '仅成功状态可回滚'
                        : !r.fromCommit
                        ? '首次部署无可回滚目标'
                        : ''
                    }
                  >
                    <Popconfirm
                      title={`回滚部署 #${r.id}？`}
                      description="会把远端文件恢复到该部署之前的状态，并新建一条 rolledback 部署记录。"
                      okText="确认回滚"
                      cancelText="取消"
                      disabled={r.status !== 'success' || !r.fromCommit}
                      onConfirm={() => void doRollback(r.id)}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<RollbackOutlined />}
                        loading={rollingBackId === r.id}
                        disabled={r.status !== 'success' || !r.fromCommit}
                      >
                        回滚
                      </Button>
                    </Popconfirm>
                  </Tooltip>
                </Space>
              ),
            },
          ]}
          scroll={{ x: 1200 }}
          locale={{
            emptyText: (
              <div className="empty-block" style={{ padding: '40px 0' }}>
                <div className="emoji">🚀</div>
                <div>暂无部署记录</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  完成首次部署后，这里会显示历史快照
                </div>
              </div>
            ),
          }}
        />
      </div>

      <Drawer
        title={detail ? `部署详情 #${detail.record.id}` : '部署详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={720}
        destroyOnHidden
      >
        {detail && (
          <>
            <div style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.9 }}>
              <div>
                项目：<b>{projectMap.get(detail.record.projectId)?.name ?? `#${detail.record.projectId}`}</b>
              </div>
              <div>
                服务器：<b>{serverMap.get(detail.record.serverId)?.name ?? `#${detail.record.serverId}`}</b>
              </div>
              <div>
                提交区间：
                <code style={{ fontSize: 12 }}>
                  {detail.record.fromCommit ?? '∅'} → {detail.record.toCommit}
                </code>
              </div>
              <div>
                状态：
                <Tag color={STATUS_META[detail.record.status].color}>
                  {STATUS_META[detail.record.status].label}
                </Tag>
              </div>
              <div>开始：{formatTime(detail.record.startedAt)}</div>
              <div>结束：{formatTime(detail.record.finishedAt)}</div>
              <div>
                文件数：{detail.record.fileCount}（耗时{' '}
                {formatDuration(detail.record.startedAt, detail.record.finishedAt)}）
              </div>
            </div>

            <Table
              rowKey={(r) => r.path}
              size="small"
              dataSource={detail.files}
              pagination={{ pageSize: 50, showSizeChanger: false }}
              columns={[
                {
                  title: '动作',
                  dataIndex: 'action',
                  width: 90,
                  render: (a: string) => <Tag color={ACTION_COLOR[a]}>{a}</Tag>,
                },
                { title: '路径', dataIndex: 'path', ellipsis: true },
                {
                  title: '结果',
                  dataIndex: 'status',
                  width: 90,
                  render: (s: string) => <Tag color={FILE_STATUS_COLOR[s]}>{s}</Tag>,
                },
              ]}
            />

            {detail.record.status === 'success' && detail.record.fromCommit && (
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
                <Button icon={<FileTextOutlined />} onClick={() => void openLog(detail.record.id)}>
                  查看完整日志
                </Button>
                <Popconfirm
                  title={`回滚部署 #${detail.record.id}？`}
                  okText="确认回滚"
                  cancelText="取消"
                  onConfirm={() => {
                    void modal.confirm({
                      title: '回滚日志将在「部署」页实时显示',
                      content: '建议切到部署页查看回滚过程。',
                      onOk: () => doRollback(detail.record.id).then(() => setDetailOpen(false)),
                    });
                  }}
                >
                  <Button danger icon={<RollbackOutlined />}>
                    回滚此次部署
                  </Button>
                </Popconfirm>
              </div>
            )}
            {!(detail.record.status === 'success' && detail.record.fromCommit) && (
              <div style={{ marginTop: 16, textAlign: 'left' }}>
                <Button icon={<FileTextOutlined />} onClick={() => void openLog(detail.record.id)}>
                  查看完整日志
                </Button>
              </div>
            )}
          </>
        )}
      </Drawer>

      <Drawer
        title="部署日志"
        open={logOpen}
        onClose={() => setLogOpen(false)}
        width={820}
        destroyOnHidden
      >
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'rgba(0,0,0,0.25)',
            padding: 12,
            borderRadius: 6,
            maxHeight: 'calc(100vh - 140px)',
            overflow: 'auto',
          }}
        >
          {logLoading ? '加载中…' : logText}
        </pre>
      </Drawer>
    </>
  );
}
