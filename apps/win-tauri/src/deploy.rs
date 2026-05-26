use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    db::{self, DeploymentHistoryQuery, ProjectRecord, ServerRecord},
    git::{self, ChangedFile, FileAction},
    transport::{ConnectionConfig, RemoteClient},
};

const DEPLOY_ON_LOG: &str = "deploy:onLog";
const UPLOAD_CONCURRENCY: usize = 4;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRunInput {
    project_id: i64,
    server_id: i64,
    source: Option<DeploySource>,
    from_commit: Option<String>,
    to_commit: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum DeploySource {
    Git {
        #[serde(rename = "fromCommit")]
        from_commit: Option<String>,
        #[serde(rename = "toCommit")]
        to_commit: String,
    },
    Folder {
        #[serde(rename = "sourceDir")]
        source_dir: String,
        #[serde(default)]
        #[serde(rename = "targetSubDir")]
        target_sub_dir: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFolderInput {
    project_id: i64,
    #[serde(default)]
    source_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    deployment_id: i64,
    status: String,
    file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployLogEvent {
    deployment_id: i64,
    level: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<DeployProgress>,
    timestamp: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployProgress {
    done: usize,
    total: usize,
}

#[derive(Clone)]
enum FileSource {
    Git {
        commit: String,
        prefer_worktree: bool,
    },
    Folder {
        root: PathBuf,
    },
}

struct IgnoreFilter {
    matcher: Gitignore,
    rule_count: usize,
}

enum ExecutionMode {
    Deploy,
    Rollback { origin_deployment_id: i64 },
}

pub fn scan_folder(app: &AppHandle, input: ScanFolderInput) -> Result<Vec<ChangedFile>, String> {
    let project = db::get_project(app, input.project_id)?;
    scan_project_folder(&project, &input.source_dir)
}

pub fn run(app: &AppHandle, input: DeployRunInput) -> Result<DeployResult, String> {
    let project = db::get_project(app, input.project_id)?;
    let server = db::get_server(app, input.server_id)?;
    let source = normalize_source(input)?;

    match source {
        DeploySource::Git {
            from_commit,
            to_commit,
        } => {
            let changes = git::diff(&project.local_path, from_commit.as_deref(), &to_commit)?;
            let source_commit = to_commit.clone();
            execute_deployment(
                app,
                &project,
                &server,
                from_commit.as_deref(),
                &to_commit,
                changes,
                FileSource::Git {
                    commit: source_commit,
                    prefer_worktree: true,
                },
                ExecutionMode::Deploy,
                "",
            )
        }
        DeploySource::Folder {
            source_dir,
            target_sub_dir,
        } => {
            let root = folder_root(&project.local_path, &source_dir)?;
            let changes = scan_project_folder(&project, &source_dir)?;
            let label = if source_dir.trim().is_empty() {
                "."
            } else {
                source_dir.trim()
            };
            let target_label = normalize_sub_dir(&target_sub_dir);
            let suffix = if target_label.is_empty() {
                String::new()
            } else {
                format!(" -> {target_label}")
            };
            let marker = format!("folder:{label}{suffix}@{}", now_timestamp());
            execute_deployment(
                app,
                &project,
                &server,
                None,
                &marker,
                changes,
                FileSource::Folder { root },
                ExecutionMode::Deploy,
                &target_label,
            )
        }
    }
}

pub fn history(app: &AppHandle, raw: Option<Value>) -> Result<Vec<db::DeploymentRecord>, String> {
    let query = match raw {
        Some(Value::Number(number)) => DeploymentHistoryQuery {
            project_id: number.as_i64(),
            server_id: None,
            status: None,
            limit: None,
        },
        Some(value @ Value::Object(_)) => serde_json::from_value(value)
            .map_err(|err| format!("deploy:history 入参错误：{err}"))?,
        Some(Value::Null) | None => DeploymentHistoryQuery {
            project_id: None,
            server_id: None,
            status: None,
            limit: None,
        },
        Some(_) => return Err("deploy:history 入参必须是筛选对象或项目 id".into()),
    };
    db::list_deployments(app, query)
}

pub fn detail(app: &AppHandle, id: i64) -> Result<db::DeploymentDetail, String> {
    db::get_deployment_detail(app, id)
}

pub fn log(app: &AppHandle, id: i64) -> Result<DeployLogContent, String> {
    let record = db::get_deployment(app, id)?;
    let Some(path) = record.log_path else {
        return Ok(DeployLogContent {
            path: None,
            content: String::new(),
        });
    };
    let mut file = fs::File::open(&path).map_err(|err| format!("无法读取日志文件：{err}"))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|err| format!("无法读取日志文件：{err}"))?;
    Ok(DeployLogContent {
        path: Some(path),
        content,
    })
}

pub fn rollback(app: &AppHandle, origin_deployment_id: i64) -> Result<DeployResult, String> {
    let origin = db::get_deployment(app, origin_deployment_id)?;
    if origin.status != "success" {
        return Err(format!(
            "仅成功状态的部署可回滚，当前状态：{}",
            origin.status
        ));
    }
    if origin.to_commit.starts_with("folder:") {
        return Err("本地文件夹模式部署不支持回滚（无前置版本快照）".into());
    }
    let from_commit = origin
        .from_commit
        .clone()
        .ok_or_else(|| "该部署是首次部署（无 fromCommit），无法回滚到上一状态".to_string())?;
    let project = db::get_project(app, origin.project_id)?;
    let server = db::get_server(app, origin.server_id)?;
    let changes = git::diff(&project.local_path, Some(&origin.to_commit), &from_commit)?;
    let source_commit = from_commit.clone();
    execute_deployment(
        app,
        &project,
        &server,
        Some(&origin.to_commit),
        &from_commit,
        changes,
        FileSource::Git {
            commit: source_commit,
            prefer_worktree: false,
        },
        ExecutionMode::Rollback {
            origin_deployment_id,
        },
        "",
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployLogContent {
    path: Option<String>,
    content: String,
}

fn execute_deployment(
    app: &AppHandle,
    project: &ProjectRecord,
    server: &ServerRecord,
    from_commit: Option<&str>,
    to_commit: &str,
    changes: Vec<ChangedFile>,
    file_source: FileSource,
    mode: ExecutionMode,
    target_sub_dir: &str,
) -> Result<DeployResult, String> {
    let filter = load_ignore_filter(project)?;
    let kept: Vec<ChangedFile> = changes
        .into_iter()
        .filter(|change| !is_ignored(change, &filter))
        .collect();
    let file_count = kept.len();
    let (success_status, action_word) = execution_labels(&mode);
    let deployment_id = db::create_deployment(
        app,
        project.id,
        server.id,
        from_commit,
        to_commit,
        file_count as i64,
    )?;
    let log_path = create_log_path(app, deployment_id)?;
    for change in &kept {
        db::insert_deployment_file(
            app,
            deployment_id,
            &change.path,
            action_name(change.action),
            "pending",
        )?;
    }

    emit_log(
        app,
        deployment_id,
        &log_path,
        "info",
        &start_message(&mode, deployment_id, file_count),
        None,
    );
    if filter.rule_count > 0 {
        emit_log(
            app,
            deployment_id,
            &log_path,
            "info",
            &format!(
                "已加载忽略规则 {} 条（excludePatterns + .deployignore）",
                filter.rule_count
            ),
            None,
        );
    }

    if file_count == 0 {
        db::finish_deployment(
            app,
            deployment_id,
            success_status,
            Some(&path_to_string(&log_path)),
        )?;
        emit_log(
            app,
            deployment_id,
            &log_path,
            "info",
            &format!("无变更，{action_word}完成"),
            None,
        );
        return Ok(DeployResult {
            deployment_id,
            status: success_status.into(),
            file_count,
            message: None,
        });
    }

    let deploy_result = deploy_files(
        app,
        deployment_id,
        &log_path,
        project,
        server,
        &kept,
        file_source,
        matches!(mode, ExecutionMode::Rollback { .. }),
        target_sub_dir,
    );

    match deploy_result {
        Ok(()) => {
            db::finish_deployment(
                app,
                deployment_id,
                success_status,
                Some(&path_to_string(&log_path)),
            )?;
            emit_log(
                app,
                deployment_id,
                &log_path,
                "info",
                &format!("{action_word} #{deployment_id} 成功"),
                None,
            );
            Ok(DeployResult {
                deployment_id,
                status: success_status.into(),
                file_count,
                message: None,
            })
        }
        Err(err) => {
            db::finish_deployment(
                app,
                deployment_id,
                "failed",
                Some(&path_to_string(&log_path)),
            )?;
            emit_log(
                app,
                deployment_id,
                &log_path,
                "error",
                &format!("{action_word}失败：{err}"),
                None,
            );
            Ok(DeployResult {
                deployment_id,
                status: "failed".into(),
                file_count,
                message: Some(err),
            })
        }
    }
}

fn deploy_files(
    app: &AppHandle,
    deployment_id: i64,
    log_path: &Path,
    project: &ProjectRecord,
    server: &ServerRecord,
    changes: &[ChangedFile],
    file_source: FileSource,
    force_git_blob: bool,
    target_sub_dir: &str,
) -> Result<(), String> {
    let secret = db::read_server_secret(app, &server.credential_ref)?;
    let cfg = ConnectionConfig {
        protocol: server.protocol.clone(),
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        auth_type: server.auth_type.clone(),
        secret,
        remote_base_path: server.remote_base_path.clone(),
    };
    let mut client = RemoteClient::connect(&cfg)?;
    let deploy_root = join_remote(&[&server.remote_base_path, &project.remote_path]);
    let target_root = if target_sub_dir.is_empty() {
        deploy_root.clone()
    } else {
        join_remote(&[&deploy_root, target_sub_dir])
    };
    let tmp_root = join_remote(&[&deploy_root, &format!(".deploy-tmp-{deployment_id}")]);

    emit_log(
        app,
        deployment_id,
        log_path,
        "info",
        &format!(
            "连接 {} {}:{}",
            server.protocol.to_uppercase(),
            server.host,
            server.port
        ),
        None,
    );
    emit_log(
        app,
        deployment_id,
        log_path,
        "info",
        &format!("部署目标根路径 {deploy_root}"),
        None,
    );
    run_hook(
        app,
        deployment_id,
        log_path,
        project,
        "前",
        project.pre_deploy_cmd.as_deref(),
        true,
    )?;

    client.mkdirp(&tmp_root)?;

    let to_upload: Vec<&ChangedFile> = changes
        .iter()
        .filter(|change| change.action != FileAction::Delete)
        .collect();
    upload_files(
        app,
        deployment_id,
        log_path,
        project,
        &cfg,
        &to_upload,
        &file_source,
        force_git_blob,
        &tmp_root,
    )?;

    emit_log(
        app,
        deployment_id,
        log_path,
        "info",
        "上传完成，开始切换",
        None,
    );
    for change in &to_upload {
        let tmp_remote = join_remote(&[&tmp_root, &change.path]);
        let target = join_remote(&[&target_root, &change.path]);
        client.remove_file(&target);
        client.rename(&tmp_remote, &target)?;
        db::update_deployment_file_status(app, deployment_id, &change.path, "success")?;
    }

    for change in changes {
        if change.action == FileAction::Delete {
            let target = join_remote(&[&target_root, &change.path]);
            client.remove_file(&target);
            db::update_deployment_file_status(app, deployment_id, &change.path, "success")?;
        }
        if change.action == FileAction::Rename {
            if let Some(old_path) = &change.old_path {
                client.remove_file(&join_remote(&[&target_root, old_path]));
            }
        }
    }

    client.remove_dir_all(&tmp_root);

    run_hook(
        app,
        deployment_id,
        log_path,
        project,
        "后",
        project.post_deploy_cmd.as_deref(),
        false,
    )?;
    client.quit();
    Ok(())
}

fn upload_files(
    app: &AppHandle,
    deployment_id: i64,
    log_path: &Path,
    project: &ProjectRecord,
    cfg: &ConnectionConfig,
    to_upload: &[&ChangedFile],
    file_source: &FileSource,
    force_git_blob: bool,
    tmp_root: &str,
) -> Result<(), String> {
    if to_upload.is_empty() {
        return Ok(());
    }

    let total = to_upload.len();
    let workers = UPLOAD_CONCURRENCY.min(total).max(1);
    emit_log(
        app,
        deployment_id,
        log_path,
        "info",
        &format!("开始上传（并发 {workers}）"),
        None,
    );

    let queue = Arc::new(Mutex::new(
        to_upload
            .iter()
            .map(|change| (*change).clone())
            .collect::<VecDeque<_>>(),
    ));
    let done = Arc::new(AtomicUsize::new(0));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));

    thread::scope(|scope| {
        for _ in 0..workers {
            let app = app.clone();
            let cfg = cfg.clone();
            let project = project.clone();
            let file_source = file_source.clone();
            let log_path = log_path.to_path_buf();
            let queue = Arc::clone(&queue);
            let done = Arc::clone(&done);
            let errors = Arc::clone(&errors);
            let tmp_root = tmp_root.to_string();

            scope.spawn(move || {
                let mut client = match RemoteClient::connect(&cfg) {
                    Ok(client) => client,
                    Err(err) => {
                        errors.lock().expect("error mutex").push(err);
                        return;
                    }
                };
                loop {
                    let next = {
                        let mut queue = queue.lock().expect("queue mutex");
                        queue.pop_front()
                    };
                    let Some(change) = next else {
                        break;
                    };
                    if let Err(err) = upload_one(
                        &mut client,
                        &project,
                        &file_source,
                        force_git_blob,
                        &tmp_root,
                        &change,
                    ) {
                        errors
                            .lock()
                            .expect("error mutex")
                            .push(format!("上传 {} 失败：{err}", change.path));
                        break;
                    }
                    let current = done.fetch_add(1, Ordering::SeqCst) + 1;
                    emit_log(
                        &app,
                        deployment_id,
                        &log_path,
                        "info",
                        &format!("上传 {}", change.path),
                        Some(DeployProgress {
                            done: current,
                            total,
                        }),
                    );
                }
                client.quit();
            });
        }
    });

    let errors = errors.lock().expect("error mutex");
    if let Some(err) = errors.first() {
        return Err(err.clone());
    }
    Ok(())
}

fn upload_one(
    client: &mut RemoteClient,
    project: &ProjectRecord,
    file_source: &FileSource,
    force_git_blob: bool,
    tmp_root: &str,
    change: &ChangedFile,
) -> Result<(), String> {
    let tmp_remote = join_remote(&[tmp_root, &change.path]);
    match file_source {
        FileSource::Folder { root } => {
            let local = root.join(path_from_remote(&change.path));
            client.put_file(&local, &tmp_remote)
        }
        FileSource::Git {
            commit,
            prefer_worktree,
        } => {
            let local = Path::new(&project.local_path).join(path_from_remote(&change.path));
            if *prefer_worktree && !force_git_blob && local.is_file() {
                client.put_file(&local, &tmp_remote)
            } else {
                let bytes = git::file_bytes(&project.local_path, commit, &change.path)?;
                client.put_bytes(&bytes, &tmp_remote)
            }
        }
    }
}

fn run_hook(
    app: &AppHandle,
    deployment_id: i64,
    log_path: &Path,
    project: &ProjectRecord,
    label: &str,
    cmd: Option<&str>,
    fail_on_error: bool,
) -> Result<(), String> {
    let Some(cmd) = cmd.map(str::trim).filter(|cmd| !cmd.is_empty()) else {
        return Ok(());
    };
    emit_log(
        app,
        deployment_id,
        log_path,
        "info",
        &format!("执行部署{label}命令：{cmd}"),
        None,
    );

    let output = shell_command(cmd, &project.local_path)
        .output()
        .map_err(to_string)?;
    emit_hook_output(
        app,
        deployment_id,
        log_path,
        label,
        "stdout",
        &output.stdout,
    );
    emit_hook_output(
        app,
        deployment_id,
        log_path,
        label,
        "stderr",
        &output.stderr,
    );
    if !output.status.success() {
        let msg = format!(
            "部署{label}命令非零退出（{}）",
            output.status.code().unwrap_or(-1)
        );
        if fail_on_error {
            return Err(msg);
        }
        emit_log(app, deployment_id, log_path, "warn", &msg, None);
    }
    Ok(())
}

fn shell_command(cmd: &str, cwd: &str) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c", cmd]).current_dir(cwd);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("sh");
        command.args(["-c", cmd]).current_dir(cwd);
        command
    }
}

fn emit_hook_output(
    app: &AppHandle,
    deployment_id: i64,
    log_path: &Path,
    label: &str,
    channel: &str,
    bytes: &[u8],
) {
    for line in String::from_utf8_lossy(bytes).lines() {
        if line.trim().is_empty() {
            continue;
        }
        let level = if channel == "stderr" { "warn" } else { "info" };
        emit_log(
            app,
            deployment_id,
            log_path,
            level,
            &format!("[{label}] {line}"),
            None,
        );
    }
}

fn normalize_source(input: DeployRunInput) -> Result<DeploySource, String> {
    if let Some(source) = input.source {
        return Ok(source);
    }
    let to_commit = input
        .to_commit
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "缺少 source 或 toCommit".to_string())?;
    Ok(DeploySource::Git {
        from_commit: input.from_commit,
        to_commit,
    })
}

fn execution_labels(mode: &ExecutionMode) -> (&'static str, &'static str) {
    match mode {
        ExecutionMode::Deploy => ("success", "部署"),
        ExecutionMode::Rollback { .. } => ("rolledback", "回滚"),
    }
}

fn start_message(mode: &ExecutionMode, deployment_id: i64, file_count: usize) -> String {
    match mode {
        ExecutionMode::Deploy => format!("开始部署 #{deployment_id}，变更文件 {file_count} 个"),
        ExecutionMode::Rollback {
            origin_deployment_id,
        } => format!(
            "回滚 #{origin_deployment_id} -> 新建回滚部署 #{deployment_id}，反向变更 {file_count} 个"
        ),
    }
}

fn scan_project_folder(
    project: &ProjectRecord,
    source_dir: &str,
) -> Result<Vec<ChangedFile>, String> {
    let root = folder_root(&project.local_path, source_dir)?;
    let filter = load_ignore_filter(project)?;
    let mut files = Vec::new();
    collect_folder_files(&root, &root, &filter, &mut files)?;
    Ok(files)
}

fn collect_folder_files(
    root: &Path,
    dir: &Path,
    filter: &IgnoreFilter,
    files: &mut Vec<ChangedFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(to_string)? {
        let entry = entry.map_err(to_string)?;
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy() == ".git" {
            continue;
        }
        let meta = entry.metadata().map_err(to_string)?;
        let rel = path
            .strip_prefix(root)
            .map_err(to_string)?
            .to_string_lossy()
            .replace('\\', "/");
        if meta.is_dir() {
            if !filter.ignores(&format!("{rel}/"), true) {
                collect_folder_files(root, &path, filter, files)?;
            }
        } else if meta.is_file() {
            if !filter.ignores(&rel, false) {
                files.push(ChangedFile {
                    path: rel,
                    action: FileAction::Add,
                    old_path: None,
                });
            }
        }
    }
    Ok(())
}

fn folder_root(project_path: &str, source_dir: &str) -> Result<PathBuf, String> {
    let base = Path::new(project_path);
    let root = if source_dir.trim().is_empty() || source_dir.trim() == "." {
        base.to_path_buf()
    } else {
        base.join(source_dir)
    };
    if !root.is_dir() {
        return Err(format!("本地文件夹不存在：{}", root.to_string_lossy()));
    }
    Ok(root)
}

fn load_ignore_filter(project: &ProjectRecord) -> Result<IgnoreFilter, String> {
    let mut builder = GitignoreBuilder::new(&project.local_path);
    let mut rule_count = 0;

    for pattern in &project.exclude_patterns {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            continue;
        }
        builder
            .add_line(None, pattern)
            .map_err(|err| format!("excludePatterns 规则错误：{err}"))?;
        rule_count += 1;
    }

    let deployignore = Path::new(&project.local_path).join(".deployignore");
    if deployignore.is_file() {
        if let Some(err) = builder.add(&deployignore) {
            return Err(format!(".deployignore 规则错误：{err}"));
        }
        let text = fs::read_to_string(&deployignore).map_err(to_string)?;
        rule_count += text
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty() && !trimmed.starts_with('#')
            })
            .count();
    }

    Ok(IgnoreFilter {
        matcher: builder.build().map_err(to_string)?,
        rule_count,
    })
}

