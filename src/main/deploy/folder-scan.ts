/**
 * 本地文件夹扫描器 —— 递归列出目录下所有文件，应用忽略过滤，
 * 输出 ChangedFile[]（action 恒为 ADD）。
 *
 * - 强制忽略 .git（避免误传仓库元数据）
 * - 目录命中 ignore 时整棵子树跳过，提速大目录扫描
 * - 输出 relPath 始终用 POSIX 分隔符（与上传逻辑保持一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ChangedFile } from '../../shared/types';
import type { IgnoreFilter } from './ignore';

export interface ScanResult {
  files: ChangedFile[];
  /** 实际扫描的绝对根路径，便于上传阶段拼接 srcPath */
  rootAbs: string;
}

/**
 * @param projectLocalPath 项目根（用于解析相对 sourceDir）
 * @param sourceDirRel     相对项目根的子目录；'' / '.' 视为项目根
 * @param filter           忽略规则
 */
export function scanFolder(
  projectLocalPath: string,
  sourceDirRel: string,
  filter: IgnoreFilter,
): ScanResult {
  const cleanRel = (sourceDirRel || '').replace(/^[./\\]+|[./\\]+$/g, '');
  const rootAbs = cleanRel ? path.join(projectLocalPath, cleanRel) : projectLocalPath;

  if (!fs.existsSync(rootAbs)) {
    throw new Error(`目录不存在：${rootAbs}`);
  }
  const stat = fs.statSync(rootAbs);
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录：${rootAbs}`);
  }

  const files: ChangedFile[] = [];
  walk(rootAbs, '', files, filter);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, rootAbs };
}

function walk(dirAbs: string, relPrefix: string, out: ChangedFile[], filter: IgnoreFilter): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    const abs = path.join(dirAbs, e.name);

    if (e.isSymbolicLink()) {
      // 默认不跟随符号链接，避免环
      continue;
    }
    if (e.isDirectory()) {
      // 目录命中规则（gitignore 风格目录匹配，尾斜杠）则整棵跳过
      if (filter.ignores(rel + '/')) continue;
      walk(abs, rel, out, filter);
    } else if (e.isFile()) {
      if (filter.ignores(rel)) continue;
      out.push({ path: rel, action: 'ADD' });
    }
  }
}
