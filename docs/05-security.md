# 05 · 安全设计

## 凭据保险柜

### 设计

- 数据库 `servers` 表只存 `credential_ref`（UUID），**不存** 任何密码/私钥明文
- 实际密文存放于 `credential_vault` 表（`ref TEXT PRIMARY KEY, cipher BLOB`）
- legacy Electron 基线通过 `safeStorage` 调用系统加密能力；Tauri 主线按平台调用 Windows DPAPI 或 macOS Keychain
- Tauri 写入凭据前按平台执行加密/钥匙串保存；若系统安全设施不可用则拒绝保存

### API

```ts
saveCredential(secret: string): string  // 返回 ref
readCredential(ref: string): string     // 仅主进程可用
updateCredential(ref, secret): void
deleteCredential(ref): void
```

> 渲染端**不可**直接调用 `readCredential`。所有需要明文的场景都在主进程内部使用完后即丢弃。

### Tauri 迁移目标

- 数据库仍只保存 `credential_ref`，不保存密码/私钥明文
- Rust 后端按平台处理凭据：Windows 使用 DPAPI 加密密文，macOS 使用 Keychain 保存明文并在 vault 表中保存 Keychain account 引用
- `credential_vault` 表不保存密码/私钥明文；`credential_ref` 使用 `win-dpapi:` / `mac-keychain:` 前缀区分平台凭据，旧版 `dpapi:` 仍兼容读取
- 前端只能通过 Tauri command 提交或刷新凭据，不能读取明文
- Tauri capabilities 默认只开放必要能力；文件选择使用 dialog 插件，任意文件系统读写只允许 Rust 后端内部执行

Tauri SFTP 连接测试读取私钥内容后，仅为 `ssh2` 认证短暂写入系统临时目录，认证完成后立即删除；私钥仍不写入 SQLite、业务日志或前端状态。

## OWASP Top 10 对齐

| 项 | 措施 |
|---|---|
| A01 失效的访问控制 | 桌面单用户；preload 仅暴露白名单 API |
| A02 加密失败 | 凭据走 OS 钥匙串；SFTP 优先于 FTP |
| A03 注入 | Tauri command 入参经 `serde` 反序列化与领域校验；SQL 使用 `rusqlite` 参数化 |
| A05 安全配置错误 | `contextIsolation: true` / `nodeIntegration: false` / `sandbox` 渲染端 |
| A07 身份认证失败 | 私钥优于密码；记录已知主机指纹（M2 实施） |
| A08 软件与数据完整性 | Windows 安装包代码签名 — 发布阶段 |

## Electron 安全配置

`BrowserWindow` 强制：

```ts
webPreferences: {
  preload: '...',
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // 主进程允许文件系统访问，故 false；但渲染端通过 contextBridge 限制
}
```

## Tauri 安全配置

`apps/*-tauri/capabilities/default.json` 初始只开放：

```json
["core:default", "dialog:default"]
```

后续新增文件系统、shell、updater 等插件时，必须同步收窄 capability 权限并更新本文档。

`preload` 仅暴露：

```ts
window.api = {
  invoke(channel, ...args),    // 走 ipcRenderer.invoke 白名单
  pickDirectory(),
  channels: IPC,               // 常量字典
}
```

## 路径与协议防护

- **远程路径白名单**：服务器配置时设置 `remoteBasePath`，部署时校验 `path.posix.normalize(remotePath)` 必须以 `remoteBasePath` 开头，防止 `../` 越权
- **SFTP 主机指纹**：首次连接记录 `hostHash`，后续不匹配则告警并暂停（M2）
- **FTP 警示**：选择 FTP 协议时 UI 弹出明文传输提示
- **本地路径**：项目创建时只允许选择目录（`dialog.showOpenDialog properties: ['openDirectory']`）

## 日志脱敏

- 部署日志中只输出文件路径与字节数，**不**输出文件内容
- 凭据 ref（UUID）可记录，但密文 / 明文都不进日志
