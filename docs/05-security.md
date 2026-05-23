# 05 · 安全设计

## 凭据保险柜

### 设计

- 数据库 `servers` 表只存 `credential_ref`（UUID），**不存** 任何密码/私钥明文
- 实际密文存放于 `credential_vault` 表（`ref TEXT PRIMARY KEY, cipher BLOB`）
- 加解密通过 Electron `safeStorage` 调用操作系统能力：
  - **macOS** → Keychain
  - **Windows** → DPAPI
  - **Linux** → libsecret / kwallet
- 启动时校验 `safeStorage.isEncryptionAvailable()`，否则拒绝写入

### API

```ts
saveCredential(secret: string): string  // 返回 ref
readCredential(ref: string): string     // 仅主进程可用
updateCredential(ref, secret): void
deleteCredential(ref): void
```

> 渲染端**不可**直接调用 `readCredential`。所有需要明文的场景都在主进程内部使用完后即丢弃。

## OWASP Top 10 对齐

| 项 | 措施 |
|---|---|
| A01 失效的访问控制 | 桌面单用户；preload 仅暴露白名单 API |
| A02 加密失败 | 凭据走 OS 钥匙串；SFTP 优先于 FTP |
| A03 注入 | IPC 入参全部 Zod 校验；SQL 使用 better-sqlite3 参数化 |
| A05 安全配置错误 | `contextIsolation: true` / `nodeIntegration: false` / `sandbox` 渲染端 |
| A07 身份认证失败 | 私钥优于密码；记录已知主机指纹（M2 实施） |
| A08 软件与数据完整性 | electron-builder 出包签名（macOS 公证、Win 代码签名）— 发布阶段 |

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
