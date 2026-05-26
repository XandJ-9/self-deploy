import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc-channels';
import type { ServerRecord } from '../../shared/types';
import { getDb } from '../db/database';
import {
  saveCredential,
  deleteCredential,
  readCredential,
  updateCredential,
} from '../security/credential-vault';
import { testConnection } from '../transport';

const CreateServerSchema = z.object({
  name: z.string().min(1),
  protocol: z.enum(['sftp', 'ftp']),
  host: z.string().min(1),
  port: z.number().int().positive(),
  username: z.string().min(1),
  authType: z.enum(['password', 'privateKey']),
  secret: z.string().min(1),
  remoteBasePath: z.string().default('/'),
});

const UpdateServerSchema = CreateServerSchema.partial().extend({
  id: z.number().int().positive(),
});

interface ServerRow {
  id: number;
  name: string;
  protocol: 'sftp' | 'ftp';
  host: string;
  port: number;
  username: string;
  auth_type: 'password' | 'privateKey';
  credential_ref: string;
  remote_base_path: string;
  created_at: string;
}

function rowToRecord(r: ServerRow): ServerRecord {
  return {
    id: r.id,
    name: r.name,
    protocol: r.protocol,
    host: r.host,
    port: r.port,
    username: r.username,
    authType: r.auth_type,
    credentialRef: r.credential_ref,
    remoteBasePath: r.remote_base_path,
    createdAt: r.created_at,
  };
}

export function registerServerHandlers(): void {
  ipcMain.handle(IPC.Server.List, (): ServerRecord[] => {
    const rows = getDb().prepare('SELECT * FROM servers ORDER BY id DESC').all() as ServerRow[];
    return rows.map(rowToRecord);
  });

  ipcMain.handle(IPC.Server.Create, (_e, raw: unknown): ServerRecord => {
    const input = CreateServerSchema.parse(raw);
    const ref = saveCredential(input.secret);
    const info = getDb()
      .prepare(
        `INSERT INTO servers(name, protocol, host, port, username, auth_type, credential_ref, remote_base_path)
         VALUES (@name,@protocol,@host,@port,@username,@authType,@ref,@remoteBasePath)`,
      )
      .run({ ...input, ref });
    const row = getDb()
      .prepare('SELECT * FROM servers WHERE id = ?')
      .get(info.lastInsertRowid) as ServerRow;
    return rowToRecord(row);
  });

  ipcMain.handle(IPC.Server.Delete, (_e, id: number): void => {
    const row = getDb().prepare('SELECT credential_ref FROM servers WHERE id = ?').get(id) as
      | { credential_ref: string }
      | undefined;
    if (row) deleteCredential(row.credential_ref);
    getDb().prepare('DELETE FROM servers WHERE id = ?').run(id);
  });

  ipcMain.handle(IPC.Server.Update, (_e, raw: unknown): ServerRecord => {
    const input = UpdateServerSchema.parse(raw);
    const { id, secret, ...rest } = input;
    const existing = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id) as
      | ServerRow
      | undefined;
    if (!existing) throw new Error(`服务器不存在 (id=${id})`);

    if (secret) updateCredential(existing.credential_ref, secret);

    const fieldMap: Record<string, string> = {
      name: 'name',
      protocol: 'protocol',
      host: 'host',
      port: 'port',
      username: 'username',
      authType: 'auth_type',
      remoteBasePath: 'remote_base_path',
    };
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      const col = fieldMap[key];
      if (col) {
        sets.push(`${col} = @${key}`);
        params[key] = value;
      }
    }
    if (sets.length > 0) {
      getDb().prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
    const updated = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow;
    return rowToRecord(updated);
  });

  ipcMain.handle(
    IPC.Server.TestConnection,
    async (_e, id: number): Promise<{ ok: boolean; message: string }> => {
      const row = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(id) as
        | ServerRow
        | undefined;
      if (!row) return { ok: false, message: '服务器不存在' };
      let secret: string;
      try {
        secret = readCredential(row.credential_ref);
      } catch (e) {
        return { ok: false, message: `凭据读取失败：${(e as Error).message}` };
      }
      const result = await testConnection({
        protocol: row.protocol,
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        secret,
        remoteBasePath: row.remote_base_path,
      });
      return { ok: result.ok, message: result.message };
    },
  );
}
