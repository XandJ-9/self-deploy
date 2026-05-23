/**
 * 共享类型 — 主进程与渲染进程都会使用。
 * 渲染端不能 import 任何 Node 模块，这里只放纯类型。
 */

export type Protocol = 'sftp' | 'ftp';
export type AuthType = 'password' | 'privateKey';

export interface ServerRecord {
  id: number;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** 钥匙串里的引用键，本身不含明文 */
  credentialRef: string;
  remoteBasePath: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  localPath: string;
  defaultServerId: number | null;
  remotePath: string;
  excludePatterns: string[];
  preDeployCmd: string | null;
  postDeployCmd: string | null;
  createdAt: string;
}

export type DeployStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolledback';

export interface DeploymentRecord {
  id: number;
  projectId: number;
  serverId: number;
  fromCommit: string | null;
  toCommit: string;
  fileCount: number;
  status: DeployStatus;
  logPath: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type FileAction = 'ADD' | 'MODIFY' | 'DELETE' | 'RENAME';

export type FileDeployStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface ChangedFile {
  path: string;
  action: FileAction;
  oldPath?: string;
}

export interface DeploymentFileRecord {
  path: string;
  action: FileAction;
  status: FileDeployStatus;
  size: number | null;
}

export interface DeploymentDetail {
  record: DeploymentRecord;
  files: DeploymentFileRecord[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}
