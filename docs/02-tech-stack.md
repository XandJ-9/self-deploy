# 02 · 技术选型

## 方案对比

### 方案 A（当前稳定版）：Electron + React + Node.js — 桌面应用

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

### 方案 B（迁移目标）：Tauri + React — 更轻量

| 优势 | 劣势 |
|---|---|
| 体积小、性能好、Rust 后端内存安全、权限模型更细 | Git/SFTP/FTP/SQLite/凭据保险柜需迁移到 Rust，短期存在双栈维护成本 |

### 方案 C：本地 Web 服务（Node + Express + React）

| 优势 | 劣势 |
|---|---|
| 实现最快、可在内网多人共用 | 凭据集中存储、需引入鉴权层、本地服务进程管理复杂 |

## 当前选择：方案 A，迁移目标：方案 B

Electron 版本已经完成 M1-M7，可作为稳定基线。自 `codex/tauri-plan` 分支开始，项目进入 Tauri 迁移开发，目标是保留 React/Vite/AntD 渲染层，将 Electron 主进程与 preload 能力逐步迁移到 Tauri v2 + Rust 后端。

Electron 稳定版保留的理由：
1. Git 与 SFTP 在 Node 生态最成熟，simple-git 与 ssh2-sftp-client 是事实标准
2. 个人桌面工具无需鉴权层，凭据用 OS 钥匙串隔离即可
3. React + AntD 在表单/表格密集场景下开发效率最高
4. 主进程使用 better-sqlite3 同步 API，简化 CRUD 代码

Tauri 迁移目标：
1. 显著降低安装包体积和运行时内存占用
2. 用 Rust 后端承接文件系统、Git、网络传输、SQLite 与凭据访问
3. 通过 Tauri capabilities 限制前端可调用能力
4. 保持现有 UI 与业务流程不变，降低用户迁移成本

## 主要权衡

| 维度 | 选择 | 取舍 |
|---|---|---|
| Electron 体积大 | 接受 | 换取 Node 生态与开发效率 |
| 不使用 ORM | 接受 | better-sqlite3 同步 API 配合手写 SQL 更可控 |
| 不使用 Redux | 选 Zustand | 桌面应用状态结构简单，避免样板 |
| IPC 不引入 tRPC（初期） | 用原生 ipcMain.handle | 减少首个版本依赖；后期模块多再引入 |

## Tauri 迁移依赖映射

| Electron / Node | Tauri / Rust 目标 | 迁移策略 |
|---|---|---|
| Electron main/preload | Tauri `src-tauri` + `#[tauri::command]` | 先用 `invoke_channel(channel,args)` 兼容旧 channel，再逐步拆成强类型 command |
| `ipcRenderer.invoke` | `@tauri-apps/api/core.invoke` | 渲染层通过 `src/renderer/api/runtime-api.ts` 统一封装 |
| `dialog.showOpenDialog` | `@tauri-apps/plugin-dialog` | 目录选择先迁移 |
| `better-sqlite3` | `rusqlite` 或 `sqlx` | 优先 `rusqlite`，贴近现有同步 CRUD |
| Electron `safeStorage` | `keyring` crate / Stronghold | 第一版优先系统钥匙串；Stronghold 作为加密文件库备选 |
| `simple-git` | 本机 `git` CLI，后续评估 `git2` | 先保行为稳定，降低 libgit2 差异风险 |
| `ssh2-sftp-client` | `ssh2` crate SFTP | 保持现有 Transport 接口语义 |
| `basic-ftp` | `suppaftp` | M7 FTP 能力迁移 |
