/**
 * 传输层入口 — 根据协议分发到对应适配器。
 */
import type { Protocol, ServerRecord } from '../../shared/types';
import { SftpTransport, testSftpConnection } from './sftp-adapter';
import { FtpTransport, testFtpConnection } from './ftp-adapter';
import type { ConnectionTestResult } from './sftp-adapter';
import type { Transport } from './types';

export type { ConnectionTestResult } from './sftp-adapter';
export type { Transport } from './types';

export interface TestConnectionParams {
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  secret: string;
  remoteBasePath: string;
}

export async function testConnection(p: TestConnectionParams): Promise<ConnectionTestResult> {
  if (p.protocol === 'sftp') {
    return testSftpConnection({
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      secret: p.secret,
      remoteBasePath: p.remoteBasePath,
    });
  }
  if (p.authType !== 'password') {
    return { ok: false, message: 'FTP 不支持私钥认证，请改用密码或切换为 SFTP' };
  }
  return testFtpConnection({
    host: p.host,
    port: p.port,
    username: p.username,
    secret: p.secret,
    remoteBasePath: p.remoteBasePath,
  });
}

/**
 * 根据服务器配置创建并连接一个 Transport 会话。
 * 调用方负责在用完后 close()。
 */
export async function createTransport(server: ServerRecord, secret: string): Promise<Transport> {
  if (server.protocol === 'sftp') {
    const t = new SftpTransport({
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      secret,
      remoteBasePath: server.remoteBasePath,
    });
    await t.connect();
    return t;
  }
  if (server.authType !== 'password') {
    throw new Error('FTP 不支持私钥认证');
  }
  const t = new FtpTransport({
    host: server.host,
    port: server.port,
    username: server.username,
    secret,
    remoteBasePath: server.remoteBasePath,
  });
  await t.connect();
  return t;
}
