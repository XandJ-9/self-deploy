use std::{
    fs,
    io::{Cursor, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

use ftp::FtpStream;
use serde::Serialize;
use ssh2::{KeyboardInteractivePrompt, Prompt, Session, Sftp};

#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    pub protocol: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_type: String,
    pub secret: String,
    pub remote_base_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    ok: bool,
    message: String,
    remote_exists: Option<RemoteExists>,
    remote_info: Option<RemoteInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    absolute_path: Option<String>,
    login_cwd: Option<String>,
    writable: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteExists {
    Directory,
    File,
    Missing,
}

pub fn test_connection(cfg: ConnectionConfig) -> TestConnectionResult {
    match cfg.protocol.as_str() {
        "sftp" => test_sftp_connection(&cfg),
        "ftp" => test_ftp_connection(&cfg),
        _ => fail("协议必须是 sftp 或 ftp"),
    }
}

pub fn failure(message: &str) -> TestConnectionResult {
    fail(message)
}

pub enum RemoteClient {
    Sftp { _session: Session, sftp: Sftp },
    Ftp { ftp: FtpStream },
}

impl RemoteClient {
    pub fn connect(cfg: &ConnectionConfig) -> Result<Self, String> {
        match cfg.protocol.as_str() {
            "sftp" => connect_sftp(cfg),
            "ftp" => connect_ftp(cfg),
            _ => Err("协议必须是 sftp 或 ftp".into()),
        }
    }

    pub fn mkdirp(&mut self, remote_path: &str) -> Result<(), String> {
        match self {
            Self::Sftp { sftp, .. } => sftp_mkdirp(sftp, remote_path),
            Self::Ftp { ftp } => ftp_mkdirp(ftp, remote_path),
        }
    }

    pub fn put_file(&mut self, local_path: &Path, remote_path: &str) -> Result<(), String> {
        self.mkdirp(&remote_parent(remote_path))?;
        match self {
            Self::Sftp { sftp, .. } => {
                let mut local = fs::File::open(local_path).map_err(to_string)?;
                let mut remote = sftp.create(Path::new(remote_path)).map_err(to_string)?;
                std::io::copy(&mut local, &mut remote).map_err(to_string)?;
                Ok(())
            }
            Self::Ftp { ftp } => {
                let mut local = fs::File::open(local_path).map_err(to_string)?;
                ftp.put(remote_path, &mut local).map_err(to_string)
            }
        }
    }

    pub fn put_bytes(&mut self, bytes: &[u8], remote_path: &str) -> Result<(), String> {
        self.mkdirp(&remote_parent(remote_path))?;
        match self {
            Self::Sftp { sftp, .. } => {
                let mut remote = sftp.create(Path::new(remote_path)).map_err(to_string)?;
                remote.write_all(bytes).map_err(to_string)
            }
            Self::Ftp { ftp } => {
                let mut cursor = Cursor::new(bytes.to_vec());
                ftp.put(remote_path, &mut cursor).map_err(to_string)
            }
        }
    }

    pub fn remove_file(&mut self, remote_path: &str) {
        match self {
            Self::Sftp { sftp, .. } => {
                let _ = sftp.unlink(Path::new(remote_path));
            }
            Self::Ftp { ftp } => {
                let _ = ftp.rm(remote_path);
            }
        }
    }

    pub fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        self.mkdirp(&remote_parent(to))?;
        match self {
            Self::Sftp { sftp, .. } => sftp
                .rename(Path::new(from), Path::new(to), None)
                .map_err(to_string),
            Self::Ftp { ftp } => ftp.rename(from, to).map_err(to_string),
        }
    }

    pub fn remove_dir_all(&mut self, remote_path: &str) {
        match self {
            Self::Sftp { sftp, .. } => {
                let _ = sftp_remove_dir_all(sftp, remote_path);
            }
            Self::Ftp { ftp } => {
                let _ = ftp_remove_dir_all(ftp, remote_path);
            }
        }
    }

    pub fn quit(&mut self) {
        if let Self::Ftp { ftp } = self {
            let _ = ftp.quit();
        }
    }
}

fn connect_sftp(cfg: &ConnectionConfig) -> Result<RemoteClient, String> {
    let addr = first_socket_addr(&cfg.host, cfg.port)?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(30)).map_err(to_string)?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

    let mut session = Session::new().map_err(to_string)?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(to_string)?;
    authenticate_sftp(&session, cfg)?;
    let sftp = session.sftp().map_err(to_string)?;
    Ok(RemoteClient::Sftp {
        _session: session,
        sftp,
    })
}

