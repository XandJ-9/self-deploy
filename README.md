# SelfDeploy

本地项目快速部署到服务器的桌面工具。当前稳定版基于 **Electron + React + TypeScript**，Tauri 迁移分支正在将桌面后端迁移到 **Tauri v2 + Rust**。应用使用 **SFTP/FTP** 上传，通过 **Git 提交区间** 识别变更并增量同步。

> 📚 完整设计文档见 [docs/](./docs/README.md)：需求、技术选型、架构、核心流程、安全设计、里程碑、依赖清单。

## 功能

- 服务器管理（SFTP/FTP，密码/私钥；凭据加密存于系统钥匙串）
- 项目管理（本地路径 + 远端部署路径 + 排除规则）
- Git 提交选择 + 文件差异预览（A/M/D/R）
- 部署执行（M5 ✅ 临时目录 + rename 原子切换 + 实时日志流）、部署历史与回滚（M6）

## 应用截图

### 服务器管理

![服务器管理](imgs/01-server.png)

### 部署执行

![部署执行](imgs/02-deploy.png)

### 项目管理

![项目管理](imgs/03-project.png)

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron 32（稳定版）/ Tauri v2（迁移中） |
| 渲染层 | React 18 + Vite + Ant Design 5 |
| 主进程 | Node 22 + better-sqlite3 + simple-git |
| Tauri 后端 | Rust + Tauri commands（迁移中） |
| 同步协议 | ssh2-sftp-client / basic-ftp |
| 凭据安全 | Electron `safeStorage` (OS 钥匙串) |
| 校验 | Zod |

## 目录结构

```
src/
├── shared/           # 主/渲染共用的类型与常量
├── preload/          # contextBridge 暴露安全 API
├── main/             # Electron 主进程
│   ├── db/           # SQLite 初始化与迁移
│   ├── security/     # 凭据保险柜
│   └── ipc/          # 各模块 IPC handlers
└── renderer/         # React UI
    ├── pages/
    └── types/
src-tauri/            # Tauri v2 后端（迁移中）
```

## 开发

### 快速启动

| 命令 | 用途 |
|---|---|
| `npm install` | 装依赖；`postinstall` 会自动为当前 Electron 架构编译 native 模块 |
| `npm run dev` | 常规开发启动（跨平台，Vite + Electron 并发） |
| `npm run dev:tauri` | Tauri 开发启动（需要 Rust 工具链） |
| `npm run dev:fresh` | 先 `rebuild:dev` 再 `dev`；架构错乱（如刚打过包）时一键修复 |
| `npm run rebuild:dev` | 仅为当前平台/Electron 重建 `better-sqlite3` 等 native 模块 |
| `npm run lint` | 主 + 渲染双 `tsc --noEmit`，提交前必跑 |
| `npm run build` | 编译主进程 + 渲染产物到 `dist/` |
| `npm run build:tauri` | Tauri 打包（需要 Rust 工具链） |
| `npm test` | Vitest 单元测试 |

### macOS（arm64 / Intel）

```bash
npm install
npm run dev           # 日常开发
npm run dev:fresh     # 如近期跑过 package:* 或换过 Node 版本
npm run package:mac   # 打 dmg（dual-arch）；结束后 postpackage:mac 自动还原 dev binding
```

### Windows（x64）

```bash
npm install           # 需要 Visual Studio Build Tools (C++) + Python 3
npm run dev           # 脚本已用 cross-env，无 shell 依赖
npm run dev:fresh     # native 报错时使用
npm run package:win   # 出 nsis 安装包
```

> ⚠️ **跨架构打包不会重建 native**。在 macOS 上构建 Windows 安装包（或反之）需要在目标平台上分别运行 `package:win` / `package:mac`。
>
> ⚠️ **Windows 编译前置**：若 `npm install` 时 `better-sqlite3` / `cpu-features` 编译报错，安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选 "Desktop development with C++"）+ Python 3。

### 本地联调远端服务器（SFTP + FTP，零配置）

```bash
docker compose -f docker/test-servers/docker-compose.yml up -d
# SFTP  127.0.0.1:2222  demo / demo123  remoteBasePath=/upload
# FTP   127.0.0.1:2121  demo / demo123  remoteBasePath=/
```

详见 [docker/test-servers/README.md](./docker/test-servers/README.md)。

## 构建打包

```bash
npm run build        # 编译主进程 + 渲染产物
npm run package      # electron-builder 输出到 release/
```

## 里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| M1 脚手架 | ✅ | Electron + React + SQLite + IPC 打通 |
| M2 服务器管理 | ✅ | CRUD + 真实 SFTP/FTP 连接测试 + 编辑入口 |
| M3 项目管理 | ✅ | CRUD + 目录选择 |
| M4 Git 集成 | ✅ | 提交列表 + diff |
| M5 部署执行 | ✅ | 上传/删除/临时目录原子切换、进度与日志流 |
| M6 历史与回滚 | ✅ | 历史筛选、文件级清单、反向 diff 一键回滚 |
| M7 增强 | ✅ | `.deployignore`、部署前后 Hook、并发上传、日志落盘、FTP 端到端验证 |
| M8 Tauri 迁移 | 🚧 | 保留 React UI，逐步迁移 Electron 主进程到 Tauri v2 + Rust |

## 安全说明

- 密码与私钥**不会**以明文写入 SQLite，使用 `safeStorage` 调用 macOS Keychain / Windows DPAPI / Linux libsecret 加密。
- 所有 IPC 入参均经 Zod 校验。
- 默认推荐 SFTP；选择 FTP 时 UI 会有提示（M2 接入时启用）。
