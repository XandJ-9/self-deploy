import { ipcMain } from 'electron';
import simpleGit, { type SimpleGit } from 'simple-git';
import { IPC } from '../../shared/ipc-channels';
import type { ChangedFile, FileAction, GitCommit } from '../../shared/types';

function git(repoPath: string): SimpleGit {
  return simpleGit({ baseDir: repoPath });
}

function mapStatus(s: string): FileAction {
  if (s.startsWith('A')) return 'ADD';
  if (s.startsWith('D')) return 'DELETE';
  if (s.startsWith('R')) return 'RENAME';
  return 'MODIFY';
}

export function registerGitHandlers(): void {
  ipcMain.handle(
    IPC.Git.ListCommits,
    async (_e, repoPath: string, limit = 50): Promise<GitCommit[]> => {
      const log = await git(repoPath).log({ maxCount: limit });
      return log.all.map((c) => ({
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date,
      }));
    },
  );

  ipcMain.handle(
    IPC.Git.Diff,
    async (_e, repoPath: string, from: string | null, to: string): Promise<ChangedFile[]> => {
      const range = from ? `${from}..${to}` : to;
      const args = from
        ? ['diff', '--name-status', range]
        : ['ls-tree', '-r', '--name-only', to];
      const raw = await git(repoPath).raw(args);
      if (!from) {
        return raw
          .split('\n')
          .filter(Boolean)
          .map((p): ChangedFile => ({ path: p, action: 'ADD' }));
      }
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line): ChangedFile => {
          const parts = line.split('\t');
          const status = parts[0];
          if (status.startsWith('R') && parts.length >= 3) {
            return { path: parts[2], oldPath: parts[1], action: 'RENAME' };
          }
          return { path: parts[1] ?? '', action: mapStatus(status) };
        });
    },
  );

  ipcMain.handle(IPC.Git.Status, async (_e, repoPath: string) => {
    const s = await git(repoPath).status();
    return {
      current: s.current,
      isClean: s.isClean(),
      ahead: s.ahead,
      behind: s.behind,
      modified: s.modified,
      not_added: s.not_added,
    };
  });
}
