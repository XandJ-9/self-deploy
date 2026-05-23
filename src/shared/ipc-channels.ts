/**
 * IPC 通道命名常量 — 主/渲染共用，避免硬编码字符串散落。
 */
export const IPC = {
  Server: {
    List: 'server:list',
    Create: 'server:create',
    Update: 'server:update',
    Delete: 'server:delete',
    TestConnection: 'server:test',
  },
  Project: {
    List: 'project:list',
    Create: 'project:create',
    Update: 'project:update',
    Delete: 'project:delete',
    PickDirectory: 'project:pickDirectory',
  },
  Git: {
    ListCommits: 'git:listCommits',
    Diff: 'git:diff',
    Status: 'git:status',
  },
  Deploy: {
    Preview: 'deploy:preview',
    ScanFolder: 'deploy:scanFolder',
    Run: 'deploy:run',
    History: 'deploy:history',
    Detail: 'deploy:detail',
    Rollback: 'deploy:rollback',
    Log: 'deploy:log',
    OnLog: 'deploy:onLog',
  },
} as const;