fn connect_ftp(cfg: &ConnectionConfig) -> Result<RemoteClient, String> {
    if cfg.auth_type != "password" {
        return Err("FTP 不支持私钥认证，请改用密码或切换为 SFTP".into());
    }
    let addr = format!("{}:{}", cfg.host, cfg.port);
    let mut ftp = FtpStream::connect(addr.as_str()).map_err(to_string)?;
    ftp.login(&cfg.username, &cfg.secret).map_err(to_string)?;
    Ok(RemoteClient::Ftp { ftp })
}

fn test_sftp_connection(cfg: &ConnectionConfig) -> TestConnectionResult {
    let addr = match first_socket_addr(&cfg.host, cfg.port) {
        Ok(addr) => addr,
        Err(err) => return fail(&format!("SFTP 地址解析失败：{err}")),
    };

    let tcp = match TcpStream::connect_timeout(&addr, Duration::from_secs(8)) {
        Ok(tcp) => tcp,
        Err(err) => return fail(&format!("SFTP 连接失败：{err}")),
    };
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(8)));

    let mut session = match Session::new() {
        Ok(session) => session,
        Err(err) => return fail(&format!("SFTP 会话创建失败：{err}")),
    };
    session.set_tcp_stream(tcp);
    if let Err(err) = session.handshake() {
        return fail(&format!("SFTP 握手失败：{err}"));
    }

    if let Err(err) = authenticate_sftp(&session, cfg) {
        return fail(&format!("SFTP 认证失败：{err}"));
    }

    let sftp = match session.sftp() {
        Ok(sftp) => sftp,
        Err(err) => return fail(&format!("SFTP 子系统不可用：{err}")),
    };

    let target = normalize_remote_base(&cfg.remote_base_path);
    let login_cwd = sftp.realpath(Path::new(".")).ok().map(path_to_string);
    let target_path = Path::new(&target);

    match sftp.stat(target_path) {
        Ok(stat) => {
            let is_dir = stat.is_dir();
            let writable = if is_dir {
                Some(probe_sftp_writable(&sftp, &target))
            } else {
                None
            };
            let suffix = match writable {
                Some(false) => "；目录不可写，部署会失败",
                _ => "",
            };
            success(
                &format!(
                    "SFTP 连接成功，当前目录：{}；部署目标：{}{}",
                    login_cwd.as_deref().unwrap_or("(未知)"),
                    target,
                    suffix
                ),
                Some(if is_dir {
                    RemoteExists::Directory
                } else {
                    RemoteExists::File
                }),
                Some(RemoteInfo {
                    absolute_path: sftp.realpath(target_path).ok().map(path_to_string),
                    login_cwd,
                    writable,
                }),
            )
        }
        Err(_) => {
            let parent = remote_parent(&target);
            let parent_writable = match sftp.stat(Path::new(&parent)) {
                Ok(stat) if stat.is_dir() => Some(probe_sftp_writable(&sftp, &parent)),
                _ => None,
            };
            let suffix = match parent_writable {
                Some(false) => format!("；父目录 {parent} 不可写，部署会失败"),
                _ => String::new(),
            };
            success(
                &format!(
                    "SFTP 连接成功，当前目录：{}；部署路径 {target} 不存在（首次部署时会自动创建）{suffix}",
                    login_cwd.as_deref().unwrap_or("(未知)")
                ),
                Some(RemoteExists::Missing),
                Some(RemoteInfo {
                    absolute_path: Some(target),
                    login_cwd,
                    writable: parent_writable,
                }),
            )
        }
    }
}

