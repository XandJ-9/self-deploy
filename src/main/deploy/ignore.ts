/**
 * .deployignore 与 project.excludePatterns 的合并过滤器。
 *
 * 规则来源（先后顺序，后者可覆盖前者）：
 *   1. project.excludePatterns（DB 中的字符串数组）
 *   2. 项目根目录的 `.deployignore` 文件（gitignore 语法，支持 !取反）
 *
 * 路径以 POSIX 风格匹配（输入若含反斜杠会被规整）。
 */
import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface IgnoreFilter {
  /** 返回 true 表示该 relPath 应被忽略（不部署） */
  ignores(relPath: string): boolean;
  /** 调试用：返回参与匹配的规则数（仅近似） */
  ruleCount: number;
}

export function loadIgnoreFilter(projectLocalPath: string, excludePatterns: string[]): IgnoreFilter {
  const ig: Ignore = ignore();
  let count = 0;

  if (excludePatterns.length > 0) {
    ig.add(excludePatterns);
    count += excludePatterns.length;
  }

  const fileAbs = path.join(projectLocalPath, '.deployignore');
  if (fs.existsSync(fileAbs)) {
    const text = fs.readFileSync(fileAbs, 'utf8');
    ig.add(text);
    count += text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  }

  return {
    ignores(relPath: string): boolean {
      const norm = relPath.replace(/\\/g, '/');
      if (!norm) return false;
      return ig.ignores(norm);
    },
    ruleCount: count,
  };
}
