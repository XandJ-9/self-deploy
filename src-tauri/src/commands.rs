use serde_json::{json, Value};
use tauri::AppHandle;

use crate::db::{self, ProjectInput};

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
const DEPLOY_SCAN_FOLDER: &str = "deploy:scanFolder";
const DEPLOY_HISTORY: &str = "deploy:history";
const DEPLOY_DETAIL: &str = "deploy:detail";
const DEPLOY_LOG: &str = "deploy:log";

#[tauri::command]
pub fn invoke_channel(app: AppHandle, channel: String, args: Vec<Value>) -> Result<Value, String> {
    match channel.as_str() {
        SERVER_LIST => Ok(json!(db::list_servers(&app)?)),
        SERVER_CREATE | SERVER_UPDATE | SERVER_DELETE | SERVER_TEST => Err(format!(
            "Tauri 后端尚未实现 {channel}；该能力将在 T2 凭据模块迁移后启用"
        )),
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
            let id = parse_project_id(&args, PROJECT_DELETE)?;
            db::delete_project(&app, id)?;
            Ok(Value::Null)
        }
        GIT_LIST_COMMITS | GIT_DIFF | DEPLOY_SCAN_FOLDER | DEPLOY_HISTORY => Ok(json!([])),
        DEPLOY_DETAIL => Err("Tauri 后端尚未实现 deploy:detail".into()),
        DEPLOY_LOG => Ok(json!({ "path": null, "content": "" })),
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

fn parse_project_id(args: &[Value], channel: &str) -> Result<i64, String> {
    let value = args
        .first()
        .ok_or_else(|| format!("{channel} 缺少项目 id"))?;
    value
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or_else(|| format!("{channel} 需要正整数项目 id"))
}
