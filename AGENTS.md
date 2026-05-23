# SelfDeploy — Agent Guide

本地项目快速部署到服务器的桌面工具（Electron + React + SFTP/FTP + Git 增量）。

> **必读**：所有设计决策均沉淀在 [docs/](./docs/README.md)，新功能开工前先看对应章节，不要凭空猜测。

## 技术栈（固定，勿替换）

- **桌面**：Electron 32（CommonJS 主进程）
- **渲染**：React 18 + Vite 5 + Ant Design 5 + React Router（HashRouter）+ Zustand
- **主进程**：Node 22 + better-sqlite3 11（WAL）+ simple-git 3
- **同步协议**：ssh2-sftp-client 11 / basic-ftp 5
- **凭据加密**：Electron `safeStorage`（OS 钥匙串）
- **校验**：Zod（所有 IPC 入参必须校验）
- **测试**：Vitest

完整对比与选型理由：[docs/02-tech-stack.md](./docs/02-tech-stack.md)、[docs/07-dependencies.md](./docs/07-dependencies.md)。

## 必跑命令

```bash
npm run dev              # 并行启动 Vite + Electron（开发）
npm run lint             # 主+渲染双 tsc --noEmit，提交前必跑
npm run build            # build:renderer + build:main
npm test                 # vitest run
npm run package          # electron-builder 出包
```

构建产物路径已固定，**勿改**：
- 主进程编译到 `dist/main/main/index.js`（`package.json` 的 `main` 字段指向此处）
- 预加载到 `dist/main/preload/index.js`
- 渲染到 `dist/renderer/`，生产环境 `loadFile('../../renderer/index.html')`

## 三个 tsconfig（容易踩坑）

| 文件 | 用途 | 输出 |
|---|---|---|
| `tsconfig.json` | 仅提供路径别名 `@shared/*`、`@renderer/*` 给编辑器 | — |
| `tsconfig.main.json` | 主进程/预加载/shared，CommonJS | `dist/main/` |
| `tsconfig.renderer.json` | 渲染层，ESM，`noEmit`（Vite 负责打包） | — |

修改 `src/main/**` 或 `src/preload/**` 后必须重跑 `npm run build:main`，否则 Electron 加载旧代码。

## 职责边界（CRITICAL — 不要越界）

```
src/
├── shared/          # ⚠️ 纯类型与常量。禁止 import 任何 node/electron/react 模块
├── preload/         # 仅暴露 window.api，通过 contextBridge。不写业务逻辑
├── main/            # 所有 Node 能力（文件、网络、Git、DB、密钥）只允许在这里
│   ├── db/          # better-sqlite3，schema 改动走迁移
│   ├── security/    # credential-vault：safeStorage 加密；其他模块禁止直接读密码│   ├── transport/    # SFTP / FTP 适配器（sftp-adapter / ftp-adapter / index 按协议分发）│   └── ipc/         # 每个领域一个 *-handlers.ts，入口在 main/index.ts 注册
└── renderer/        # 纯 UI。禁止 require('fs'/'electron'/...)，必须经 window.api
    ├── pages/       # 路由级页面，对应一个 IPC 领域
    ├── components/  # 共享组件（如 PageHero）
    └── styles/      # global.css（深色玻璃拟态主题，勿替换主色）
```

**铁律**：
1. 渲染进程 ↔ 主进程**只通过** `window.api.invoke(channel, ...args)`。Channel 常量在 `src/shared/ipc-channels.ts`，新增 channel 必须先加到那里。
2. 凭据明文**禁止**写入 `servers` 表或日志。新增涉密字段 → 用 `credential-vault` 存 ref，表里只存 ref。
3. IPC handler 入参**必须** Zod 校验后再用，参考 `server-handlers.ts` 写法。
4. 共用类型放 `src/shared/types.ts`，主/渲染都从此处 import；不要在两边重复定义。

## 开发规范

- **不可变更新**：状态/对象用 `{...old, field: v}` / `[...arr]`，不要 `arr.push`、`Object.assign(obj, ...)`。
- **错误处理**：IPC handler 抛错由前端 `AntdApp.message` 提示；不要静默 catch。
- **小文件**：单文件 < 400 行；handler 文件按领域拆分（已有 server/project/git/deploy 四类）。
- **样式**：渲染层使用 `global.css` 中的 CSS 变量与 `.glass-card` / `PageHero` 模式，不要重新引入 AntD `Layout/Sider/Header`（已被深色 shell 替代）。
- **安全**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox` 友好，不要为方便而关闭。

详细 OWASP 对齐：[docs/05-security.md](./docs/05-security.md)。

## 功能模块映射

| 领域 | IPC handlers | UI 页面 | 文档 |
|---|---|---|---|
| 服务器管理 | `src/main/ipc/server-handlers.ts` + `src/main/transport/` | `src/renderer/pages/ServersPage.tsx` | [04-core-flows §服务器](./docs/04-core-flows.md) |
| 项目管理 | `project-handlers.ts` | `ProjectsPage.tsx` | 同上 |
| Git 差异 | `git-handlers.ts` | `DeployPage.tsx` | [04-core-flows §变更识别](./docs/04-core-flows.md) |
| 部署执行（M5） | `deploy-handlers.ts`（占位） | `DeployPage.tsx` | [04-core-flows §部署](./docs/04-core-flows.md) |
| 历史/回滚（M6） | 待建 | `HistoryPage.tsx` | [06-roadmap.md](./docs/06-roadmap.md) |

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

- 改完主进程忘记 `build:main` → Electron 仍跑旧 JS。`npm run dev` 已含编译，但只在启动时跑一次，热改需手动重启或加 watcher。
- `preload` 暴露的方法签名是**变参** `invoke<T>(channel, ...args)`，不要回退成单参数。
- SQLite 路径在 `app.getPath('userData')`，开发期清库：删除该目录下 `selfdeploy.sqlite*` 三个文件。
- `better-sqlite3` 是 native 模块，Node 版本变化后需 `npm rebuild` 或 `electron-rebuild`。
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
- [ ] IPC 入参有 Zod 校验
- [ ] 涉密字段走 `credential-vault`，未明文落库
- [ ] 渲染层未引入 node/electron 直接依赖
