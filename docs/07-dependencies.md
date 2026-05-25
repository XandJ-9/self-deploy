# 07 · 依赖清单

## 运行时依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `electron` | ^32 | 桌面运行时 |
| `@tauri-apps/api` | ^2 | Tauri 前端 API（迁移期） |
| `@tauri-apps/plugin-dialog` | ^2 | Tauri 目录选择插件（迁移期） |
| `react` / `react-dom` | ^18 | UI 渲染 |
| `react-router-dom` | ^6 | 渲染端路由 |
| `antd` | ^5 | UI 组件库 |
| `zustand` | ^4 | 渲染端状态管理 |
| `simple-git` | ^3 | Git 命令封装 |
| `ssh2-sftp-client` | ^11 | SFTP 客户端 |
| `basic-ftp` | ^5 | FTP 客户端（Promise） |
| `ignore` | ^7 | gitignore 语义的路径匹配，驱动 `.deployignore` 与 `excludePatterns` |
| `better-sqlite3` | ^11 | 本地 SQLite（同步 API） |
| `zod` | ^3 | IPC/表单运行时校验 |
| `@trpc/server` / `@trpc/client` | ^11 | 预留，未来 IPC 类型安全 |
| `superjson` | ^2 | trpc 时序列化 |

## 开发依赖

| 包 | 用途 |
|---|---|
| `typescript` | TS 编译 |
| `vite` + `@vitejs/plugin-react` | 渲染端开发服务器与构建 |
| `electron-builder` | 打包 dmg/exe/AppImage |
| `@tauri-apps/cli` | Tauri 开发与打包命令 |
| `concurrently` + `wait-on` + `cross-env` | dev 脚本编排 |
| `vitest` | 单元测试 |
| `@types/*` | 类型声明 |

## Rust 依赖（Tauri 迁移）

| crate | 用途 |
|---|---|
| `tauri` / `tauri-build` | Tauri v2 桌面运行时与构建 |
| `tauri-plugin-dialog` | 原生目录选择 |
| `serde` / `serde_json` | command 入参和返回值序列化 |
| `rusqlite` (`bundled`) | Tauri 后端 SQLite 初始化、迁移与 CRUD |

## 关键脚本

```bash
npm run dev           # Vite + Electron 并行启动（HMR）
npm run dev:tauri     # Tauri v2 开发启动（需要 Rust 工具链）
npm run build         # 编译主进程 + 渲染产物到 dist/
npm run build:tauri   # Tauri 打包（需要 Rust 工具链）
npm run package       # electron-builder 输出到 release/
npm run lint          # 双 tsc --noEmit
npm test              # vitest
```

## 选型理由速查

- **better-sqlite3 > sqlite3**：同步 API、原生构建、更快
- **simple-git > nodegit**：纯 JS、无需编译原生模块、API 简洁
- **ssh2-sftp-client > 直接用 ssh2**：高阶 API（put / get / list / delete）
- **AntD > MUI**：表单/表格场景模板化程度高、中文文档完善
- **Zustand > Redux**：桌面应用状态简单，Zustand 0 模板代码
- **Zod > Joi/Yup**：TS 类型推导能力最强
