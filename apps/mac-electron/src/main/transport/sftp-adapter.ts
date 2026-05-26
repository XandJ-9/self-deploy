/**
 * SFTP 适配器 — 包装 ssh2-sftp-client，提供连接测试与 Transport 实现。
 * 仅在主进程使用。
 */
import SFTPClient from 'ssh2-sftp-client';
import path from 'node:path';
import type { Transport } from './types';

export interface SftpConnectConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  secret: string;
  remoteBasePath: string;
  /** 单次操作超时（毫秒） */
  timeoutMs?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** 路径是否存在：'d' 目录 / '-' 文件 / false 不存在 */
  remoteExists?: 'd' | '-' | 'l' | false;
  /** 远端路径的附加信息（目录条目数 / 文件大小 等），便于 UI 显示 */
  remoteInfo?: {
    absolutePath?: string;
    /** 登录后会话默认所在的当前目录（用户 home / landing dir） */
    loginCwd?: string;
    entryCount?: number;
    dirCount?: number;
    fileCount?: number;
    size?: number;
    modifyTime?: number;
    sample?: string[];
    writable?: boolean;
  };
}

function buildConnectOptions(cfg: SftpConnectConfig): SFTPClient.ConnectOptions {
  const base: SFTPClient.ConnectOptions = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    readyTimeout: cfg.timeoutMs ?? 8000,
  };
  if (cfg.authType === 'password') {
    return { ...base, password: cfg.secret };
  }
  return { ...base, privateKey: Buffer.from(cfg.secret, 'utf8') };
}

export async function testSftpConnection(cfg: SftpConnectConfig): Promise<ConnectionTestResult> {
  const sftp = new SFTPClient();
  const target = cfg.remoteBasePath || '/';
  try {
    await sftp.connect(buildConnectOptions(cfg));
    // 登录后默认所在的当前目录（会话 CWD，通常为用户 home）
    let loginCwd: string | undefined;
    try {
      loginCwd = (await sftp.realPath('.')) || undefined;
    } catch {
      /* ignore */
    }
    const exists = await sftp.exists(target);
    if (!exists) {
      // 探测父目录是否可写，给用户更明确的提示
      const parent = path.posix.dirname(target) || '/';
      let parentWritable: boolean | undefined;
      try {
        const parentExists = await sftp.exists(parent);
        if (parentExists === 'd') {
          parentWritable = await probeSftpWritable(sftp, parent);
        }
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        message:
          `连接成功，当前目录：${loginCwd ?? '(未知)'}；但部署路径 ${target} 不存在（首次部署时会自动创建）` +
          (parentWritable === false ? `；⚠️ 父目录 ${parent} 不可写，部署会失败` : ''),
        remoteExists: false,
        remoteInfo: { absolutePath: target, loginCwd, writable: parentWritable },
      };
    }

    let absolutePath = target;
    try {
      absolutePath = (await sftp.realPath(target)) || target;
    } catch {
      /* ignore */
    }

    if (exists === '-' || exists === 'l') {
      let size: number | undefined;
      let modifyTime: number | undefined;
      try {
        const st = await sftp.stat(target);
        size = st.size;
        modifyTime = st.modifyTime;
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        message: `连接成功，当前目录：${loginCwd ?? '(未知)'}；远端为${exists === 'l' ? '软链接' : '文件'} ${absolutePath}${
          size !== undefined ? `（${formatBytes(size)}）` : ''
        }`,
        remoteExists: exists,
        remoteInfo: { absolutePath, loginCwd, size, modifyTime },
      };
    }

    // 目录：仅探测可写性，不列出目录内容
    const writable = await probeSftpWritable(sftp, target);
    return {
      ok: true,
      message:
        `连接成功，当前目录：${loginCwd ?? '(未知)'}；部署目标目录：${absolutePath}` +
        (writable ? '' : '；⚠️ 目录不可写，部署会失败'),
      remoteExists: 'd',
      remoteInfo: { absolutePath, loginCwd, writable },
    };
  } catch (err) {
    return { ok: false, message: `SFTP 连接失败：${(err as Error).message}` };
  } finally {
    try {
      await sftp.end();
    } catch {
      /* ignore close errors */
    }
  }
}

async function probeSftpWritable(sftp: SFTPClient, dir: string): Promise<boolean> {
  const probe = path.posix.join(dir, `.sd-write-test-${Date.now()}`);
  try {
    await sftp.put(Buffer.from(''), probe);
    try {
      await sftp.delete(probe);
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 基于 ssh2-sftp-client 的 Transport 实现。
 * 调用方负责 connect → 多次操作 → close 的生命周期。
 */
export class SftpTransport implements Transport {
  private client = new SFTPClient();

  constructor(private readonly cfg: SftpConnectConfig) {}

  async connect(): Promise<void> {
    await this.client.connect(buildConnectOptions(this.cfg));
  }

  async close(): Promise<void> {
    try {
      await this.client.end();
    } catch {
      /* ignore */
    }
  }

  async mkdirp(remoteDir: string): Promise<void> {
    try {
      await this.client.mkdir(remoteDir, true);
    } catch (err) {
      // 防御：并发 mkdir 同一目录时，ssh2-sftp-client 可能把已存在误报为
      // "Bad path ... permission denied"。再 stat 一次确认存在则视作成功。
      try {
        const t = await this.client.exists(remoteDir);
        if (t === 'd') return;
      } catch {
        /* fallthrough */
      }
      throw err;
    }
  }

  async put(localPath: string, remotePath: string): Promise<void> {
    await this.mkdirp(path.posix.dirname(remotePath));
    await this.client.fastPut(localPath, remotePath);
  }

  async remove(remotePath: string): Promise<void> {
    try {
      await this.client.delete(remotePath, true);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/No such file/i.test(msg)) return;
      throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    // SFTP rename 在目标已存在时会失败；调用方需先 remove(to)
    await this.client.rename(from, to);
  }

  async exists(remotePath: string): Promise<boolean> {
    const r = await this.client.exists(remotePath);
    return r !== false;
  }

  async removeDir(remoteDir: string): Promise<void> {
    try {
      await this.client.rmdir(remoteDir, true);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/No such file/i.test(msg)) return;
      throw err;
    }
  }
}