fn authenticate_sftp(session: &Session, cfg: &ConnectionConfig) -> Result<(), String> {
    if cfg.auth_type == "password" {
        match session.userauth_password(&cfg.username, &cfg.secret) {
            Ok(()) => return Ok(()),
            Err(password_err) => {
                let mut prompter = PasswordPrompter {
                    password: cfg.secret.clone(),
                };
                return session
                    .userauth_keyboard_interactive(&cfg.username, &mut prompter)
                    .map_err(|keyboard_err| {
                        format!(
                            "password 认证失败：{}；keyboard-interactive 兜底也失败：{}",
                            password_err, keyboard_err
                        )
                    });
            }
        }
    }

    let key_path = temp_private_key_path();
    fs::write(&key_path, &cfg.secret).map_err(to_string)?;
    let auth_result = session
        .userauth_pubkey_file(&cfg.username, None, &key_path, None)
        .map_err(to_string);
    let _ = fs::remove_file(&key_path);
    auth_result
}

struct PasswordPrompter {
    password: String,
}

impl KeyboardInteractivePrompt for PasswordPrompter {
    fn prompt<'a>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'a>],
    ) -> Vec<String> {
        prompts.iter().map(|_| self.password.clone()).collect()
    }
}

fn test_ftp_connection(cfg: &ConnectionConfig) -> TestConnectionResult {
    if cfg.auth_type != "password" {
        return fail("FTP 不支持私钥认证，请改用密码或切换为 SFTP");
    }

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let mut ftp = match FtpStream::connect(addr.as_str()) {
        Ok(ftp) => ftp,
        Err(err) => return fail(&format!("FTP 连接失败：{err}")),
    };

    if let Err(err) = ftp.login(&cfg.username, &cfg.secret) {
        let _ = ftp.quit();
        return fail(&format!("FTP 认证失败：{err}"));
    }

    let target = normalize_remote_base(&cfg.remote_base_path);
    let login_cwd = ftp.pwd().ok();
    match ftp.cwd(&target) {
        Ok(()) => {
            let absolute_path = ftp.pwd().ok().or_else(|| Some(target.clone()));
            let writable = probe_ftp_writable(&mut ftp);
            let _ = ftp.quit();
            let suffix = if writable {
                ""
            } else {
                "；目录不可写，部署会失败"
            };
            success(
                &format!(
                    "FTP 连接成功，当前目录：{}；部署目标目录：{}{}",
                    login_cwd.as_deref().unwrap_or("(未知)"),
                    absolute_path.as_deref().unwrap_or(&target),
                    suffix
                ),
                Some(RemoteExists::Directory),
                Some(RemoteInfo {
                    absolute_path,
                    login_cwd,
                    writable: Some(writable),
                }),
            )
        }
        Err(_) => {
            let _ = ftp.quit();
            success(
                &format!(
                    "FTP 连接成功，当前目录：{}；部署路径 {target} 不存在（首次部署时会自动创建）",
                    login_cwd.as_deref().unwrap_or("(未知)")
                ),
                Some(RemoteExists::Missing),
                Some(RemoteInfo {
                    absolute_path: Some(target),
                    login_cwd,
                    writable: None,
                }),
            )
        }
    }
}

fn probe_sftp_writable(sftp: &ssh2::Sftp, dir: &str) -> bool {
    let probe = format!(
        "{}/.sd-write-test-{}",
        trim_remote_slash(dir),
        timestamp_millis()
    );
    match sftp.create(Path::new(&probe)) {
        Ok(mut file) => {
            let _ = file.write_all(b"");
            let _ = sftp.unlink(Path::new(&probe));
            true
        }
        Err(_) => false,
    }
}

fn probe_ftp_writable(ftp: &mut FtpStream) -> bool {
    let probe = format!(".sd-write-test-{}", timestamp_millis());
    let mut empty = Cursor::new(Vec::<u8>::new());
    match ftp.put(&probe, &mut empty) {
        Ok(()) => {
            let _ = ftp.rm(&probe);
            true
        }
        Err(_) => false,
    }
}

