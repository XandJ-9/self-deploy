use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    db::{self, ProjectInput, ServerInput},
    deploy::{self, DeployRunInput, ScanFolderInput},
    git,
};

const SERVER_LIST: &str = "server:list";
const SERVER_CREATE: &str = "server:create";
const SERVER_UPDATE: &str = "server:update";
const SERVER_DELETE: &str = "server:delete";
const SERVER_TEST: &str = "server:test";
const PROJECT_LIST: &str = "project:list";
const PROJECT_CREATE: &str = "project:create";
const PROJECT_UPDATE: &str = "project:update";
const PROJECT_DELETE: &str = "project:delete";
const GIT_LIST_COMMITS: &str = "git:listCommits";
const GIT_DIFF: &str = "git:diff";
const GIT_STATUS: &str = "git:status";
const DEPLOY_SCAN_FOLDER: &str = "deploy:scanFolder";
const DEPLOY_RUN: &str = "deploy:run";
const DEPLOY_HISTORY: &str = "deploy:history";
const DEPLOY_DETAIL: &str = "deploy:detail";
const DEPLOY_ROLLBACK: &str = "deploy:rollback";
const DEPLOY_LOG: &str = "deploy:log";

#[tauri::command]
pub fn invoke_channel(app: AppHandle, channel: String, args: Vec<Value>) -> Result<Value, String> {
    match channel.as_str() {
        SERVER_LIST => Ok(json!(db::list_servers(&app)?)),
        SERVER_CREATE => {
            let input = parse_first::<ServerInput>(&args, SERVER_CREATE)?;
            Ok(json!(db::create_server(&app, input)?))
        }
        SERVER_UPDATE => {
            let input = parse_first::<ServerInput>(&args, SERVER_UPDATE)?;
            Ok(json!(db::update_server(&app, input)?))
        }
        SERVER_DELETE => {
            let id = parse_positive_id(&args, SERVER_DELETE, "服务器 id")?;
            db::delete_server(&app, id)?;
            Ok(Value::Null)
        }
        SERVER_TEST => {
            let id = parse_positive_id(&args, SERVER_TEST, "服务器 id")?;
            Ok(json!(db::test_server_connection(&app, id)?))
        }
        PROJECT_LIST => Ok(json!(db::list_projects(&app)?)),
        PROJECT_CREATE => {
            let input = parse_first::<ProjectInput>(&args, PROJECT_CREATE)?;
            Ok(json!(db::create_project(&app, input)?))
        }
        PROJECT_UPDATE => {
            let input = parse_first::<ProjectInput>(&args, PROJECT_UPDATE)?;
            Ok(json!(db::update_project(&app, input)?))
        }
        PROJECT_DELETE => {
            let id = parse_positive_id(&args, PROJECT_DELETE, "项目 id")?;
            db::delete_project(&app, id)?;
            Ok(Value::Null)
        }
        GIT_LIST_COMMITS => {
            let repo_path = parse_string_arg(&args, 0, GIT_LIST_COMMITS, "仓库路径")?;
            let limit = args.get(1).and_then(Value::as_i64).unwrap_or(50);
            Ok(json!(git::list_commits(&repo_path, limit)?))
        }
        GIT_DIFF => {
            let repo_path = parse_string_arg(&args, 0, GIT_DIFF, "仓库路径")?;
            let from = parse_optional_string_arg(&args, 1);
            let to = parse_string_arg(&args, 2, GIT_DIFF, "目标提交")?;
            Ok(json!(git::diff(&repo_path, from.as_deref(), &to)?))
        }
        GIT_STATUS => {
            let repo_path = parse_string_arg(&args, 0, GIT_STATUS, "仓库路径")?;
            Ok(json!(git::status(&repo_path)?))
        }
        DEPLOY_SCAN_FOLDER => {
            let input = parse_first::<ScanFolderInput>(&args, DEPLOY_SCAN_FOLDER)?;
            Ok(json!(deploy::scan_folder(&app, input)?))
        }
        DEPLOY_RUN => {
            let input = parse_first::<DeployRunInput>(&args, DEPLOY_RUN)?;
            Ok(json!(deploy::run(&app, input)?))
        }
        DEPLOY_HISTORY => Ok(json!(deploy::history(&app, args.first().cloned())?)),
        DEPLOY_DETAIL => {
            let id = parse_positive_id(&args, DEPLOY_DETAIL, "部署 id")?;
            Ok(json!(deploy::detail(&app, id)?))
        }
        DEPLOY_ROLLBACK => {
            let id = parse_positive_id(&args, DEPLOY_ROLLBACK, "部署 id")?;
            Ok(json!(deploy::rollback(&app, id)?))
        }
        DEPLOY_LOG => {
            let id = parse_positive_id(&args, DEPLOY_LOG, "部署 id")?;
            Ok(json!(deploy::log(&app, id)?))
        }
        _ => Err(format!(
            "Tauri 后端尚未实现 channel: {channel}，args: {}",
            Value::Array(args)
        )),
    }
}

fn parse_first<T>(args: &[Value], channel: &str) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let value = args
        .first()
        .ok_or_else(|| format!("{channel} 缺少入参"))?
        .clone();
    serde_json::from_value(value).map_err(|err| format!("{channel} 入参错误：{err}"))
}

fn parse_positive_id(args: &[Value], channel: &str, label: &str) -> Result<i64, String> {
    let value = args
        .first()
        .ok_or_else(|| format!("{channel} 缺少{label}"))?;
    value
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or_else(|| format!("{channel} 需要正整数{label}"))
}

fn parse_string_arg(
    args: &[Value],
    index: usize,
    channel: &str,
    label: &str,
) -> Result<String, String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{channel} 缺少{label}"))
}

fn parse_optional_string_arg(args: &[Value], index: usize) -> Option<String> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
