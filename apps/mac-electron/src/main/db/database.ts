import Database from 'better-sqlite3';
import path from 'node:path';
import { getAppDataDir } from '../paths';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const dataDir = getAppDataDir();
  const dbPath = path.join(dataDir, 'selfdeploy.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('sftp','ftp')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK (auth_type IN ('password','privateKey')),
      credential_ref TEXT NOT NULL,
      remote_base_path TEXT NOT NULL DEFAULT '/',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      default_server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
      remote_path TEXT NOT NULL,
      exclude_patterns TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      from_commit TEXT,
      to_commit TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      log_path TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deployment_files (
      deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      action TEXT NOT NULL,
      size INTEGER,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
    CREATE INDEX IF NOT EXISTS idx_deployment_files_dep ON deployment_files(deployment_id);
  `);

  // 增量字段（老库升级）：projects.pre_deploy_cmd / post_deploy_cmd
  const projectCols = d.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
  const has = (n: string): boolean => projectCols.some((c) => c.name === n);
  if (!has('pre_deploy_cmd')) {
    d.exec(`ALTER TABLE projects ADD COLUMN pre_deploy_cmd TEXT`);
  }
  if (!has('post_deploy_cmd')) {
    d.exec(`ALTER TABLE projects ADD COLUMN post_deploy_cmd TEXT`);
  }
}
