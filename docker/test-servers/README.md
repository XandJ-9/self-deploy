# 本地测试服务器

为 M2「服务器管理 / 连接测试」提供一套即开即用的本地 SFTP + FTP。

## 启动

```bash
docker compose -f docker/test-servers/docker-compose.yml up -d
docker ps   # 应看到 selfdeploy-sftp / selfdeploy-ftp
```

停止：`docker compose -f docker/test-servers/docker-compose.yml down`  
完全重置（删卷）：追加 `-v`。

## 默认账号

| 协议 | Host | Port | 用户 | 密码 | 远端基路径 |
|---|---|---|---|---|---|
| SFTP | 127.0.0.1 | 2222 | demo | demo123 | `/upload` |
| FTP  | 127.0.0.1 | 2121 | demo | demo123 | `/` |

在应用「新增服务器」表单中填入以上字段，点「测试」即可。

## 私钥登录（可选）

1. 生成密钥对：
   ```bash
   mkdir -p docker/test-servers/keys
   ssh-keygen -t rsa -b 4096 -N '' -f docker/test-servers/keys/id_rsa
   ```
2. 取消 `docker-compose.yml` 中 `keys/id_rsa.pub` 行的注释，重启容器。
3. 在 SelfDeploy 表单选「私钥」认证，把 `id_rsa`（私钥）内容粘贴进 secret 字段。

## 排错

- **SFTP `All configured authentication methods failed`**：账号/密码错；或选了私钥但容器没挂载公钥。
- **FTP `ECONNREFUSED`**：21000-21010 被占用，改 `MIN_PORT/MAX_PORT` 区段并同步映射。
- **FTP 列表为空但连接成功**：默认目录是 `/ftp/demo`，把 `remoteBasePath` 填 `/` 即可。
- **macOS Docker Desktop 无法访问端口**：检查 `localhost` 是否真指向 `127.0.0.1`，或把 `Host` 字段填成 `127.0.0.1`。