impl IgnoreFilter {
    fn ignores(&self, rel_path: &str, is_dir: bool) -> bool {
        let norm = rel_path.replace('\\', "/");
        if norm.is_empty() {
            return false;
        }
        self.matcher
            .matched_path_or_any_parents(Path::new(norm.trim_end_matches('/')), is_dir)
            .is_ignore()
    }
}

fn is_ignored(change: &ChangedFile, filter: &IgnoreFilter) -> bool {
    filter.ignores(&change.path, false)
        || (change.action == FileAction::Rename
            && change
                .old_path
                .as_ref()
                .map(|old| filter.ignores(old, false))
                .unwrap_or(false))
}

fn join_remote(parts: &[&str]) -> String {
    let mut out = String::new();
    for part in parts {
        let cleaned = part.replace('\\', "/");
        let cleaned = cleaned.trim_matches('/');
        if cleaned.is_empty() {
            continue;
        }
        out.push('/');
        out.push_str(cleaned);
    }
    if out.is_empty() {
        "/".into()
    } else {
        out
    }
}

fn normalize_sub_dir(input: &str) -> String {
    input
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .trim()
        .to_string()
}

fn path_from_remote(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn action_name(action: FileAction) -> &'static str {
    match action {
        FileAction::Add => "ADD",
        FileAction::Modify => "MODIFY",
        FileAction::Delete => "DELETE",
        FileAction::Rename => "RENAME",
    }
}

