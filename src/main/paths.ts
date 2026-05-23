import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 数据目录解析策略（不使用全局 userData 作为主路径）：
 * - 开发态：仓库根目录下的 .local-data/
 * - 打包态：与 .app / .exe 同级的 SelfDeploy-data/
 *   - macOS: <.app 的父目录>/SelfDeploy-data/
 *   - Windows/Linux: <可执行文件目录>/SelfDeploy-data/
 *   - 若该位置不可写（例如从 .dmg 直接打开、安装在受保护目录），回退到 userData。
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
  const candidate =
    process.platform === 'darwin'
      ? // exe 位于 SelfDeploy.app/Contents/MacOS/，往上三级即 .app 所在目录
        path.resolve(exeDir, '..', '..', '..', 'SelfDeploy-data')
      : path.resolve(exeDir, 'SelfDeploy-data');

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
