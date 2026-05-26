use std::{path::Path, process::Command};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short_hash: String,
    message: String,
    author: String,
    date: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum FileAction {
    Add,
    Modify,
    Delete,
    Rename,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub action: FileAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    current: String,
    is_clean: bool,
    ahead: i64,
    behind: i64,
    modified: Vec<String>,
    #[serde(rename = "not_added")]
    not_added: Vec<String>,
}

pub fn list_commits(repo_path: &str, limit: i64) -> Result<Vec<GitCommit>, String> {
    let max_count = if limit <= 0 { 50 } else { limit.min(500) };
    let output = run_git(
        repo_path,
        &[
            "log",
            "-n",
            &max_count.to_string(),
            "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
        ],
    )?;

    Ok(output
        .split('\x1e')
        .filter_map(|entry| {
            let trimmed = entry.trim_matches('\n').trim_matches('\r');
            if trimmed.is_empty() {
                return None;
            }
            let mut parts = trimmed.split('\x1f');
            Some(GitCommit {
                hash: parts.next()?.to_string(),
                short_hash: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                message: parts.collect::<Vec<_>>().join("\x1f"),
            })
        })
        .collect())
}

pub fn diff(repo_path: &str, from: Option<&str>, to: &str) -> Result<Vec<ChangedFile>, String> {
    if to.trim().is_empty() {
        return Err("目标提交不能为空".into());
    }

    if let Some(from) = from.filter(|value| !value.trim().is_empty()) {
        let range = format!("{from}..{to}");
        return parse_name_status(&run_git(repo_path, &["diff", "--name-status", &range])?);
    }

    let output = run_git(repo_path, &["ls-tree", "-r", "--name-only", to])?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let path = line.trim();
            (!path.is_empty()).then(|| ChangedFile {
                path: path.to_string(),
                action: FileAction::Add,
                old_path: None,
            })
        })
        .collect())
}

pub fn status(repo_path: &str) -> Result<GitStatus, String> {
    let output = run_git(repo_path, &["status", "--porcelain=v1", "--branch"])?;
    Ok(parse_status(&output))
}

pub fn file_bytes(repo_path: &str, commit: &str, rel_path: &str) -> Result<Vec<u8>, String> {
    if commit.trim().is_empty() {
        return Err("提交不能为空".into());
    }
    if rel_path.trim().is_empty() {
        return Err("文件路径不能为空".into());
    }
    run_git_bytes(repo_path, &["show", &format!("{commit}:{rel_path}")])
}

fn parse_name_status(output: &str) -> Result<Vec<ChangedFile>, String> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let status = parts
                .first()
                .copied()
                .ok_or_else(|| format!("无法解析 git diff 输出：{line}"))?;
            if status.starts_with('R') && parts.len() >= 3 {
                return Ok(ChangedFile {
                    old_path: Some(parts[1].to_string()),
                    path: parts[2].to_string(),
                    action: FileAction::Rename,
                });
            }
            let path = parts
                .get(1)
                .copied()
                .ok_or_else(|| format!("无法解析 git diff 输出：{line}"))?;
            Ok(ChangedFile {
                path: path.to_string(),
                action: map_status(status),
                old_path: None,
            })
        })
        .collect()
}

fn parse_status(output: &str) -> GitStatus {
    let mut current = String::new();
    let mut ahead = 0;
    let mut behind = 0;
    let mut modified = Vec::new();
    let mut not_added = Vec::new();
    let mut dirty = false;

    for line in output.lines() {
        if let Some(branch) = line.strip_prefix("## ") {
            let branch_name = branch.split("...").next().unwrap_or(branch);
            current = branch_name
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            ahead = parse_counter(branch, "ahead");
            behind = parse_counter(branch, "behind");
            continue;
        }

        if line.len() < 4 {
            continue;
        }
        dirty = true;
        let code = &line[..2];
        let path = line[3..].trim().to_string();
        if code == "??" {
            not_added.push(path);
        } else if code.contains('M') {
            modified.push(path);
        }
    }

    GitStatus {
        current,
        is_clean: !dirty,
        ahead,
        behind,
        modified,
        not_added,
    }
}

fn parse_counter(branch: &str, label: &str) -> i64 {
    let Some(start) = branch.find(label) else {
        return 0;
    };
    branch[start + label.len()..]
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

fn map_status(status: &str) -> FileAction {
    if status.starts_with('A') {
        FileAction::Add
    } else if status.starts_with('D') {
        FileAction::Delete
    } else if status.starts_with('R') {
        FileAction::Rename
    } else {
        FileAction::Modify
    }
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = run_git_bytes(repo_path, args)?;
    Ok(String::from_utf8_lossy(&output).to_string())
}

fn run_git_bytes(repo_path: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let repo = Path::new(repo_path);
    if !repo.is_dir() {
        return Err(format!("Git 仓库路径不存在或不是目录：{repo_path}"));
    }

    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|err| format!("执行 git 失败：{err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("git 命令失败，退出码：{}", output.status)
        } else {
            stderr
        };
        return Err(message);
    }

    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_status_with_rename() {
        let files =
            parse_name_status("M\tsrc/a.ts\nR100\told.txt\tnew.txt\nD\tgone.txt\n").expect("parse");

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].action, FileAction::Modify);
        assert_eq!(files[1].action, FileAction::Rename);
        assert_eq!(files[1].old_path.as_deref(), Some("old.txt"));
        assert_eq!(files[1].path, "new.txt");
        assert_eq!(files[2].action, FileAction::Delete);
    }

    #[test]
    fn parses_porcelain_status() {
        let status = parse_status(
            "## main...origin/main [ahead 2, behind 1]\n M src/a.ts\nM  src/b.ts\n?? src/c.ts\n",
        );

        assert_eq!(status.current, "main");
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert!(!status.is_clean);
        assert_eq!(status.modified, vec!["src/a.ts", "src/b.ts"]);
        assert_eq!(status.not_added, vec!["src/c.ts"]);
    }

    #[test]
    fn treats_deleted_files_as_dirty() {
        let status = parse_status("## main\n D src/gone.ts\n");

        assert!(!status.is_clean);
        assert!(status.modified.is_empty());
        assert!(status.not_added.is_empty());
    }
}
