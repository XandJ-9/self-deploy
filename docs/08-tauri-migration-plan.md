# 08 · Tauri 迁移方案

## 目标

在保留现有 React + Vite + Ant Design 渲染层和核心用户流程的前提下，将 Electron 主进程 / preload 迁移为 Tauri v2 + Rust 后端，降低应用体积与运行时资源占用，并用 Tauri capabilities 收窄前端权限。

## 当前状态

- 已新增 `apps/mac-tauri/` 与 `apps/win-tauri/` Tauri 壳工程
- 已新增 `apps/shared-renderer/src/api/runtime-api.ts`：Electron 下沿用 preload 注入的 `window.api`，Tauri 下由前端创建同名兼容 API
- 已新增 `packages/tauri-core/`，Win/Mac Tauri 共享 Rust 后端能力
- 已新增 `npm run dev:tauri` / `npm run build:tauri`
- Rust 后端当前通过 `invoke_channel(channel,args)` 兼容旧 IPC channel
- 已接入 SQLite 初始化与迁移，开发态数据库路径复用仓库根目录 `.local-data/selfdeploy.sqlite`
- `server:list` / `project:list` 已读取真实数据库
- `project:create` / `project:update` / `project:delete` 已迁移到 Rust
- `server:create` / `server:update` / `server:delete` 已迁移到 Rust，凭据通过系统钥匙串保存，数据库仅存 `credential_ref`
- `server:test` 已能读取钥匙串凭据，并完成 SFTP/FTP 协议级登录与远端基路径可访问性检查
- Servers/Projects 页面在 Tauri 运行时已具备 CRUD、目录选择与连接测试能力
- `git:listCommits` / `git:diff` / `git:status` 已迁移到 Rust，通过本机 `git` CLI 保持与 Electron 版行为一致
- `deploy:scanFolder` / `deploy:run` 已迁移到 Rust，支持 Git 增量与本地文件夹部署、SFTP/FTP 上传、临时目录切换和 `deploy:onLog` 实时日志事件
- `deploy:history` / `deploy:detail` / `deploy:log` / `deploy:rollback` 已迁移到 Rust，History 页面可查看历史、详情、完整日志并执行 Git 模式回滚
- T7 收尾已完成：Tauri 成为默认开发/构建/打包运行时，Rust 部署补齐 `.deployignore` 语义、Hook 与并发上传；Electron 代码仅保留在 `legacy:*` 脚本下作为回退基线
- M9 macOS Tauri 已完成：Mac 壳接入共享 Rust core，`dev/build/package:mac` 切换为 Tauri，凭据使用 macOS Keychain

## 分阶段迁移

| 阶段 | 内容 | 验收 |
|---|---|---|
| T0 脚手架 | `apps/*-tauri`、Tauri config、capabilities、前端 runtime adapter | `npm run lint` 通过；安装 Rust 后可启动空壳 |
| T1 数据库 | Rust SQLite 初始化、迁移、Server/Project repository | ✅ 服务器/项目列表可从同一 SQLite 数据读取；项目 CRUD 可用 |
| T2 凭据 | 系统钥匙串凭据保存、读取、更新、删除；迁移 Server 写入与连接测试 | ✅ 明文不落库，连接测试能读取 secret |
| T3 服务器与项目 | 迁移 CRUD、目录选择、连接测试 | ✅ Servers/Projects 页面可用 |
| T4 Git | 迁移提交列表、diff、status | ✅ Deploy 页面可预览 Git 增量 |
| T5 部署 | 迁移 SFTP/FTP transport、deploy service、日志事件 | ✅ 可执行 Git/Folder 部署并推送实时日志 |
| T6 历史与回滚 | 迁移 history/detail/log/rollback | ✅ History 页面完整可用 |
| T7 收尾 | 收敛 Electron legacy 入口，补齐部署增强，更新打包发布流程 | ✅ Tauri 成为默认桌面运行时 |
| T8 Mac Tauri | 抽出共享 Rust core，新增 macOS Tauri 壳与 Keychain 凭据实现 | ✅ Mac 上 `cargo check` 与 `build:mac` 可验证 |

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
| 凭据平台差异 | Windows 使用 DPAPI，macOS 使用 Keychain；凭据 ref 前缀区分平台 |
| 双运行时维护成本 | Tauri 为 Win/Mac 主线；Electron 仅保留 `legacy:*` 回退命令，后续可独立删除 |

## 开发命令

```bash
npm run dev          # macOS Tauri 开发，需要 cargo/rustc
npm run dev:tauri    # 同 npm run dev
npm run dev:win      # Windows Tauri 开发
npm run lint         # TypeScript 检查
npm run build        # macOS Tauri 打包，需要 cargo/rustc
npm run build:win    # Windows Tauri 打包
npm run legacy:dev   # Electron legacy 开发
```
