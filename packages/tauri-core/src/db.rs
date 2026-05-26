use std::{fs, path::PathBuf};

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{security, transport};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: i64,
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_type: String,
    pub credential_ref: String,
    pub remote_base_path: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: i64,
    pub name: String,
    pub local_path: String,
    pub default_server_id: Option<i64>,
    pub remote_path: String,
    pub exclude_patterns: Vec<String>,
    pub pre_deploy_cmd: Option<String>,
    pub post_deploy_cmd: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRecord {
    pub id: i64,
    pub project_id: i64,
    pub server_id: i64,
    pub from_commit: Option<String>,
    pub to_commit: String,
    pub file_count: i64,
    pub status: String,
    pub log_path: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentFileRecord {
    pub path: String,
    pub action: String,
    pub status: String,
    pub size: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentDetail {
    pub record: DeploymentRecord,
    pub files: Vec<DeploymentFileRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentHistoryQuery {
    pub project_id: Option<i64>,
    pub server_id: Option<i64>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub protocol: Option<String>,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub secret: Option<String>,
    pub remote_base_path: Option<String>,
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
    query_servers(&conn, None)
}

pub fn create_server(app: &AppHandle, input: ServerInput) -> Result<ServerRecord, String> {
    validate_server_id(input.id, false)?;
    let name = required_string(input.name, "服务器名称不能为空")?;
    let protocol = required_string(input.protocol, "协议不能为空")?;
    let host = required_string(input.host, "主机不能为空")?;
    let port = input.port.ok_or_else(|| "端口不能为空".to_string())?;
    let username = required_string(input.username, "用户名不能为空")?;
    let auth_type = required_string(input.auth_type, "认证方式不能为空")?;
    let secret = input.secret.ok_or_else(|| "凭据不能为空".to_string())?;
    let remote_base_path = normalize_path(input.remote_base_path.unwrap_or_else(|| "/".into()))?;

    validate_server_values(&protocol, port, &auth_type)?;
    let (credential_ref, cipher) = save_secret(&secret)?;

    let conn = open(app)?;
    let tx = conn.unchecked_transaction().map_err(to_string)?;
    if let Some(cipher) = cipher {
        insert_vault_cipher(&tx, &credential_ref, &cipher)?;
    }
    tx.execute(
            "INSERT INTO servers(name, protocol, host, port, username, auth_type, credential_ref, remote_base_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                name,
                protocol,
                host,
                port,
                username,
                auth_type,
                &credential_ref,
                remote_base_path,
            ],
        )
        .map_err(|err| {
            let _ = delete_secret(&tx, &credential_ref);
            to_string(err)
        })?;

    let id = tx.last_insert_rowid();
    tx.commit().map_err(to_string)?;
    query_server(&conn, id)
}

pub fn update_server(app: &AppHandle, input: ServerInput) -> Result<ServerRecord, String> {
    validate_server_id(input.id, true)?;
    let id = input
        .id
        .ok_or_else(|| "server:update 缺少服务器 id".to_string())?;
    let conn = open(app)?;
    let existing = query_server(&conn, id)?;

    let name = normalize_string(input.name).unwrap_or_else(|| existing.name.clone());
    let protocol = normalize_string(input.protocol).unwrap_or_else(|| existing.protocol.clone());
    let host = normalize_string(input.host).unwrap_or_else(|| existing.host.clone());
    let port = input.port.unwrap_or(existing.port);
    let username = normalize_string(input.username).unwrap_or_else(|| existing.username.clone());
    let auth_type = normalize_string(input.auth_type).unwrap_or_else(|| existing.auth_type.clone());
    let remote_base_path = match input.remote_base_path {
        Some(path) => normalize_path(path)?,
        None => existing.remote_base_path.clone(),
    };

    validate_server_values(&protocol, port, &auth_type)?;
    let next_credential = match input.secret {
        Some(secret) => match save_secret(&secret) {
            Ok((credential_ref, cipher)) => Some((credential_ref, cipher)),
            Err(err) => return Err(format!("凭据保存失败：{err}")),
        },
        None => None,
    };
    let credential_ref = next_credential
        .as_ref()
        .map(|(credential_ref, _)| credential_ref.as_str())
        .unwrap_or(&existing.credential_ref);

    let tx = conn.unchecked_transaction().map_err(to_string)?;
    if let Some((credential_ref, Some(cipher))) = next_credential.as_ref() {
        insert_vault_cipher(&tx, credential_ref, cipher)?;
    }
    let changed = tx
        .execute(
            "UPDATE servers
                SET name = ?1,
                    protocol = ?2,
                    host = ?3,
                    port = ?4,
                    username = ?5,
                    auth_type = ?6,
                    credential_ref = ?7,
                    remote_base_path = ?8
              WHERE id = ?9",
            params![
                name,
                protocol,
                host,
                port,
                username,
                auth_type,
                credential_ref,
                remote_base_path,
                id
            ],
        )
        .map_err(|err| {
            if let Some((ref credential_ref, _)) = next_credential {
                let _ = delete_secret(&tx, credential_ref);
            }
            to_string(err)
        })?;
    if changed == 0 {
        if let Some((ref credential_ref, _)) = next_credential {
            let _ = delete_secret(&tx, credential_ref);
        }
        return Err(format!("服务器不存在: {id}"));
    }
    if next_credential.is_some() {
        let _ = delete_secret(&tx, &existing.credential_ref);
    }
    tx.commit().map_err(to_string)?;
    query_server(&conn, id)
}

pub fn delete_server(app: &AppHandle, id: i64) -> Result<(), String> {
    validate_positive_id(id, "服务器 id 必须是正整数")?;
    let conn = open(app)?;
    let credential_ref = conn
        .query_row(
            "SELECT credential_ref FROM servers WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string)?;

    if let Some(ref credential_ref) = credential_ref {
        delete_secret(&conn, credential_ref)?;
    }
    conn.execute("DELETE FROM servers WHERE id = ?1", params![id])
        .map_err(to_string)?;
    Ok(())
}

pub fn test_server_connection(
    app: &AppHandle,
    id: i64,
) -> Result<transport::TestConnectionResult, String> {
    validate_positive_id(id, "服务器 id 必须是正整数")?;
    let conn = open(app)?;
    let server = match query_server(&conn, id) {
        Ok(server) => server,
        Err(_) => {
            return Ok(transport::failure("服务器不存在"));
        }
    };

    let secret = match read_secret(&conn, &server.credential_ref) {
        Ok(secret) if !secret.is_empty() => secret,
        Ok(_) => {
            return Ok(transport::failure("凭据为空"));
        }
        Err(err) => {
            return Ok(transport::failure(&credential_read_message(&err)));
        }
    };

    let result = transport::test_connection(transport::ConnectionConfig {
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        username: server.username,
        auth_type: server.auth_type,
        secret,
        remote_base_path: server.remote_base_path,
    });
    Ok(result)
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

pub fn get_server(app: &AppHandle, id: i64) -> Result<ServerRecord, String> {
    validate_positive_id(id, "服务器 id 必须是正整数")?;
    let conn = open(app)?;
    query_server(&conn, id)
}

pub fn get_project(app: &AppHandle, id: i64) -> Result<ProjectRecord, String> {
    validate_positive_id(id, "项目 id 必须是正整数")?;
    let conn = open(app)?;
    query_project(&conn, id)
}

pub fn read_server_secret(app: &AppHandle, credential_ref: &str) -> Result<String, String> {
    let conn = open(app)?;
    read_secret(&conn, credential_ref)
}

pub fn create_deployment(
    app: &AppHandle,
    project_id: i64,
    server_id: i64,
    from_commit: Option<&str>,
    to_commit: &str,
    file_count: i64,
) -> Result<i64, String> {
    let conn = open(app)?;
    conn.execute(
        "INSERT INTO deployments(project_id, server_id, from_commit, to_commit, file_count, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
        params![project_id, server_id, from_commit, to_commit, file_count],
    )
    .map_err(to_string)?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_deployment_file(
    app: &AppHandle,
    deployment_id: i64,
    path: &str,
    action: &str,
    status: &str,
) -> Result<(), String> {
    let conn = open(app)?;
    conn.execute(
        "INSERT INTO deployment_files(deployment_id, path, action, status)
         VALUES (?1, ?2, ?3, ?4)",
        params![deployment_id, path, action, status],
    )
    .map_err(to_string)?;
    Ok(())
}

pub fn update_deployment_file_status(
    app: &AppHandle,
    deployment_id: i64,
    path: &str,
    status: &str,
) -> Result<(), String> {
    let conn = open(app)?;
    conn.execute(
        "UPDATE deployment_files SET status = ?1 WHERE deployment_id = ?2 AND path = ?3",
        params![status, deployment_id, path],
    )
    .map_err(to_string)?;
    Ok(())
}

pub fn finish_deployment(
    app: &AppHandle,
    deployment_id: i64,
    status: &str,
    log_path: Option<&str>,
) -> Result<(), String> {
    let conn = open(app)?;
    conn.execute(
        "UPDATE deployments SET status = ?1, log_path = ?2, finished_at = datetime('now') WHERE id = ?3",
        params![status, log_path, deployment_id],
    )
    .map_err(to_string)?;
    Ok(())
}

pub fn list_deployments(
    app: &AppHandle,
    filter: DeploymentHistoryQuery,
) -> Result<Vec<DeploymentRecord>, String> {
    let conn = open(app)?;
    let mut conditions = Vec::new();
    let mut values = Vec::<SqlValue>::new();

    if let Some(project_id) = filter.project_id {
        validate_positive_id(project_id, "项目 id 必须是正整数")?;
        conditions.push("project_id = ?".to_string());
        values.push(SqlValue::Integer(project_id));
    }
    if let Some(server_id) = filter.server_id {
        validate_positive_id(server_id, "服务器 id 必须是正整数")?;
        conditions.push("server_id = ?".to_string());
        values.push(SqlValue::Integer(server_id));
    }
    if let Some(status) = filter.status {
        validate_deploy_status(&status)?;
        conditions.push("status = ?".to_string());
        values.push(SqlValue::Text(status));
    }

    let limit = filter.limit.unwrap_or(100).clamp(1, 500);
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    values.push(SqlValue::Integer(limit));
    let sql = format!(
        "SELECT id, project_id, server_id, from_commit, to_commit, file_count, status, log_path, started_at, finished_at
         FROM deployments{where_clause}
         ORDER BY id DESC
         LIMIT ?"
    );
    let mut stmt = conn.prepare(&sql).map_err(to_string)?;
    let rows = stmt
        .query_map(params_from_iter(values.iter()), deployment_from_row)
        .map_err(to_string)?;
    collect_rows(rows)
}

pub fn get_deployment(app: &AppHandle, id: i64) -> Result<DeploymentRecord, String> {
    validate_positive_id(id, "部署 id 必须是正整数")?;
    let conn = open(app)?;
    conn.query_row(
        "SELECT id, project_id, server_id, from_commit, to_commit, file_count, status, log_path, started_at, finished_at
         FROM deployments WHERE id = ?1",
        params![id],
        deployment_from_row,
    )
    .optional()
    .map_err(to_string)?
    .ok_or_else(|| format!("部署记录不存在: #{id}"))
}

pub fn get_deployment_detail(app: &AppHandle, id: i64) -> Result<DeploymentDetail, String> {
    let record = get_deployment(app, id)?;
    let conn = open(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT path, action, status, size
             FROM deployment_files
             WHERE deployment_id = ?1
             ORDER BY path",
        )
        .map_err(to_string)?;
    let rows = stmt
        .query_map(params![id], |row| {
            Ok(DeploymentFileRecord {
                path: row.get(0)?,
                action: row.get(1)?,
                status: row.get(2)?,
                size: row.get(3)?,
            })
        })
        .map_err(to_string)?;
    Ok(DeploymentDetail {
        record,
        files: collect_rows(rows)?,
    })
}

fn query_servers(conn: &Connection, id: Option<i64>) -> Result<Vec<ServerRecord>, String> {
    let sql = match id {
        Some(_) => {
            "SELECT id, name, protocol, host, port, username, auth_type, credential_ref, remote_base_path, created_at
             FROM servers WHERE id = ?1 ORDER BY id DESC"
        }
        None => {
            "SELECT id, name, protocol, host, port, username, auth_type, credential_ref, remote_base_path, created_at
             FROM servers ORDER BY id DESC"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(to_string)?;
    let rows = match id {
        Some(server_id) => stmt
            .query_map(params![server_id], server_from_row)
            .map_err(to_string)?,
        None => stmt.query_map([], server_from_row).map_err(to_string)?,
    };
    collect_rows(rows)
}

fn query_server(conn: &Connection, id: i64) -> Result<ServerRecord, String> {
    let mut servers = query_servers(conn, Some(id))?;
    servers.pop().ok_or_else(|| format!("服务器不存在: {id}"))
}

fn save_secret(secret: &str) -> Result<(String, Option<Vec<u8>>), String> {
    let credential_ref = security::new_credential_ref();
    let cipher = security::protect_secret(&credential_ref, secret)?;
    Ok((credential_ref, Some(cipher)))
}

fn read_secret(conn: &Connection, credential_ref: &str) -> Result<String, String> {
    if security::is_managed_ref(credential_ref) {
        let cipher = conn
            .query_row(
                "SELECT cipher FROM credential_vault WHERE ref = ?1",
                params![credential_ref],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(to_string)?
            .ok_or_else(|| format!("Credential not found: {credential_ref}"))?;
        return security::unprotect_secret(credential_ref, &cipher);
    }

    Err("该凭据来自旧版系统钥匙串引用，请重新填写密码/私钥并保存".into())
}

fn insert_vault_cipher(
    conn: &Connection,
    credential_ref: &str,
    cipher: &[u8],
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO credential_vault(ref, cipher) VALUES (?1, ?2)",
        params![credential_ref, cipher],
    )
    .map_err(to_string)?;
    Ok(())
}

fn delete_secret(conn: &Connection, credential_ref: &str) -> Result<(), String> {
    let _ = security::delete_platform_secret(credential_ref);
    conn.execute(
        "DELETE FROM credential_vault WHERE ref = ?1",
        params![credential_ref],
    )
    .map_err(to_string)?;
    Ok(())
}

fn server_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ServerRecord> {
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
        return Ok(repo_root()?.join(".local-data").join("selfdeploy.sqlite"));
    }

    let data_dir = app.path().app_data_dir().map_err(to_string)?;
    Ok(data_dir.join("selfdeploy.sqlite"))
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|packages_dir| packages_dir.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "无法解析仓库根目录".to_string())
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

        CREATE TABLE IF NOT EXISTS credential_vault (
          ref TEXT PRIMARY KEY,
          cipher BLOB NOT NULL
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

fn deployment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeploymentRecord> {
    Ok(DeploymentRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        server_id: row.get(2)?,
        from_commit: row.get(3)?,
        to_commit: row.get(4)?,
        file_count: row.get(5)?,
        status: row.get(6)?,
        log_path: row.get(7)?,
        started_at: row.get(8)?,
        finished_at: row.get(9)?,
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

fn validate_server_id(id: Option<i64>, require_id: bool) -> Result<(), String> {
    if require_id && id.filter(|value| *value > 0).is_none() {
        return Err("服务器 id 必须是正整数".into());
    }
    if !require_id && id.is_some() {
        return Err("server:create 不应传入服务器 id".into());
    }
    Ok(())
}

fn validate_positive_id(id: i64, message: &str) -> Result<(), String> {
    if id <= 0 {
        return Err(message.into());
    }
    Ok(())
}

fn validate_server_values(protocol: &str, port: i64, auth_type: &str) -> Result<(), String> {
    if !matches!(protocol, "sftp" | "ftp") {
        return Err("协议必须是 sftp 或 ftp".into());
    }
    if !(1..=65535).contains(&port) {
        return Err("端口必须在 1-65535 之间".into());
    }
    if !matches!(auth_type, "password" | "privateKey") {
        return Err("认证方式必须是 password 或 privateKey".into());
    }
    Ok(())
}

fn validate_deploy_status(status: &str) -> Result<(), String> {
    if !matches!(
        status,
        "pending" | "running" | "success" | "failed" | "rolledback"
    ) {
        return Err("部署状态不合法".into());
    }
    Ok(())
}

fn required_string(value: Option<String>, message: &str) -> Result<String, String> {
    normalize_string(value).ok_or_else(|| message.to_string())
}

fn normalize_string(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_path(value: String) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err("远端基路径不能为空".into());
    }
    Ok(trimmed)
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

fn credential_read_message(err: &str) -> String {
    if err.contains("No matching entry") || err.contains("NoEntry") {
        return "凭据不存在或已被系统钥匙串清理；请编辑该服务器，重新填写密码/私钥并保存后再测试连接".into();
    }
    format!("凭据读取失败：{err}")
}

fn to_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}
