# 02 · 技术选型

## 方案对比

### 方案 A（最终选择）：Electron + React + Node.js — 桌面应用

适合个人/小团队，离线可用，体验最佳。

| 层 | 技术 | 理由 |
|---|---|---|
| 框架 | **Electron** | 跨平台桌面、可访问本地文件系统与 Git |
| UI | **React + TypeScript + Vite** | 主流、生态丰富、HMR 体验好 |
| 组件库 | **Ant Design** | 表单/表格场景成熟 |
| 状态管理 | **Zustand** | 轻量，避免 Redux 样板 |
| Git 操作 | **simple-git** | 封装好的 Git CLI 包装器 |
| SFTP | **ssh2-sftp-client** | 基于 ssh2，稳定 |
| FTP | **basic-ftp** | 现代 Promise API |
| 本地存储 | **better-sqlite3** | 同步 API、零配置 |
| 凭据加密 | Electron **safeStorage** | 调用系统钥匙串（macOS Keychain / Win DPAPI / Linux libsecret） |
| 校验 | **Zod** | IPC 入参运行时校验 |
| 打包 | **electron-builder** | 生成 dmg/exe/AppImage |

### 方案 B：Tauri + React — 更轻量

| 优势 | 劣势 |
|---|---|
| 体积小（<10MB vs Electron ~80MB）、性能好、Rust 后端内存安全 | Git/SFTP 需使用 Rust crate（`git2`、`russh-sftp`），生态成熟度不如 Node |

### 方案 C：本地 Web 服务（Node + Express + React）

| 优势 | 劣势 |
|---|---|
| 实现最快、可在内网多人共用 | 凭据集中存储、需引入鉴权层、本地服务进程管理复杂 |

## 最终选择：方案 A

**理由**：
1. Git 与 SFTP 在 Node 生态最成熟，simple-git 与 ssh2-sftp-client 是事实标准
2. 个人桌面工具无需鉴权层，凭据用 OS 钥匙串隔离即可
3. React + AntD 在表单/表格密集场景下开发效率最高
4. 主进程使用 better-sqlite3 同步 API，简化 CRUD 代码

## 主要权衡

| 维度 | 选择 | 取舍 |
|---|---|---|
| Electron 体积大 | 接受 | 换取 Node 生态与开发效率 |
| 不使用 ORM | 接受 | better-sqlite3 同步 API 配合手写 SQL 更可控 |
| 不使用 Redux | 选 Zustand | 桌面应用状态结构简单，避免样板 |
| IPC 不引入 tRPC（初期） | 用原生 ipcMain.handle | 减少首个版本依赖；后期模块多再引入 |
