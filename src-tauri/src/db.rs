use std::{fs, path::PathBuf};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    id: i64,
    name: String,
    protocol: String,
    host: String,
    port: i64,
    username: String,
    auth_type: String,
    credential_ref: String,
    remote_base_path: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    id: i64,
    name: String,
    local_path: String,
    default_server_id: Option<i64>,
    remote_path: String,
    exclude_patterns: Vec<String>,
    pre_deploy_cmd: Option<String>,
    post_deploy_cmd: Option<String>,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub id: Option<i64>,
    pub name: String,
    pub local_path: String,
    pub default_server_id: Option<i64>,
    pub remote_path: String,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    pub pre_deploy_cmd: Option<String>,
    pub post_deploy_cmd: Option<String>,
}

pub fn list_servers(app: &AppHandle) -> Result<Vec<ServerRecord>, String> {
    let conn = open(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, protocol, host, port, username, auth_type, credential_ref, remote_base_path, created_at
             FROM servers
             ORDER BY id DESC",
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ServerRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                protocol: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                username: row.get(5)?,
                auth_type: row.get(6)?,
                credential_ref: row.get(7)?,
                remote_base_path: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(to_string)?;
    collect_rows(rows)
}

pub fn list_projects(app: &AppHandle) -> Result<Vec<ProjectRecord>, String> {
    let conn = open(app)?;
    query_projects(&conn, None)
}

pub fn create_project(app: &AppHandle, input: ProjectInput) -> Result<ProjectRecord, String> {
    validate_project(&input, false)?;
    let conn = open(app)?;
    let exclude_json = serde_json::to_string(&input.exclude_patterns).map_err(to_string)?;
    conn.execute(
        "INSERT INTO projects(name, local_path, default_server_id, remote_path, exclude_patterns, pre_deploy_cmd, post_deploy_cmd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.name,
            input.local_path,
            input.default_server_id,
            input.remote_path,
            exclude_json,
            normalize_optional(input.pre_deploy_cmd),
            normalize_optional(input.post_deploy_cmd),
        ],
    )
    .map_err(to_string)?;
    let id = conn.last_insert_rowid();
    query_project(&conn, id)
}

pub fn update_project(app: &AppHandle, input: ProjectInput) -> Result<ProjectRecord, String> {
    validate_project(&input, true)?;
    let id = input
        .id
        .ok_or_else(|| "project:update 缺少项目 id".to_string())?;
    let conn = open(app)?;
    let exclude_json = serde_json::to_string(&input.exclude_patterns).map_err(to_string)?;
    let changed = conn
        .execute(
            "UPDATE projects
                SET name = ?1,
                    local_path = ?2,
                    default_server_id = ?3,
                    remote_path = ?4,
                    exclude_patterns = ?5,
                    pre_deploy_cmd = ?6,
                    post_deploy_cmd = ?7
              WHERE id = ?8",
            params![
                input.name,
                input.local_path,
                input.default_server_id,
                input.remote_path,
                exclude_json,
                normalize_optional(input.pre_deploy_cmd),
                normalize_optional(input.post_deploy_cmd),
                id,
            ],
        )
        .map_err(to_string)?;
    if changed == 0 {
        return Err(format!("项目不存在: {id}"));
    }
    query_project(&conn, id)
}

pub fn delete_project(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open(app)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(to_string)?;
    Ok(())
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(to_string)?;
    }
    let conn = Connection::open(db_path).map_err(to_string)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(to_string)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(to_string)?;
    migrate(&conn)?;
    Ok(conn)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .ok_or_else(|| "无法解析仓库根目录".to_string())?;
        return Ok(repo_root.join(".local-data").join("selfdeploy.sqlite"));
    }

    let data_dir = app.path().app_data_dir().map_err(to_string)?;
    Ok(data_dir.join("selfdeploy.sqlite"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
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
        ",
    )
    .map_err(to_string)?;

    add_column_if_missing(conn, "projects", "pre_deploy_cmd", "TEXT")?;
    add_column_if_missing(conn, "projects", "post_deploy_cmd", "TEXT")?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(to_string)?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_string)?;
    for col in cols {
        if col.map_err(to_string)? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
        [],
    )
    .map_err(to_string)?;
    Ok(())
}

fn query_project(conn: &Connection, id: i64) -> Result<ProjectRecord, String> {
    let mut projects = query_projects(conn, Some(id))?;
    projects.pop().ok_or_else(|| format!("项目不存在: {id}"))
}

fn query_projects(conn: &Connection, id: Option<i64>) -> Result<Vec<ProjectRecord>, String> {
    let sql = match id {
        Some(_) => {
            "SELECT id, name, local_path, default_server_id, remote_path, exclude_patterns, pre_deploy_cmd, post_deploy_cmd, created_at
             FROM projects WHERE id = ?1 ORDER BY id DESC"
        }
        None => {
            "SELECT id, name, local_path, default_server_id, remote_path, exclude_patterns, pre_deploy_cmd, post_deploy_cmd, created_at
             FROM projects ORDER BY id DESC"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(to_string)?;
    let rows = match id {
        Some(project_id) => stmt
            .query_map(params![project_id], project_from_row)
            .map_err(to_string)?,
        None => stmt.query_map([], project_from_row).map_err(to_string)?,
    };
    collect_rows(rows)
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRecord> {
    let exclude_json: String = row.get(5)?;
    let exclude_patterns = serde_json::from_str(&exclude_json).unwrap_or_default();
    Ok(ProjectRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        local_path: row.get(2)?,
        default_server_id: row.get(3)?,
        remote_path: row.get(4)?,
        exclude_patterns,
        pre_deploy_cmd: row.get(6)?,
        post_deploy_cmd: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
) -> Result<Vec<T>, String> {
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(to_string)?);
    }
    Ok(records)
}

fn validate_project(input: &ProjectInput, require_id: bool) -> Result<(), String> {
    if require_id && input.id.filter(|id| *id > 0).is_none() {
        return Err("项目 id 必须是正整数".into());
    }
    if input.name.trim().is_empty() {
        return Err("项目名称不能为空".into());
    }
    if input.local_path.trim().is_empty() {
        return Err("本地路径不能为空".into());
    }
    if input.remote_path.trim().is_empty() {
        return Err("远端部署路径不能为空".into());
    }
    Ok(())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn to_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}
