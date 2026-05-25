# 08 · Tauri 迁移方案

## 目标

在保留现有 React + Vite + Ant Design 渲染层和核心用户流程的前提下，将 Electron 主进程 / preload 迁移为 Tauri v2 + Rust 后端，降低应用体积与运行时资源占用，并用 Tauri capabilities 收窄前端权限。

## 当前状态

- 已新增 `src-tauri/` 基础工程
- 已新增 `src/renderer/api/runtime-api.ts`：Electron 下沿用 preload 注入的 `window.api`，Tauri 下由前端创建同名兼容 API
- 已新增 `npm run dev:tauri` / `npm run build:tauri`
- Rust 后端当前通过 `invoke_channel(channel,args)` 兼容旧 IPC channel
- 已接入 SQLite 初始化与迁移，开发态数据库路径复用仓库根目录 `.local-data/selfdeploy.sqlite`
- `server:list` / `project:list` 已读取真实数据库
- `project:create` / `project:update` / `project:delete` 已迁移到 Rust
- Server 写入、连接测试、Git、部署、历史与回滚尚未迁移

## 分阶段迁移

| 阶段 | 内容 | 验收 |
|---|---|---|
| T0 脚手架 | `src-tauri`、Tauri config、capabilities、前端 runtime adapter | `npm run lint` 通过；安装 Rust 后可启动空壳 |
| T1 数据库 | Rust SQLite 初始化、迁移、Server/Project repository | ✅ 服务器/项目列表可从同一 SQLite 数据读取；项目 CRUD 可用 |
| T2 凭据 | 系统钥匙串凭据保存、读取、更新、删除；迁移 Server 写入与连接测试 | 明文不落库，连接测试能读取 secret |
| T3 服务器与项目 | 迁移 CRUD、目录选择、连接测试 | Servers/Projects 页面可用 |
| T4 Git | 迁移提交列表、diff、status | Deploy 页面可预览 Git 增量 |
| T5 部署 | 迁移 SFTP/FTP transport、deploy service、日志事件 | 可端到端部署到 docker 测试服务器 |
| T6 历史与回滚 | 迁移 history/detail/log/rollback | History 页面完整可用 |
| T7 收尾 | 删除 Electron 专属代码与依赖，更新打包发布流程 | Tauri 成为唯一桌面运行时 |

## 技术决策

| 领域 | 决策 |
|---|---|
| 前端 API | 短期保留 `window.api.invoke(channel,...args)`，降低页面改动量 |
| Tauri command | 先用 `invoke_channel` 兼容旧 IPC，稳定后按领域拆强类型 command |
| SQLite | 优先 `rusqlite`，贴近当前同步 SQL 模式 |
| Git | 第一版调用本机 `git` CLI，避免 libgit2 行为差异；后续再评估 `git2` |
| 凭据 | 优先系统钥匙串等价实现，保持 `credential_ref` 模型 |
| 传输 | SFTP 先行，FTP 跟随 M7 能力迁移 |
| 日志事件 | 沿用 `deploy:onLog` 事件名，Tauri 后端 emit |

## 风险与处理

| 风险 | 处理 |
|---|---|
| 本机未安装 Rust 工具链 | 前端与文档可先落地；Tauri 编译需安装 Rust 后验证 |
| Rust SFTP/FTP crate 行为与 Node 版不同 | 使用 docker 测试服务器做端到端冒烟 |
| SQLite 迁移兼容 | 复用现有表结构，新增迁移必须幂等 |
| 凭据跨平台差异 | macOS / Windows / Linux 分别验证钥匙串行为 |
| 双运行时维护成本 | 按 T0-T7 推进，完成后移除 Electron |

## 开发命令

```bash
npm run dev          # Electron 稳定版开发
npm run dev:tauri    # Tauri 迁移版开发，需要 cargo/rustc
npm run lint         # TypeScript 检查
npm run build:tauri  # Tauri 打包，需要 cargo/rustc
```