fn create_log_path(app: &AppHandle, deployment_id: i64) -> Result<PathBuf, String> {
    let dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "无法解析仓库根目录".to_string())?
            .join(".local-data")
            .join("deploy-logs")
    } else {
        app.path()
            .app_data_dir()
            .map_err(to_string)?
            .join("deploy-logs")
    };
    fs::create_dir_all(&dir).map_err(to_string)?;
    Ok(dir.join(format!("{deployment_id}.log")))
}

fn emit_log(
    app: &AppHandle,
    deployment_id: i64,
    log_path: &Path,
    level: &str,
    message: &str,
    progress: Option<DeployProgress>,
) {
    let evt = DeployLogEvent {
        deployment_id,
        level: level.into(),
        message: message.into(),
        progress,
        timestamp: now_timestamp(),
    };
    append_log(log_path, &evt);
    let _ = app.emit(DEPLOY_ON_LOG, evt);
}

fn append_log(path: &Path, evt: &DeployLogEvent) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let progress = evt
            .progress
            .as_ref()
            .map(|p| format!(" [{}/{}]", p.done, p.total))
            .unwrap_or_default();
        let _ = writeln!(
            file,
            "[{}] {}{} {}",
            evt.timestamp,
            evt.level.to_uppercase(),
            progress,
            evt.message
        );
    }
}

