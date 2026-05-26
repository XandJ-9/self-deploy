# tauri-core

Shared Rust backend for SelfDeploy Tauri apps.

This crate contains channel dispatch, SQLite repositories, Git integration, SFTP/FTP transport, deployment orchestration, and platform-gated credential handling. Platform app shells should stay thin and call the commands exported by this crate.
