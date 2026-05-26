/**
 * 传输层抽象 — SFTP / FTP 适配器统一实现该接口，
 * DeployService 只依赖此接口，不感知协议差异。
 *
 * 路径约定：所有 remote 参数均为远端绝对路径。
 */
export interface Transport {
  connect(): Promise<void>;
  close(): Promise<void>;
  /** 递归建目录；已存在不报错。 */
  mkdirp(remoteDir: string): Promise<void>;
  /** 上传本地文件到远端；远端目录必须已存在。 */
  put(localPath: string, remotePath: string): Promise<void>;
  /** 删除单个文件；不存在不报错。 */
  remove(remotePath: string): Promise<void>;
  /** 重命名（移动）；目标已存在时部分协议会失败，由 DeployService 先 remove。 */
  rename(from: string, to: string): Promise<void>;
  /** 文件/目录是否存在。 */
  exists(remotePath: string): Promise<boolean>;
  /** 递归删除目录；不存在不报错。 */
  removeDir(remoteDir: string): Promise<void>;
}
