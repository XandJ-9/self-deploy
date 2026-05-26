# 02 · 技术选型

## 方案对比

### 当前选择：Windows Tauri v2 + React + Rust

| 层 | 技术 | 理由 |
|---|---|---|
| 框架 | **Tauri v2** | 当前分支主线运行时，体积小、权限模型更细 |
| UI | **React + TypeScript + Vite** | 主流、生态丰富、HMR 体验好 |
| 组件库 | **Ant Design** | 表单/表格场景成熟 |
| 状态管理 | **Zustand** | 轻量，避免 Redux 样板 |
| Git 操作 | **Git CLI** | 保持与桌面环境一致的行为 |
| SFTP | **ssh2** | Rust 后端协议级连接实现 |
| FTP | **ftp** | Rust 后端协议级连接实现 |
| 本地存储 | **rusqlite** | 同步式 SQLite CRUD，贴近当前业务模型 |
| 凭据加密 | **Windows DPAPI** | 当前分支仅交付 Windows，凭据留在本机系统钥匙串 |
| 校验 | **serde** + 前端表单校验 | command 入参与 UI 校验双层兜底 |
| 打包 | **Tauri CLI** | Windows 安装包生成入口 |

## 仍保留的 legacy 基线

`src/main`、`src/preload`、`legacy:*` 脚本只作为回退和行为对照，不再作为当前主线文档展开。

## 选型结论

当前分支默认开发、构建与打包入口都指向 Tauri v2 + Rust 后端，React/Vite/AntD 渲染层继续复用。Electron 相关内容仅保留最小回退信息，避免干扰新开发者判断项目入口。

## 主要权衡

| 维度 | 选择 | 取舍 |
|---|---|---|
| Tauri 首次 Rust 接入成本高 | 接受 | 换取更轻的运行时与更细的权限控制 |
| 不使用 ORM | 接受 | better-sqlite3 同步 API 配合手写 SQL 更可控 |
| 不使用 Redux | 选 Zustand | 桌面应用状态结构简单，避免样板 |
| 前端/后端协议分层 | 用统一 runtime API + Tauri command | 兼顾迁移期兼容与后续强类型 command 拆分 |

## Tauri 迁移依赖映射

| Electron / Node | Tauri / Rust 主线 | 迁移策略 |
|---|---|---|
| Electron main/preload | Tauri `src-tauri` + `#[tauri::command]` | 先用 `invoke_channel(channel,args)` 兼容旧 channel，再逐步拆成强类型 command |
| `ipcRenderer.invoke` | `@tauri-apps/api/core.invoke` | 渲染层通过 `src/renderer/api/runtime-api.ts` 统一封装 |
| `dialog.showOpenDialog` | `@tauri-apps/plugin-dialog` | 目录选择先迁移 |
| `better-sqlite3` | `rusqlite` 或 `sqlx` | 优先 `rusqlite`，贴近现有同步 CRUD |
| Electron `safeStorage` | Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`) | 当前分支只面向 Windows，Tauri 后端直接使用 DPAPI 并将密文保存到本地 SQLite vault |
| `simple-git` | 本机 `git` CLI，后续评估 `git2` | 先保行为稳定，降低 libgit2 差异风险 |
| `ssh2-sftp-client` | `ssh2` crate SFTP | 保持现有 Transport 接口语义 |
| `basic-ftp` | `suppaftp` | M7 FTP 能力迁移 |
