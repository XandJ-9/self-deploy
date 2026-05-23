# 03 · 架构设计

## 进程结构

```
┌───────────────────────────────────────────────┐
│  Renderer (React + AntD)                      │
│  ├─ 服务器管理页 / 项目管理页                  │
│  ├─ 部署向导（选项目→选 commit→预览→执行）    │
│  └─ 部署历史 / 实时日志                        │
└──────────────┬────────────────────────────────┘
               │ IPC (ipcRenderer.invoke / on)
               │ 通过 preload contextBridge 暴露
┌──────────────▼────────────────────────────────┐
│  Main Process (Node)                          │
│  ├─ ServerService    (CRUD + 连接测试)        │
│  ├─ ProjectService   (CRUD)                   │
│  ├─ GitService       (simple-git)             │
│  ├─ DeployService    (编排：diff → 上传 → 记录)│
│  ├─ SftpAdapter / FtpAdapter (策略模式)       │
│  └─ CredentialVault  (safeStorage 加解密)     │
└──────────────┬────────────────────────────────┘
               │
        ┌──────▼─────┐   ┌───────────────┐
        │  SQLite DB │   │ OS Keychain   │
        └────────────┘   └───────────────┘
```

## 目录结构

```
src/
├── shared/           # 主/渲染共用的类型与常量
│   ├── types.ts
│   └── ipc-channels.ts
├── preload/          # contextBridge 暴露安全 API
│   └── index.ts
├── main/             # Electron 主进程
│   ├── index.ts
│   ├── db/           # SQLite 初始化与迁移
│   ├── security/     # 凭据保险柜
│   ├── ipc/          # 各模块 IPC handlers
│   ├── transport/    # SFTP / FTP 适配器实现 Transport 接口（types/sftp-adapter/ftp-adapter/index）
│   └── deploy/       # DeployService：diff→上传→原子切换→清理
└── renderer/         # React UI
    ├── App.tsx
    ├── main.tsx
    ├── pages/
    └── types/
```

## 数据模型（SQLite）

```sql
servers(id, name, protocol, host, port, username,
        auth_type, credential_ref, remote_base_path, created_at)

projects(id, name, local_path, default_server_id,
         remote_path, exclude_patterns,
         pre_deploy_cmd, post_deploy_cmd, created_at)

deployments(id, project_id, server_id,
            from_commit, to_commit, file_count,
            status, log_path, started_at, finished_at)

deployment_files(deployment_id, path, action, size, status)
-- action: ADD | MODIFY | DELETE | RENAME
-- status: pending | success | failed | skipped
```

### 关键约束

- `projects.default_server_id` → `servers.id` `ON DELETE SET NULL`
- `deployments.project_id` / `server_id` → `ON DELETE CASCADE`
- 索引：`deployments(project_id)`、`deployment_files(deployment_id)`

## 部署管线（M5–M7）

- `executeDeployment(...)`（`src/main/deploy/deploy-service.ts`）是部署 / 回滚共用入口
- 过滤层：`loadIgnoreFilter(localPath, excludePatterns)` 合并 `.deployignore` + 项目排除规则（`ignore` npm 包），命中文件写入 `deployment_files` 并 `status='skipped'`
- 连接池：`TransportPool`（`src/main/deploy/transport-pool.ts`）按 `UPLOAD_CONCURRENCY=4` 建立独立 transport；上传走 worker-queue 并发；切换 / 清理 / mkdirp 走 `primary()` 串行避免远端目录竞争
- Hooks：`pre_deploy_cmd` 失败抛错 → 部署失败；`post_deploy_cmd` 失败仅警告；执行用 `child_process.spawn`，POSIX `sh -c` / Windows `cmd.exe /d /s /c`，行缓冲转发到 `onLog`
- 日志落盘：`openDeployLog(id)` 写入 `app.getPath('userData')/deploy-logs/{id}.log`，路径回写到 `deployments.log_path`，前端通过 `IPC.Deploy.Log` 拉取

## IPC 通道

按领域分组，常量定义在 `src/shared/ipc-channels.ts`：

- `Server.*`：list / create / update / remove / test
- `Project.*`：list / create / update / remove
- `Git.*`：log / diff / status
- `Deploy.*`：run / history / detail / rollback / log / onLog（事件）

## 设计原则

- **关注点分离**：Service 编排业务、Adapter 屏蔽协议、Repository 屏蔽存储
- **不可变数据流**：Service 之间传递新对象，不就地修改
- **策略模式**：`SftpTransport` 和 `FtpTransport` 实现同一 `Transport` 接口（`src/main/transport/types.ts`），由 `createTransport(server, secret)` 工厂分发
- **小文件优先**：每个 IPC 模块单独文件，便于维护
- **运行时校验**：IPC 入参全部经 Zod 校验，杜绝渲染端注入异常数据
