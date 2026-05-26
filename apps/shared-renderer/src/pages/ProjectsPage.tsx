import { useEffect, useState } from 'react';
import AntdApp from 'antd/es/app';
import Button from 'antd/es/button';
import Form from 'antd/es/form';
import Input from 'antd/es/input';
import Modal from 'antd/es/modal';
import Popconfirm from 'antd/es/popconfirm';
import Select from 'antd/es/select';
import Table from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import type { ProjectRecord, ServerRecord } from '@domain/index';
import PageHero from '../components/PageHero';

const { Item } = Form;

export default function ProjectsPage() {
  const { message } = AntdApp.useApp();
  const [list, setList] = useState<ProjectRecord[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRecord | null>(null);
  const [form] = Form.useForm();

  const reload = async (): Promise<void> => {
    const [p, s] = await Promise.all([
      window.api.invoke<ProjectRecord[]>(window.api.channels.Project.List),
      window.api.invoke<ServerRecord[]>(window.api.channels.Server.List),
    ]);
    setList(p);
    setServers(s);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onPickDir = async (): Promise<void> => {
    const dir = await window.api.pickDirectory();
    if (dir) form.setFieldValue('localPath', dir);
  };

  const openCreate = (): void => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (r: ProjectRecord): void => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name,
      localPath: r.localPath,
      remotePath: r.remotePath,
      defaultServerId: r.defaultServerId ?? undefined,
      excludePatterns: (r.excludePatterns ?? []).join('\n'),
      preDeployCmd: r.preDeployCmd ?? '',
      postDeployCmd: r.postDeployCmd ?? '',
    });
    setOpen(true);
  };

  const onSubmit = async (): Promise<void> => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      defaultServerId: values.defaultServerId ?? null,
      excludePatterns: (values.excludePatterns ?? '')
        .split('\n')
        .map((x: string) => x.trim())
        .filter(Boolean),
      preDeployCmd: (values.preDeployCmd ?? '').trim() || null,
      postDeployCmd: (values.postDeployCmd ?? '').trim() || null,
    };
    if (editing) {
      await window.api.invoke(window.api.channels.Project.Update, { ...payload, id: editing.id });
      message.success('已更新');
    } else {
      await window.api.invoke(window.api.channels.Project.Create, payload);
      message.success('已创建');
    }
    setOpen(false);
    setEditing(null);
    form.resetFields();
    await reload();
  };

  return (
    <>
      <PageHero
        title="项目"
        description="绑定本地路径与远端部署路径，支持 glob 排除规则"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增项目
          </Button>
        }
      />
      <div className="glass-card">
        <Table<ProjectRecord>
        rowKey="id"
        dataSource={list}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '本地路径', dataIndex: 'localPath' },
          { title: '远端路径', dataIndex: 'remotePath' },
          {
            title: '默认服务器',
            render: (_, r) => servers.find((s) => s.id === r.defaultServerId)?.name ?? '-',
          },
          {
            title: '操作',
            render: (_, r) => (
              <>
                <Button size="small" type="link" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除？"
                  onConfirm={async () => {
                    await window.api.invoke(window.api.channels.Project.Delete, r.id);
                    await reload();
                  }}
                >
                  <Button size="small" type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ),
          },
        ]}
      />
      </div>

      <Modal
        title={editing ? `编辑项目：${editing.name}` : '新增项目'}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={onSubmit}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input />
          </Item>
          <Item name="localPath" label="本地路径" rules={[{ required: true }]}>
            <Input
              placeholder="点击右侧选择"
              addonAfter={
                <a onClick={onPickDir} style={{ cursor: 'pointer' }}>
                  浏览
                </a>
              }
            />
          </Item>
          <Item
            name="remotePath"
            label="远端部署路径"
            tooltip="相对于服务器 remoteBasePath 的子路径。最终目标 = 服务器 remoteBasePath + 此处填写的值。建议使用相对路径如 app、web/v2；填绝对路径 / 开头时仍会拼接在 remoteBasePath 之后。"
            rules={[{ required: true }]}
          >
            <Input placeholder="app  或留作根目录请填 /" />
          </Item>
          <Item name="defaultServerId" label="默认服务器">
            <Select
              allowClear
              options={servers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="可不选，部署时再指定"
            />
          </Item>
          <Item name="excludePatterns" label="排除规则（每行一个 glob）" tooltip="如 node_modules/**, *.log">
            <Input.TextArea rows={3} placeholder={'node_modules/**\n*.log'} />
          </Item>
          <Item name="preDeployCmd" label="部署前命令" tooltip="本地 shell，在本地路径下执行，非零退出会中断部署。例：npm run build">
            <Input.TextArea rows={2} placeholder="npm run build" />
          </Item>
          <Item name="postDeployCmd" label="部署后命令" tooltip="部署成功后执行，失败仅警告。例：echo done">
            <Input.TextArea rows={2} placeholder="echo done" />
          </Item>
        </Form>
      </Modal>
    </>
  );
}
