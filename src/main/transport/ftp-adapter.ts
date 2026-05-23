/**
 * FTP 适配器 — 包装 basic-ftp，提供连接测试与 Transport 实现。
 * 仅在主进程使用。
 */
import { Client } from 'basic-ftp';
import path from 'node:path';
import type { ConnectionTestResult } from './sftp-adapter';
import type { Transport } from './types';

export interface FtpConnectConfig {
  host: string;
  port: number;
  username: string;
  /** FTP 只支持密码 */
  secret: string;
  remoteBasePath: string;
  /** 是否启用 FTPS（隐式 TLS）。默认 false。 */
  secure?: boolean;
  timeoutMs?: number;
}

export async function testFtpConnection(cfg: FtpConnectConfig): Promise<ConnectionTestResult> {
  const client = new Client(cfg.timeoutMs ?? 8000);
  const targetPath = cfg.remoteBasePath || '/';
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: cfg.secret,
      secure: cfg.secure ?? false,
    });
    // 登录后会话默认所在的当前目录
    let loginCwd: string | undefined;
    try {
      loginCwd = await client.pwd();
    } catch {
      /* ignore */
    }
    try {
      await client.cd(targetPath);
    } catch {
      return {
        ok: true,
        message: `FTP 连接成功，当前目录：${loginCwd ?? '(未知)'}；但部署路径 ${targetPath} 不存在（首次部署时会自动创建）`,
        remoteExists: false,
        remoteInfo: { absolutePath: targetPath, loginCwd },
      };
    }

    let absolutePath = targetPath;
    try {
      absolutePath = await client.pwd();
    } catch {
      /* ignore */
    }

    const writable = await probeFtpWritable(client);
    return {
      ok: true,
      message:
        `FTP 连接成功，当前目录：${loginCwd ?? '(未知)'}；部署目标目录：${absolutePath}` +
        (writable ? '' : '；⚠️ 目录不可写，部署会失败'),
      remoteExists: 'd',
      remoteInfo: { absolutePath, loginCwd, writable },
    };
  } catch (err) {
    return { ok: false, message: `FTP 连接失败：${(err as Error).message}` };
  } finally {
    client.close();
  }
}

async function probeFtpWritable(client: Client): Promise<boolean> {
  const probe = `.sd-write-test-${Date.now()}`;
  try {
    const { Readable } = await import('node:stream');
    await client.uploadFrom(Readable.from(Buffer.from('')), probe);
    try {
      await client.remove(probe);
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 基于 basic-ftp 的 Transport 实现。
 * 注意 FTP 没有真正的"原子 rename 覆盖"语义，rename 到已存在目标会失败；
 * 调用方需先 remove(to)。
 */
export class FtpTransport implements Transport {
  private client: Client;

  constructor(private readonly cfg: FtpConnectConfig) {
    this.client = new Client(cfg.timeoutMs ?? 8000);
  }

  async connect(): Promise<void> {
    await this.client.access({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.username,
      password: this.cfg.secret,
      secure: this.cfg.secure ?? false,
    });
  }

  async close(): Promise<void> {
    this.client.close();
  }

  async mkdirp(remoteDir: string): Promise<void> {
    // basic-ftp ensureDir 会逐段切换 CWD；操作完后恢复原 CWD，
    // 否则后续相对路径会从子目录开始解析，造成路径错乱（且在 chroot 用户下 cd '/' 可能触达真实根）。
    let prev: string | null = null;
    try {
      prev = await this.client.pwd();
    } catch {
      /* ignore */
    }
    try {
      await this.client.ensureDir(remoteDir);
    } finally {
      if (prev) {
        try {
          await this.client.cd(prev);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async put(localPath: string, remotePath: string): Promise<void> {
    await this.mkdirp(path.posix.dirname(remotePath));
    await this.client.uploadFrom(localPath, remotePath);
  }

  async remove(remotePath: string): Promise<void> {
    try {
      await this.client.remove(remotePath);
    } catch (err) {
      const code = (err as { code?: number }).code;
      // 550 = file not found / no access
      if (code === 550) return;
      throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await this.client.rename(from, to);
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const size = await this.client.size(remotePath);
      return size >= 0;
    } catch {
      // size 失败可能是目录或不存在；再尝试列出父目录
      try {
        const list = await this.client.list(path.posix.dirname(remotePath));
        const name = path.posix.basename(remotePath);
        return list.some((entry) => entry.name === name);
      } catch {
        return false;
      }
    }
  }

  async removeDir(remoteDir: string): Promise<void> {
    try {
      await this.client.removeDir(remoteDir);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 550) return;
      throw err;
    }
  }
}
