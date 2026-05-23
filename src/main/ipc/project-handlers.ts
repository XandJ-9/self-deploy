import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc-channels';
import type { ProjectRecord } from '../../shared/types';
import { getDb } from '../db/database';

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  defaultServerId: z.number().int().nullable().default(null),
  remotePath: z.string().min(1),
  excludePatterns: z.array(z.string()).default([]),
  preDeployCmd: z.string().nullable().default(null),
  postDeployCmd: z.string().nullable().default(null),
});

const UpdateProjectSchema = CreateProjectSchema.extend({
  id: z.number().int().positive(),
});

interface ProjectRow {
  id: number;
  name: string;
  local_path: string;
  default_server_id: number | null;
  remote_path: string;
  exclude_patterns: string;
  pre_deploy_cmd: string | null;
  post_deploy_cmd: string | null;
  created_at: string;
}

function rowToRecord(r: ProjectRow): ProjectRecord {
  return {
    id: r.id,
    name: r.name,
    localPath: r.local_path,
    defaultServerId: r.default_server_id,
    remotePath: r.remote_path,
    excludePatterns: JSON.parse(r.exclude_patterns) as string[],
    preDeployCmd: r.pre_deploy_cmd,
    postDeployCmd: r.post_deploy_cmd,
    createdAt: r.created_at,
  };
}

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC.Project.List, (): ProjectRecord[] => {
    const rows = getDb().prepare('SELECT * FROM projects ORDER BY id DESC').all() as ProjectRow[];
    return rows.map(rowToRecord);
  });

  ipcMain.handle(IPC.Project.Create, (_e, raw: unknown): ProjectRecord => {
    const input = CreateProjectSchema.parse(raw);
    const info = getDb()
      .prepare(
        `INSERT INTO projects(name, local_path, default_server_id, remote_path, exclude_patterns, pre_deploy_cmd, post_deploy_cmd)
         VALUES (@name,@localPath,@defaultServerId,@remotePath,@excludeJson,@preDeployCmd,@postDeployCmd)`,
      )
      .run({ ...input, excludeJson: JSON.stringify(input.excludePatterns) });
    const row = getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(info.lastInsertRowid) as ProjectRow;
    return rowToRecord(row);
  });

  ipcMain.handle(IPC.Project.Update, (_e, raw: unknown): ProjectRecord => {
    const input = UpdateProjectSchema.parse(raw);
    getDb()
      .prepare(
        `UPDATE projects
           SET name = @name,
               local_path = @localPath,
               default_server_id = @defaultServerId,
               remote_path = @remotePath,
               exclude_patterns = @excludeJson,
               pre_deploy_cmd = @preDeployCmd,
               post_deploy_cmd = @postDeployCmd
         WHERE id = @id`,
      )
      .run({ ...input, excludeJson: JSON.stringify(input.excludePatterns) });
    const row = getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(input.id) as ProjectRow | undefined;
    if (!row) throw new Error(`项目不存在: ${input.id}`);
    return rowToRecord(row);
  });

  ipcMain.handle(IPC.Project.Delete, (_e, id: number): void => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  });
}
