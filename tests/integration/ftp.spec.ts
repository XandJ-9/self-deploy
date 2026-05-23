/**
 * FTP 端到端冒烟测试 —— 依赖 `docker compose up -d` 启动的 selfdeploy-ftp。
 * 仅在本地手动跑：`npm test`。CI/无 Docker 环境会失败。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FtpTransport, testFtpConnection } from '../../src/main/transport/ftp-adapter';

const cfg = {
  host: '127.0.0.1',
  port: 2121,
  username: 'demo',
  secret: 'demo123',
  remoteBasePath: '/',
};

async function ftpReachable(): Promise<boolean> {
  try {
    const r = await testFtpConnection({ ...cfg, timeoutMs: 2000 });
    return r.ok;
  } catch {
    return false;
  }
}

describe('FtpTransport 冒烟', () => {
  let tmpDir = '';
  let localFile = '';
  let skip = false;

  beforeAll(async () => {
    skip = !(await ftpReachable());
    if (skip) return;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-ftp-'));
    localFile = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(localFile, 'self-deploy ftp smoke');
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('connect → put → rename → remove → removeDir', async () => {
    if (skip) {
      console.warn('[skip] FTP 服务不可达，跳过 (docker compose up -d)');
      return;
    }
    const t = new FtpTransport(cfg);
    const remoteDir = `sd-test-${Date.now()}`;
    const tmpRemote = `${remoteDir}/tmp/hello.txt`;
    const finalRemote = `${remoteDir}/hello.txt`;
    try {
      await t.connect();
      await t.mkdirp(`${remoteDir}/tmp`);
      await t.put(localFile, tmpRemote);
      expect(await t.exists(tmpRemote)).toBe(true);
      await t.rename(tmpRemote, finalRemote);
      expect(await t.exists(finalRemote)).toBe(true);
      await t.remove(finalRemote);
      expect(await t.exists(finalRemote)).toBe(false);
      await t.removeDir(remoteDir);
    } finally {
      await t.close();
    }
  }, 30_000);
});
