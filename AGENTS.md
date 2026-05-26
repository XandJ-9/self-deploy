# SelfDeploy — Agent Guide

本地项目快速部署到服务器的桌面工具（macOS / Windows Tauri + React + Rust + SFTP/FTP + Git 增量）。

> **必读**：所有设计决策均沉淀在 [docs/](./docs/README.md)，新功能开工前先看对应章节，不要凭空猜测。

## 技术栈（固定，勿替换）

- **桌面**：Tauri v2（macOS / Windows 主线）
- **渲染**：React 18 + Vite 5 + Ant Design 5 + React Router（HashRouter）+ Zustand
- **后端**：Rust + Tauri commands + rusqlite + Windows DPAPI / macOS Keychain + ssh2/ftp
- **同步协议**：ssh2 / ftp
- **凭据加密**：Windows DPAPI / macOS Keychain（系统安全设施）
- **校验**：serde + 前端表单校验（必要时辅以 Zod）
- **测试**：Vitest

完整对比与选型理由：[docs/02-tech-stack.md](./docs/02-tech-stack.md)、[docs/07-dependencies.md](./docs/07-dependencies.md)。

## 必跑命令

```bash
npm run dev              # Tauri 开发启动（需要 Rust 工具链）
npm run lint             # 主+渲染双 tsc --noEmit，提交前必跑
npm run build            # Tauri 打包
npm test                 # vitest run
npm run dev:win          # Windows 主线入口（Tauri）
npm run dev:mac          # macOS 主线入口（Tauri）
npm run legacy:dev       # Electron 回退启动
```

构建产物路径已固定，**勿改**：
- 渲染到 `dist/renderer/`，Tauri 生产环境通过 `frontendDist = "../../dist/renderer"` 加载
- macOS Tauri 产物在 `apps/mac-tauri/target/release/bundle/`
- Windows Tauri 产物在 `apps/win-tauri/target/release/bundle/`
- 归集后的最终发布包统一放到 `release/final/`
- legacy Electron 主进程/预加载仍编译到 `dist/main/`，仅供 `legacy:*` 回退脚本使用

## 三个 tsconfig（容易踩坑）

| 文件 | 用途 | 输出 |
|---|---|---|
| `tsconfig.json` | 提供路径别名 `@renderer/*`、`@domain/*`、`@ipc-contract/*` 等给编辑器 | — |
| `tsconfig.main.json` | legacy Electron 主进程/预加载，CommonJS | `dist/main/` |
| `tsconfig.renderer.json` | 渲染层，ESM，`noEmit`（Vite 负责打包） | — |

修改 `packages/tauri-core/**` 或 `apps/*-tauri/**` 后必须重跑对应 Rust/Tauri 检查命令，否则桌面应用加载旧代码。

## 职责边界（CRITICAL — 不要越界）

```
apps/mac-tauri/      # macOS Tauri 主线壳
apps/win-tauri/      # Windows Tauri 主线壳
apps/mac-electron/   # macOS Electron legacy 壳
apps/shared-renderer/# 双端共享渲染层
  ├── pages/         # 路由级页面，对应一个业务领域
  ├── api/           # runtime 兼容层
  ├── components/    # 共享组件（如 PageHero）
  └── styles/        # global.css（深色玻璃拟态主题，勿替换主色）
packages/tauri-core/ # Win/Mac Tauri 共享 Rust 后端。文件、网络、Git、DB、密钥能力默认在这里实现
packages/            # domain / ipc-contract / platform-adapter / testkit。纯类型与协议禁止依赖 node/electron/react
```

**铁律**：
1. 渲染进程 ↔ 后端**只通过** `window.api.invoke(channel, ...args)`。Channel 常量在 `packages/ipc-contract/src/ipc-channels.ts`，新增 channel 必须先加到那里。
2. 凭据明文**禁止**写入 `servers` 表或日志。新增涉密字段 → 用 `credential-vault` 存 ref，表里只存 ref。
3. Tauri command 入参必须通过 `serde` 结构体反序列化与领域校验后再用；legacy Electron handler 仍按 Zod 白名单校验。
4. 共用类型放 `packages/domain` / `packages/ipc-contract`，前后端不要重复定义。

## 开发规范

