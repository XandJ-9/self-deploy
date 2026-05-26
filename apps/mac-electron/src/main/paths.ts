import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 数据目录解析策略（不使用全局 userData 作为主路径）：
 * - 开发态：仓库根目录下的 .local-data/
 * - 打包态：与 .exe 同级的 SelfDeploy-data/
 *   - 若该位置不可写（例如安装在受保护目录），回退到 userData。
 */
let cachedDir: string | null = null;

export function getAppDataDir(): string {
  if (cachedDir) return cachedDir;
  cachedDir = resolveDir();
  return cachedDir;
}

function resolveDir(): string {
  if (!app.isPackaged) {
    // 开发态：项目根 .local-data/
    return ensure(path.resolve(process.cwd(), '.local-data'));
  }

  const exeDir = path.dirname(app.getPath('exe'));
  const candidate = path.resolve(exeDir, 'SelfDeploy-data');

  try {
    fs.mkdirSync(candidate, { recursive: true });
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch {
    // 回退：用户目录（依旧通过 productName 与开发态隔离）
    return ensure(app.getPath('userData'));
  }
}

function ensure(dir: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
