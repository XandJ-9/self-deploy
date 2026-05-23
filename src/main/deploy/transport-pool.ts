/**
 * TransportPool — 维护 N 个独立的 Transport 连接，提供 worker-queue 并行上传能力。
 *
 * 使用：
 *   const pool = await TransportPool.create(server, secret, 4);
 *   await pool.runAll(items, async (item, t) => { await t.put(...); });
 *   await pool.close();
 */
import { createTransport, type Transport } from '../transport';
import type { ServerRecord } from '../../shared/types';

export class TransportPool {
  private constructor(private readonly transports: Transport[]) {}

  static async create(server: ServerRecord, secret: string, size: number): Promise<TransportPool> {
    const n = Math.max(1, Math.floor(size));
    const created: Transport[] = [];
    try {
      for (let i = 0; i < n; i += 1) {
        // 顺序建链，避免某些服务器对突发连接限制
        // 失败时回滚已建链
        // eslint-disable-next-line no-await-in-loop
        const t = await createTransport(server, secret);
        created.push(t);
      }
      return new TransportPool(created);
    } catch (err) {
      await Promise.allSettled(created.map((t) => t.close()));
      throw err;
    }
  }

  /** 任意一条连接执行一次性操作（mkdirp / rename / remove 等）。 */
  primary(): Transport {
    return this.transports[0];
  }

  /** 并发执行 worker，每个 item 派发到一条空闲连接。任一失败则取消余下、抛出第一个错误。 */
  async runAll<T>(items: T[], worker: (item: T, t: Transport, index: number) => Promise<void>): Promise<void> {
    if (items.length === 0) return;
    let cursor = 0;
    let firstErr: Error | null = null;
    const next = async (t: Transport): Promise<void> => {
      while (firstErr === null) {
        const idx = cursor;
        if (idx >= items.length) return;
        cursor += 1;
        try {
          await worker(items[idx], t, idx);
        } catch (err) {
          if (firstErr === null) firstErr = err as Error;
          return;
        }
      }
    };
    await Promise.all(this.transports.map((t) => next(t)));
    if (firstErr) throw firstErr;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.transports.map((t) => t.close()));
  }
}