- **不可变更新**：状态/对象用 `{...old, field: v}` / `[...arr]`，不要 `arr.push`、`Object.assign(obj, ...)`。
- **错误处理**：IPC handler 抛错由前端 `AntdApp.message` 提示；不要静默 catch。
- **小文件**：单文件 < 400 行；handler 文件按领域拆分（已有 server/project/git/deploy 四类）。
- **样式**：渲染层使用 `global.css` 中的 CSS 变量与 `.glass-card` / `PageHero` 模式，不要重新引入 AntD `Layout/Sider/Header`（已被深色 shell 替代）。
- **安全**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox` 友好，不要为方便而关闭。
- **变更记录（强制）**：每次**新增功能**或**修复 bug**都必须在 [changelog.md](./changelog.md) 顶部追加一条记录。
  - 按日期**倒序**：最新日期置顶；同日内最新条目置顶。
  - 列表格式：`- feat(模块): xxxx` 或 `- bugfix(模块): xxxx`。
  - 模块名建议与「功能模块映射」对齐（如 `server` / `project` / `git` / `deploy` / `transport` / `db` / `security` / `renderer` / `docs` 等）。

详细 OWASP 对齐：[docs/05-security.md](./docs/05-security.md)。

## 功能模块映射

| 领域 | IPC handlers | UI 页面 | 文档 |
|---|---|---|---|
| 服务器管理 | `packages/tauri-core/src/db.rs` + `packages/tauri-core/src/transport.rs` | `apps/shared-renderer/src/pages/ServersPage.tsx` | [04-core-flows §服务器](./docs/04-core-flows.md) |
| 项目管理 | `packages/tauri-core/src/db.rs` | `apps/shared-renderer/src/pages/ProjectsPage.tsx` | 同上 |
| Git 差异 | `packages/tauri-core/src/git.rs` | `apps/shared-renderer/src/pages/DeployPage.tsx` | [04-core-flows §变更识别](./docs/04-core-flows.md) |
| 部署执行（M5） | `packages/tauri-core/src/deploy.rs` | `apps/shared-renderer/src/pages/DeployPage.tsx` | [04-core-flows §部署](./docs/04-core-flows.md) |
| 历史/回滚（M6） | `packages/tauri-core/src/deploy.rs` + `packages/tauri-core/src/db.rs` | `apps/shared-renderer/src/pages/HistoryPage.tsx` | [06-roadmap.md](./docs/06-roadmap.md) |

当前进度与下一步：[docs/06-roadmap.md](./docs/06-roadmap.md)。

## 文档同步规则（重要）

代码与文档**必须同源**。任何下列变更都要在同一次改动里更新对应文档：

| 改动类型 | 必须同步的文档 |
|---|---|
| 新增/删除依赖 | [docs/07-dependencies.md](./docs/07-dependencies.md) + `README.md` 技术栈表 |
| 新增 IPC channel 或改 schema | [docs/03-architecture.md](./docs/03-architecture.md) 数据模型 / IPC 章节 |
| 改变核心流程（diff/部署/回滚） | [docs/04-core-flows.md](./docs/04-core-flows.md) |
| 安全相关（凭据存储、权限） | [docs/05-security.md](./docs/05-security.md) |
| 里程碑状态推进 | [docs/06-roadmap.md](./docs/06-roadmap.md) + `README.md` 里程碑表 |
| 需求变更 | [docs/01-requirements.md](./docs/01-requirements.md) |

**约定**：先改文档形成共识，再写代码实现（plan-first）。

## 常见坑

- 修改 `packages/tauri-core/**` 或 `apps/*-tauri/**` 后忘记重跑对应构建，会导致桌面应用加载旧 Rust 后端。
- `window.api` 暴露的方法签名是**变参** `invoke<T>(channel, ...args)`，不要回退成单参数。
- SQLite 路径在应用数据目录下，开发期清库时删除对应的 `selfdeploy.sqlite*` 文件。
- `legacy:*` 只做回退参考，不要把新功能继续加到旧路径 `src/main/**` 或 `src/preload/**`。
- Vite `base: './'` 必须保留，否则打包后 `file://` 加载资源 404。

## 本地联调远端服务器

```bash
docker compose -f docker/test-servers/docker-compose.yml up -d
```

- SFTP `127.0.0.1:2222`  demo / demo123  `remoteBasePath=/upload`
- FTP  `127.0.0.1:2121`  demo / demo123  `remoteBasePath=/`

详见 [docker/test-servers/README.md](./docker/test-servers/README.md)。不要在单元测试中连真实外网服务器。

## 提交前检查清单

- [ ] `npm run lint` 通过（双 tsc）
- [ ] `npm run build` 通过
- [ ] 涉及上表「文档同步规则」的文档已更新
- [ ] Tauri command 入参有 `serde` 反序列化与领域校验；legacy IPC 入参有 Zod 校验
- [ ] 涉密字段走 `credential-vault`，未明文落库
- [ ] 渲染层未引入 node/electron 直接依赖
- [ ] [changelog.md](./changelog.md) 已追加本次 `feat` / `bugfix` 记录（日期倒序）
