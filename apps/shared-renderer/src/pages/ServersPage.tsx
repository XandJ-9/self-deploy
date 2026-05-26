import { useEffect, useState } from 'react';
import AntdApp from 'antd/es/app';
import Button from 'antd/es/button';
import Form from 'antd/es/form';
import Input from 'antd/es/input';
import InputNumber from 'antd/es/input-number';
import Modal from 'antd/es/modal';
import Popconfirm from 'antd/es/popconfirm';
import Select from 'antd/es/select';
import Space from 'antd/es/space';
import Table from 'antd/es/table';
import Tag from 'antd/es/tag';
import { PlusOutlined } from '@ant-design/icons';
import type { ServerRecord } from '@domain/index';
import PageHero from '../components/PageHero';

const { Item } = Form;

export default function ServersPage() {
  const { message } = AntdApp.useApp();
  const [list, setList] = useState<ServerRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = async (): Promise<void> => {
    const data = await window.api.invoke<ServerRecord[]>(window.api.channels.Server.List);
    setList(data);
  };

  useEffect(() => {
    void reload();
  }, []);

  const openCreate = (): void => {
    setEditingId(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (r: ServerRecord): void => {
    setEditingId(r.id);
    form.setFieldsValue({
      name: r.name,
      protocol: r.protocol,
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      remoteBasePath: r.remoteBasePath,
      secret: '',
    });
    setOpen(true);
  };

  const onSubmit = async (): Promise<void> => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      if (editingId == null) {
        await window.api.invoke(window.api.channels.Server.Create, values);
        message.success('已创建');
      } else {
        const payload: Record<string, unknown> = { id: editingId, ...values };
        if (!values.secret) delete payload.secret;
        await window.api.invoke(window.api.channels.Server.Update, payload);
        message.success('已更新');
      }
      setOpen(false);
      form.resetFields();
      setEditingId(null);
      await reload();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (id: number): Promise<void> => {
    await window.api.invoke(window.api.channels.Server.Delete, id);
    message.success('已删除');
    await reload();
  };

  const onTest = async (id: number): Promise<void> => {
    setTestingId(id);
    const hide = message.loading('正在测试连接…', 0);
    try {
      const r = await window.api.invoke<{ ok: boolean; message: string }>(
        window.api.channels.Server.TestConnection,
        id,
      );
      hide();
      if (r.ok) message.success(r.message, 8);
      else message.error(r.message, 8);
    } catch (e) {
      hide();
      message.error((e as Error).message, 8);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <>
      <PageHero
        title="服务器"
        description="管理目标服务器与凭据，密码/私钥通过系统钥匙串加密"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增服务器
          </Button>
        }
      />

      <div className="glass-card">
        <Table<ServerRecord>
        rowKey="id"
        dataSource={list}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '协议',
            dataIndex: 'protocol',
            render: (v) => <Tag color={v === 'sftp' ? 'green' : 'orange'}>{v.toUpperCase()}</Tag>,
          },
          { title: '地址', render: (_, r) => `${r.username}@${r.host}:${r.port}` },
          { title: '远端路径', dataIndex: 'remoteBasePath' },
          {
            title: '操作',
            render: (_, r) => (
              <Space>
                <Button size="small" loading={testingId === r.id} onClick={() => onTest(r.id)}>
                  测试
                </Button>
                <Button size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm title="确定删除？" onConfirm={() => onDelete(r.id)}>
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      </div>

      <Modal
        title={editingId == null ? '新增服务器' : '编辑服务器'}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditingId(null);
        }}
        onOk={onSubmit}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ protocol: 'sftp', port: 22, authType: 'password', remoteBasePath: '/' }}
        >
          <Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Item>
          <Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'sftp', label: 'SFTP（推荐）' },
                { value: 'ftp', label: 'FTP' },
              ]}
            />
          </Item>
          <Item name="host" label="主机" rules={[{ required: true }]}>
            <Input placeholder="example.com" />
          </Item>
          <Item name="port" label="端口" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Item>
          <Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input />
          </Item>
          <Item name="authType" label="认证方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'password', label: '密码' },
                { value: 'privateKey', label: '私钥' },
              ]}
            />
          </Item>
          <Item
            name="secret"
            label="密码 / 私钥内容"
            rules={editingId == null ? [{ required: true }] : []}
            extra={
              editingId == null
                ? '将通过系统钥匙串加密保存，不会以明文落库'
                : '留空表示不修改已有凭据；若测试提示凭据不存在，请重新填写后保存'
            }
          >
            <Input.TextArea rows={3} />
          </Item>
          <Item
            name="remoteBasePath"
            label="远端基路径"
            tooltip="此服务器上所有项目部署的起始目录（POSIX 绝对路径）。若服务器对该用户做了 chroot（如 OpenSSH ChrootDirectory、atmoz/sftp），请填写 chroot 后视角的路径，不要填宿主机真实路径。"
            extra="例如 atmoz/sftp 测试容器应填 /upload，而不是 /home/demo/upload"
          >
            <Input placeholder="/var/www" />
          </Item>
        </Form>
      </Modal>
    </>
  );
}
