# SelfDeploy

本地项目快速部署到服务器的桌面工具。当前分支主线为 **Windows Tauri v2 + Rust + React + TypeScript**；`src/main` 与 `src/preload` 仅作为 legacy 基线保留。应用使用 **SFTP/FTP** 上传，通过 **Git 提交区间** 识别变更并增量同步。

> 📚 完整设计文档见 [docs/](./docs/README.md)：需求、技术选型、架构、核心流程、安全设计、里程碑、依赖清单。

## 仓库组织（双平台双框架）

当前仓库已进入双平台组织的第 1 阶段（骨架与命名统一）：

| 目录 | 角色 |
|---|---|
| `apps/win-tauri/` | Windows + Tauri 应用壳（规划主线） |
| `apps/mac-electron/` | macOS + Electron 应用壳（规划主线） |
| `apps/shared-renderer/` | 双端共享的 React 渲染层 |
| `packages/domain/` | 纯业务模型与用例接口 |
| `packages/ipc-contract/` | 双端共享 IPC 协议与类型 |
| `packages/platform-adapter/` | 统一运行时 API 适配层 |
| `packages/testkit/` | 跨端测试支撑与 fixture |

> 详细执行路径见 [docs/09-repo-organization-dual-framework.md](./docs/09-repo-organization-dual-framework.md)。

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
| 桌面框架 | Tauri v2（Windows 主线） |
| 渲染层 | React 18 + Vite + Ant Design 5 |
| 桌面后端 | Rust + Tauri commands + rusqlite + Windows DPAPI + ssh2/ftp |
| 同步协议 | Rust `ssh2` / `ftp` |
| 凭据安全 | Windows DPAPI |
| 校验 | Rust `serde` + 渲染端表单校验 |

> Electron 仅保留为 legacy 回退基线，相关目录与脚本已在下方目录结构和开发命令中标明。

## 目录结构

```
apps/
├── win-tauri/        # Windows Tauri 壳（当前主线）
├── mac-electron/     # macOS Electron 壳（当前主线）
└── shared-renderer/  # 双端共享 React 渲染层（当前主线）
packages/
├── domain/           # 共享业务模型与类型
├── ipc-contract/     # 共享 IPC 协议定义
└── platform-adapter/ # 运行时适配层

# 兼容层（过渡期保留）
src-tauri/            # 旧路径副本，后续计划移除
src/main/             # 旧路径副本，后续计划移除
src/preload/          # 旧路径副本，后续计划移除
src/shared/           # 旧路径副本，后续计划移除
src/renderer/         # 旧路径副本，后续计划移除
```

## 开发

### 快速启动

| 命令 | 用途 |
|---|---|
| `npm install` | 安装前端、Tauri CLI 与 Rust 侧依赖 |
| `npm run dev` | Tauri 开发启动（需要 Rust 工具链） |
| `npm run dev:tauri` | 同 `npm run dev` |
| `npm run dev:win` | Windows 入口（当前映射到 Tauri） |
| `npm run legacy:dev` | legacy Electron 回退启动 |
| `npm run dev:mac` | macOS 入口（当前映射到 Electron legacy） |
| `npm run rebuild:dev` | legacy Electron native 依赖重建 |
| `npm run lint` | 主 + 渲染双 `tsc --noEmit`，提交前必跑 |
| `npm run build` | Tauri 打包（需要 Rust 工具链） |
| `npm run build:win` | Windows 构建入口（当前映射到 Tauri） |
| `npm run build:mac` | macOS 构建入口（当前映射到 Electron legacy） |
| `npm run legacy:build` | legacy Electron 编译主进程 + 渲染产物 |
| `npm test` | Vitest 单元测试 |

### Windows（x64）

```bash
npm install           # 需要 Visual Studio Build Tools (C++) + Python 3
npm run dev           # Tauri 开发
npm run package:win   # Tauri 打包
```

> ⚠️ **Windows 编译前置**：Tauri 打包需要 Rust MSVC 工具链；如 legacy Electron native 依赖编译报错，安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾选 "Desktop development with C++"）+ Python 3。

### 本地联调远端服务器（SFTP + FTP，零配置）

```bash
docker compose -f docker/test-servers/docker-compose.yml up -d
# SFTP  127.0.0.1:2222  demo / demo123  remoteBasePath=/upload
# FTP   127.0.0.1:2121  demo / demo123  remoteBasePath=/
```

详见 [docker/test-servers/README.md](./docker/test-servers/README.md)。

## 构建打包

```bash
npm run build        # Tauri 打包
npm run package      # Tauri 输出 Windows MSI/NSIS 安装包
npm run package:win  # 同 npm run package
```

## 里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| M1 脚手架 | ✅ | Tauri + React + SQLite + IPC 打通 |
| M2 服务器管理 | ✅ | CRUD + 真实 SFTP/FTP 连接测试 + 编辑入口 |
| M3 项目管理 | ✅ | CRUD + 目录选择 |
| M4 Git 集成 | ✅ | 提交列表 + diff |
| M5 部署执行 | ✅ | 上传/删除/临时目录原子切换、进度与日志流 |
| M6 历史与回滚 | ✅ | 历史筛选、文件级清单、反向 diff 一键回滚 |
| M7 增强 | ✅ | `.deployignore`、部署前后 Hook、并发上传、日志落盘、FTP 端到端验证 |
| M8 Tauri 迁移 | ✅ | T0-T7 完成：Tauri 成为默认运行时，部署增强与发布脚本已收口 |

## 安全说明

- 密码与私钥**不会**以明文写入 SQLite，Windows 使用 DPAPI，非 Windows 使用系统钥匙串。
- Tauri command 入参通过 `serde` 结构体反序列化与领域校验处理。
- 默认推荐 SFTP；选择 FTP 时 UI 会有提示（M2 接入时启用）。
