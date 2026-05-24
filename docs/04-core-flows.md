# 04 · 核心流程

## 1. 变更识别

支持两类来源：**Git 增量** 与 **本地文件夹**。

### 1.1 Git 增量（默认）

| 模式 | from | to | 说明 |
|---|---|---|---|
| 首次全量 | `null` | HEAD 或选定 commit | `git ls-tree -r --name-only <to>` |
| 增量部署 | 上次部署的 `to_commit` | 本次选定 commit | `git diff --name-status <from> <to>` |
| 指定区间 | 手动选 from | 手动选 to | 同上 |

伪代码：

```ts
const changes = from
  ? await git.raw(['diff', '--name-status', `${from}..${to}`])
  : await git.raw(['ls-tree', '-r', '--name-only', to]);
// → [{ path, action: 'ADD'|'MODIFY'|'DELETE'|'RENAME', oldPath? }]
```

### 1.2 本地文件夹（适用于未入库构建产物，如 `dist/`、`build/`）

- 输入：
  - `sourceDir`：项目根下的子目录（留空 / `.` 表示项目根）
  - `targetSubDir`（可选）：远端子目录，相对部署根；留空 / `.` 表示直接铺到部署根
- 扫描逻辑：`src/main/deploy/folder-scan.ts` 递归 `readdirSync`，应用 `loadIgnoreFilter`（`.deployignore` + `excludePatterns`），**强制跳过 `.git`**，不跟随 symlink
- 输出：`ChangedFile[]`，所有项 `action='ADD'`；path 以 `sourceDir` 为根（上传后映射到远端 `targetRoot = deployRoot + targetSubDir` 下同名路径）
- IPC：`IPC.Deploy.ScanFolder({ projectId, sourceDir })` → 预览用（仅决定扫描范围，不涉及远端路径）；实际执行部署走 `IPC.Deploy.Run({ source: { type:'folder', sourceDir, targetSubDir } })`
- DB 标记：deployments 行 `from_commit=NULL`，`to_commit='folder:<sourceDir>[ → <targetSubDir>]@<ISO>'`（供历史页区分）
- **不支持回滚**：本地文件夹模式无前置版本快照，`runRollback` 检测到 `to_commit` 以 `folder:` 开头即报错返回

## 2. 部署执行（M5 实现）

DeployService（`src/main/deploy/deploy-service.ts`）面向 `Transport` 接口编排，不感知 SFTP / FTP 差异。

```
1. 校验
   ├─ 项目/服务器记录存在
   └─ 凭据可读（safeStorage 解密）

2. 计算差异→生成文件清单
   ├─ from=null 走 ls-tree -r；from 有值走 diff --name-status
   └─ 插入 deployments(status='running') + deployment_files(status='pending')

3. 建立连接：createTransport(server, secret).connect()

4. 上传到临时目录 `<deployRoot>/.deploy-tmp-<deploymentId>/`（deployRoot = remoteBasePath + project.remotePath，避免上层不可写导致 mkdir Permission denied）
   ├─ 保持目录结构（put 前 mkdirp(parent)）
   ├─ git 模式：未在工作区的文件用 `git show <to>:<path>` 取出到本地 tmp
   ├─ folder 模式：源始终为 `<sourceDirAbs>/<relPath>`，不走 git
   └─ 仅上传 ADD/MODIFY/RENAME 的文件

5. 逐文件原子切换到目标路径
   ├─ `targetRoot = deployRoot + targetSubDir`（folder 模式可选），其他场景 targetRoot = deployRoot
   ├─ mkdirp(parent(target))
   ├─ remove(target)  // 幂等，不存在也 OK
   └─ rename(tmpRemote, target)  // SFTP/FTP 的 rename 都不能覆盖，所以必须先 remove

6. 处理删除
   ├─ DELETE 动作→ remove(target)
   └─ RENAME.oldPath → remove(oldTarget)

7. 清理：removeDir(tmpRoot)

8. 收尾
   ├─ 成功：UPDATE deployments SET status='success', finished_at
   └─ 失败：尝试 removeDir(tmpRoot)，UPDATE status='failed'、finished_at
```

> 注：上传阶段在 M7 起改为 `UPLOAD_CONCURRENCY=4` 的并发 worker-queue（每个 worker 一个独立 transport，见 `TransportPool`）。切换 / 清理 / mkdirp 仍走单连接 `primary()` 串行，避免远端目录竞争；单文件切换间仍有隐含间隙，不提供跨文件事务语义。
>
> **过滤**：`executeDeployment` 入口处加载 `.deployignore` + 项目 `excludePatterns`，命中文件直接以 `status='skipped'` 写入 `deployment_files` 并跳过传输；过滤逻辑同样作用于回滚（共用同一入口）。
>
> **Hooks**：上传开始前执行 `pre_deploy_cmd`（失败 → 部署失败）；`removeDir(tmpRoot)` 后执行 `post_deploy_cmd`（失败 → 仅警告）。命令在项目本地路径下用 `child_process.spawn` 执行，POSIX 走 `sh -c`、Windows 走 `cmd.exe /d /s /c`，stdout/stderr 行缓冲转发到日志流。

## 3. 回滚流程

> 仅限 **Git 模式** 部署。本地文件夹模式的 `deployments.to_commit` 以 `folder:` 开头，`runRollback` 会直接报错拒绝。

```
1. 选择某次 success 的历史部署
2. 读取其 deployment_files 清单
3. 通过 git 取出对应 from_commit 的文件内容
4. 反向操作：被 ADD 的 → 删除；被 MODIFY/DELETE 的 → 还原内容
5. 新建 deployment 记录，status='rolledback'
```

## 4. 实时日志

- DeployService 接受一个 `(evt: DeployLogEvent) => void` 回调，该回调由 `deploy-handlers.ts` 包装为广播：遍历 `webContents.getAllWebContents()` 发送 `IPC.Deploy.OnLog`
- 事件结构：`{ deploymentId, level: 'info'|'warn'|'error', message, progress?: 0..1, timestamp }`
- 渲染端通过 preload 暴露的白名单订阅 API `window.api.on(channel, listener)` 接收；仅允许 `IPC.Deploy.OnLog`
- 当前实时流通过 `webContents.send` 广播；同时 `openDeployLog(id)` 把所有事件追加到 `app.getPath('userData')/deploy-logs/{id}.log`，路径写入 `deployments.log_path`，前端通过 `IPC.Deploy.Log` 拉取完整文本（历史页详情面板「查看完整日志」按钮）

## 5. 状态机

```
pending → running → success
                 ↘ failed → (可选 rolledback)
```

| 状态 | 含义 |
|---|---|
| `pending` | 已创建，未开始上传 |
| `running` | 上传中 |
| `success` | 全部文件成功 |
| `failed` | 任一文件失败且未回滚 |
| `rolledback` | 用户主动回滚后的终态 |
