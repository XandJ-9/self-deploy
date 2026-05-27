# 07 · 依赖清单

## 前端与 legacy 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `@tauri-apps/api` | ^2 | Tauri 前端 API |
| `@tauri-apps/plugin-dialog` | ^2 | Tauri 目录选择插件 |
| `electron` | ^32 | legacy Electron 回退运行时 |
| `react` / `react-dom` | ^18 | UI 渲染 |
| `react-router-dom` | ^6 | 渲染端路由 |
| `antd` | ^5 | UI 组件库 |
| `zustand` | ^4 | 渲染端状态管理 |
| `simple-git` | ^3 | legacy Electron Git 命令封装 |
| `ssh2-sftp-client` | ^11 | legacy Electron SFTP 客户端 |
| `basic-ftp` | ^5 | legacy Electron FTP 客户端 |
| `ignore` | ^7 | legacy Electron 部署过滤（回退基线） |
| `better-sqlite3` | ^11 | legacy Electron 本地 SQLite（同步 API） |
| `zod` | ^3 | legacy IPC / 表单运行时校验 |
| `@trpc/server` / `@trpc/client` | ^11 | 预留，未来 IPC 类型安全 |
| `superjson` | ^2 | trpc 时序列化 |

## 开发依赖

| 包 | 用途 |
|---|---|
| `typescript` | TS 编译 |
| `vite` + `@vitejs/plugin-react` | 渲染端开发服务器与构建 |
| `@tauri-apps/cli` | Tauri 开发与打包命令 |
| `electron-builder` | legacy Electron 打包（回退基线） |
| `concurrently` + `wait-on` + `cross-env` | dev 脚本编排 |
| `vitest` | 单元测试 |
| `@types/*` | 类型声明 |

## Rust 依赖（Tauri 主线）

| crate | 用途 |
|---|---|
| `tauri` / `tauri-build` | Tauri v2 桌面运行时与构建 |
| `tauri-plugin-dialog` | 原生目录选择 |
| `serde` / `serde_json` | command 入参和返回值序列化 |
| `rusqlite` (`bundled`) | Tauri 后端 SQLite 初始化、迁移与 CRUD |
| `uuid` | 生成不含明文的 `credential_ref` |
| `ssh2` | Tauri 后端 SFTP 协议级连接测试 |
| `ftp` | Tauri 后端 FTP 协议级连接测试 |
| `ignore` | Rust 版 `.deployignore` / `excludePatterns` gitignore 语义匹配 |
| `winapi` | Windows DPAPI 凭据加密与解密 |
| macOS `security` CLI | macOS Keychain 凭据保存、读取与删除 |

常用开发、构建、打包与图标生成命令统一维护在根目录 [README.md](../README.md) 的「开发命令」章节。

## 选型理由速查

- **rusqlite**：Tauri 主线使用同步 SQL，贴近当前业务模型
- **Git CLI > libgit2**：保持与桌面环境一致的 Git 行为
- **Rust ssh2 / ftp**：Tauri 主线协议级传输实现
- **AntD > MUI**：表单/表格场景模板化程度高、中文文档完善
- **Zustand > Redux**：桌面应用状态简单，Zustand 0 模板代码
- **Zod > Joi/Yup**：TS 类型推导能力最强