fn sftp_mkdirp(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
    let normalized = normalize_remote_base(remote_path);
    if normalized == "/" || normalized.is_empty() {
        return Ok(());
    }
    let mut current = String::new();
    for part in normalized
        .trim_matches('/')
        .split('/')
        .filter(|p| !p.is_empty())
    {
        current.push('/');
        current.push_str(part);
        match sftp.stat(Path::new(&current)) {
            Ok(stat) if stat.is_dir() => {}
            Ok(_) => return Err(format!("远端路径不是目录：{current}")),
            Err(_) => {
                let _ = sftp.mkdir(Path::new(&current), 0o755);
            }
        }
    }
    Ok(())
}

fn ftp_mkdirp(ftp: &mut FtpStream, remote_path: &str) -> Result<(), String> {
    let normalized = normalize_remote_base(remote_path);
    if normalized == "/" || normalized.is_empty() {
        return Ok(());
    }
    let original = ftp.pwd().ok();
    let mut current = String::new();
    for part in normalized
        .trim_matches('/')
        .split('/')
        .filter(|p| !p.is_empty())
    {
        current.push('/');
        current.push_str(part);
        if ftp.cwd(&current).is_err() {
            let _ = ftp.mkdir(&current);
        }
    }
    if let Some(original) = original {
        let _ = ftp.cwd(&original);
    }
    Ok(())
}

fn sftp_remove_dir_all(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
    let path = Path::new(remote_path);
    let entries = match sftp.readdir(path) {
        Ok(entries) => entries,
        Err(_) => {
            let _ = sftp.rmdir(path);
            return Ok(());
        }
    };
    for (entry_path, stat) in entries {
        let name = entry_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() {
            let _ = sftp_remove_dir_all(sftp, &path_to_string(entry_path));
        } else {
            let _ = sftp.unlink(&entry_path);
        }
    }
    let _ = sftp.rmdir(path);
    Ok(())
}

fn ftp_remove_dir_all(ftp: &mut FtpStream, remote_path: &str) -> Result<(), String> {
    let entries = ftp.nlst(Some(remote_path)).unwrap_or_default();
    for entry in entries {
        let name = entry.trim();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let child = if name.starts_with('/') {
            name.to_string()
        } else {
            format!("{}/{}", trim_remote_slash(remote_path), name)
        };
        if ftp.rm(&child).is_err() {
            let _ = ftp_remove_dir_all(ftp, &child);
        }
    }
    let _ = ftp.rmdir(remote_path);
    Ok(())
}

fn first_socket_addr(host: &str, port: i64) -> Result<std::net::SocketAddr, String> {
    let port = u16::try_from(port).map_err(|_| "端口超出范围".to_string())?;
    (host, port)
        .to_socket_addrs()
        .map_err(to_string)?
        .next()
        .ok_or_else(|| "未解析到可连接地址".into())
}

fn normalize_remote_base(remote_base_path: &str) -> String {
    let trimmed = remote_base_path.trim();
    if trimmed.is_empty() {
        "/".into()
    } else {
        trimmed.replace('\\', "/")
    }
}

fn remote_parent(path: &str) -> String {
    let trimmed = trim_remote_slash(path);
    match trimmed.rsplit_once('/') {
        Some((parent, _)) if !parent.is_empty() => parent.to_string(),
        _ => "/".into(),
    }
}

fn trim_remote_slash(path: &str) -> &str {
    if path == "/" {
        ""
    } else {
        path.trim_end_matches('/')
    }
}

fn path_to_string(path: std::path::PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn temp_private_key_path() -> PathBuf {
    std::env::temp_dir().join(format!("selfdeploy-key-{}.pem", timestamp_millis()))
}

fn success(
    message: &str,
    remote_exists: Option<RemoteExists>,
    remote_info: Option<RemoteInfo>,
) -> TestConnectionResult {
    TestConnectionResult {
        ok: true,
        message: message.into(),
        remote_exists,
        remote_info,
    }
}

fn fail(message: &str) -> TestConnectionResult {
    TestConnectionResult {
        ok: false,
        message: message.into(),
        remote_exists: None,
        remote_info: None,
    }
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn to_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}
