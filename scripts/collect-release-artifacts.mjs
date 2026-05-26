import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const args = parseArgs(process.argv.slice(2));

const projectName = args.project ?? pkg.productName ?? pkg.name;
const version = args.version ?? pkg.version;
const framework = args.framework ?? 'tauri';
const platform = args.platform ?? currentPlatform();
const arch = normalizeArch(args.arch ?? os.arch());
const sourceRoot = path.join(repoRoot, 'apps', appDir(platform), 'target', 'release', 'bundle');
const outputRoot = path.join(repoRoot, 'release', 'final');

const artifacts = collectArtifacts(sourceRoot);
if (artifacts.length === 0) {
  console.error(`No release artifacts found in ${sourceRoot}`);
  process.exit(1);
}

fs.mkdirSync(outputRoot, { recursive: true });

const nextEntries = artifacts.map((artifact) => {
  const ext = artifact.ext;
  const fileName = [
    sanitize(projectName),
    version,
    framework,
    platform,
    arch,
    artifact.kind,
  ].join('-') + ext;
  const target = path.join(outputRoot, fileName);
  fs.copyFileSync(artifact.path, target);
  return {
    projectName,
    version,
    framework,
    platform,
    arch,
    kind: artifact.kind,
    fileName,
    path: path.relative(repoRoot, target),
    sizeBytes: fs.statSync(target).size,
    sha256: sha256(target),
  };
});

const generatedAt = new Date().toISOString();
const entriesByFile = new Map(
  readExistingEntries(outputRoot)
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry.path)))
    .map((entry) => [entry.fileName, entry]),
);
for (const entry of nextEntries) {
  entriesByFile.set(entry.fileName, entry);
}
const entries = [...entriesByFile.values()].sort((left, right) =>
  left.fileName.localeCompare(right.fileName),
);
const manifest = {
  generatedAt,
  artifacts: entries,
};

fs.writeFileSync(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputRoot, 'manifest.md'), renderMarkdown(manifest));

console.log(`Collected ${entries.length} artifact(s) into ${path.relative(repoRoot, outputRoot)}`);
for (const entry of entries) {
  console.log(`- ${entry.fileName}`);
}

function readExistingEntries(root) {
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  } catch {
    return [];
  }
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function currentPlatform() {
  if (process.platform === 'darwin') {
    return 'macos';
  }
  if (process.platform === 'win32') {
    return 'windows';
  }
  return process.platform;
}

function appDir(platformName) {
  if (platformName === 'macos') {
    return 'mac-tauri';
  }
  if (platformName === 'windows') {
    return 'win-tauri';
  }
  return `${platformName}-tauri`;
}

function collectArtifacts(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = walk(root).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ['.dmg', '.msi', '.exe', '.appimage', '.deb', '.rpm'].includes(ext);
  });
  return files.map((file) => ({
    path: file,
    ext: path.extname(file),
    kind: artifactKind(file),
  }));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function artifactKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.dmg') {
    return 'installer';
  }
  if (ext === '.msi' || ext === '.exe') {
    return 'installer';
  }
  if (ext === '.appimage' || ext === '.deb' || ext === '.rpm') {
    return 'package';
  }
  return 'artifact';
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'x86_64') {
    return 'x64';
  }
  if (arch === 'arm64' || arch === 'aarch64') {
    return 'arm64';
  }
  return arch;
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '');
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function renderMarkdown(manifest) {
  const lines = [
    '# Release Manifest',
    '',
    `Generated at: ${manifest.generatedAt}`,
    '',
    '| Project | Version | Framework | Platform | Arch | Kind | File | Size | SHA-256 |',
    '|---|---|---|---|---|---|---|---:|---|',
  ];
  for (const entry of manifest.artifacts) {
    lines.push(
      `| ${entry.projectName} | ${entry.version} | ${entry.framework} | ${entry.platform} | ${entry.arch} | ${entry.kind} | ${entry.fileName} | ${entry.sizeBytes} | \`${entry.sha256}\` |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