fn now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn to_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn joins_remote_paths() {
        assert_eq!(join_remote(&["/upload/", "/app"]), "/upload/app");
        assert_eq!(join_remote(&["/", "app/a.txt"]), "/app/a.txt");
    }

    #[test]
    fn matches_simple_excludes() {
        let mut builder = GitignoreBuilder::new(".");
        builder.add_line(None, "dist/").expect("dist rule");
        builder.add_line(None, "*.test.ts").expect("glob rule");
        builder
            .add_line(None, "!src/keep.test.ts")
            .expect("negation rule");
        let filter = IgnoreFilter {
            matcher: builder.build().expect("build ignore"),
            rule_count: 3,
        };

        assert!(filter.ignores("dist/app.js", false));
        assert!(filter.ignores("src/app.test.ts", false));
        assert!(!filter.ignores("src/app.ts", false));
        assert!(!filter.ignores("src/keep.test.ts", false));
    }

    #[test]
    fn parses_frontend_deploy_run_payload() {
        let input: DeployRunInput = serde_json::from_value(json!({
            "projectId": 1,
            "serverId": 2,
            "source": {
                "type": "git",
                "fromCommit": null,
                "toCommit": "HEAD"
            }
        }))
        .expect("deploy payload should parse");

        assert_eq!(input.project_id, 1);
        assert_eq!(input.server_id, 2);
        match input.source.expect("source") {
            DeploySource::Git {
                from_commit,
                to_commit,
            } => {
                assert!(from_commit.is_none());
                assert_eq!(to_commit, "HEAD");
            }
            DeploySource::Folder { .. } => panic!("expected git source"),
        }
    }

    #[test]
    fn parses_frontend_folder_source_payload() {
        let input: DeployRunInput = serde_json::from_value(json!({
            "projectId": 1,
            "serverId": 2,
            "source": {
                "type": "folder",
                "sourceDir": "dist",
                "targetSubDir": "web"
            }
        }))
        .expect("folder deploy payload should parse");

        match input.source.expect("source") {
            DeploySource::Folder {
                source_dir,
                target_sub_dir,
            } => {
                assert_eq!(source_dir, "dist");
                assert_eq!(target_sub_dir, "web");
            }
            DeploySource::Git { .. } => panic!("expected folder source"),
        }
    }
}
