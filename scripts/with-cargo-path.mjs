import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);

let commandCwd = process.cwd();
if (args[0] === '--cwd') {
  const cwdArg = args[1];
  if (!cwdArg) {
    console.error('Usage: node scripts/with-cargo-path.mjs --cwd <path> <command> [...args]');
    process.exit(1);
  }
  commandCwd = path.resolve(cwdArg);
  args.splice(0, 2);
}

if (args.length === 0) {
  console.error('Usage: node scripts/with-cargo-path.mjs <command> [...args]');
  process.exit(1);
}

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const cargoExe = path.join(cargoBin, 'cargo.exe');
const currentPath = process.env[pathKey] ?? '';

if (fs.existsSync(cargoExe)) {
  const entries = currentPath.split(path.delimiter).map((entry) => entry.toLowerCase());
  if (!entries.includes(cargoBin.toLowerCase())) {
    process.env[pathKey] = `${cargoBin}${path.delimiter}${currentPath}`;
  }
}

const child = spawn(args[0], args.slice(1), {
  cwd: commandCwd,
  env: process.env,
  shell: true,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
