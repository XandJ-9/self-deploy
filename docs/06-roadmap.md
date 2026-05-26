# 06 · 开发里程碑

| 阶段 | 内容 | 产出 | 状态 |
|---|---|---|---|
| **M1 脚手架** | Tauri + React + SQLite + IPC 通道打通 | 可启动空壳应用 | ✅ |
| **M2 服务器管理** | CRUD + 连接测试 + 凭据加密 + Adapter 抽象 | 服务器页面完整可用 | ✅ |
| **M3 项目管理** | CRUD + 本地路径选择 + Git 仓库识别 | 项目页面可用 | ✅ |
| **M4 Git 集成** | 提交列表、diff 预览 | 可在 UI 上查看任意提交区间变更 | ✅ |
| **M5 SFTP 部署** | 上传 + 删除 + 临时目录原子切换 + 日志流 | MVP 完成（可端到端部署） | ✅ |
| **M6 历史与回滚** | 部署记录列表、详情、一键回滚 | 1.0 候选 | ✅ |
| **M7 增强** | FTP 支持、`.deployignore`、部署前后 Hook、并发限流、日志落盘 | 1.1 | ✅ |

## 验收标准

### M5 验收

- 选择项目 + 服务器 + commit 区间后，能够将变更文件正确同步到远端
- 失败任一文件 → 整个部署标记 failed，临时目录被清理
- 远端被删除的文件 = `git diff` 中的 D 项
- 渲染端实时看到上传进度（每文件 begin/end 事件）
- 部署完成后历史页可看到此次记录

### M6 验收

- 历史页支持按项目/服务器/状态筛选
- 详情页展示文件级清单及状态
- 「回滚」按钮可将远端文件恢复到上一次成功部署的状态
- 回滚动作本身也是一次 deployment 记录（`status='rolledback'`）

## 当前状态摘要

- 项目骨架已初始化，Tauri 主线与前端类型检查、构建均通过
- 服务器、项目、Git 三个模块的 IPC 与 UI 占位齐全
- 凭据保险柜已可用（`safeStorage` 加密）
- 数据库自动迁移生效（4 张表 + 2 索引）

## 下一步推荐

1. **打包与发布**：Windows MSI/NSIS 安装包签名与自动更新
2. 体验打磨：详情面板支持复制日志、回滚链路可视化

## M7 完成回顾

- `.deployignore`：新增 `src/main/deploy/ignore.ts`，合并项目自带 `excludePatterns` 与本地仓库根 `.deployignore`，使用 `ignore@^7` 实现 gitignore 语义；过滤在 `executeDeployment` 内进行，同时覆盖正向部署与回滚；命中文件在 `deployment_files` 标记 `skipped` 并在日志记录数量
- 部署前后 Hook：`projects` 表新增 `pre_deploy_cmd` / `post_deploy_cmd`（幂等 `ALTER TABLE` 迁移）；`deploy-service` 使用 `child_process.spawn`（POSIX `sh -c`、Windows `cmd.exe /d /s /c`）逐行回显；pre-hook 非零退出 → 部署失败；post-hook 非零退出 → 仅警告，不影响成功状态；ProjectsPage 增加两个 TextArea
- 并发上传：新增 `src/main/deploy/transport-pool.ts`，按 `UPLOAD_CONCURRENCY=4` 创建独立 transport，worker-queue 短路；切换/清理仍走单连接 `primary()` 串行以避免远端目录竞争
- 日志落盘：`openDeployLog` 写入 `app.getPath('userData')/deploy-logs/{deploymentId}.log`，`deployments.log_path` 记录路径；新增 `IPC.Deploy.Log` 通道；HistoryPage 详情面板增加「查看完整日志」二级 Drawer
- FTP 验证：发现并修复 `ftp-adapter.mkdirp` 的 CWD 漂移 bug（原实现调用 `ensureDir` 后未恢复 CWD，导致后续相对路径错乱、chroot 用户下 `cd '/'` 会触达真实根目录）；改为 `pwd` 记录原 CWD，`finally` 中 `cd` 回去；新增 `tests/integration/ftp.spec.ts` 端到端冒烟（依赖 `docker/test-servers` FTP 容器）

## M6 完成回顾

- IPC 新增 `deploy:detail` / `deploy:rollback`；`deploy:history` 支持 `{projectId, serverId, status, limit}` 过滤对象（兼容旧的传数字签名）
- `src/main/deploy/deploy-service.ts` 抽出 `executeDeployment(...)`，`runDeploy` 与新增 `runRollback(originDeploymentId, onLog)` 共用同一执行管线
- 回滚实现：反向 diff（`origin.toCommit → origin.fromCommit`），文件内容统一从 git 取自 `origin.fromCommit`，避免与工作区不一致；新生成的 deployments 行 `status='rolledback'`，from/to commit 互换
- 拒绝条件：原部署非 `success` 或缺少 `fromCommit`（首次部署）时回滚直接报错
- `HistoryPage`：按项目 / 服务器 / 状态筛选、表格列出 commit 区间 + 耗时 + 状态标签、详情 Drawer 展示文件级清单与每文件状态、行内 Popconfirm 回滚按钮（仅成功且非首次部署可点）
- 共享类型新增 `DeploymentFileRecord` / `DeploymentDetail` / `FileDeployStatus`

## M5 完成回顾

- 新增 `src/main/transport/types.ts`：`Transport` 接口（`connect/close/mkdirp/put/remove/rename/exists/removeDir`）
- `SftpTransport` / `FtpTransport` 类实现该接口；`createTransport(server, secret)` 工厂；旧 `testConnection` 保留
- 新增 `src/main/deploy/deploy-service.ts`：编排 diff → 上传到 `.deploy-tmp-<id>/` → 逐文件 `remove + rename` 切换 → 处理 DELETE/RENAME → 清理 tmp
- 失败路径：临时目录被清理，`deployments.status='failed'`
- 工作区与 `toCommit` 不一致时，自动用 `git show` 取出文件再上传
- preload 暴露 `on(channel, listener)` 白名单订阅，仅允许 `deploy:onLog`
- `IPC.Deploy.Run` 接受 `{projectId, serverId, fromCommit, toCommit}`，通过 `webContents.send` 广播日志（含进度）
- `IPC.Deploy.History` 返回最近 100 条 deployments
- DeployPage：新增服务器选择器、执行按钮接入、进度条、滚动日志面板

## M2 完成回顾

- 新增 `src/main/transport/`：`sftp-adapter.ts`（ssh2-sftp-client）/ `ftp-adapter.ts`（basic-ftp）/ `index.ts`（按协议分发）
- `server:test` 真实建立连接并探测 `remoteBasePath` 是否存在，超时 8s
- 新增 `server:update` 通道：支持改基本信息 + 可选刷新凭据（留空不动）
- ServersPage 增加「编辑」入口、测试按钮 loading 态
- 本地联调容器：`docker/test-servers/`（atmoz/sftp + delfer/alpine-ftp-server），详见该目录 README
