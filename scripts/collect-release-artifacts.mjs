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
const outputRoot = path.join(repoRoot, 'release', 'final');
const existingEntries = migrateLegacyEntries(readExistingEntries(outputRoot), outputRoot);
const sourceRoot = resolveSourceRoot({
  repoRoot,
  framework,
  platform,
  sourceRoot: args['source-root'] ?? args.sourceRoot,
});
const versionRoot = path.join(outputRoot, sanitize(version));
const artifactOutputRoot = path.join(versionRoot, framework, platform, arch);

const artifacts = collectArtifacts(sourceRoot, {
  excludedRoots: [outputRoot],
});
if (artifacts.length === 0) {
  console.error(`No release artifacts found in ${sourceRoot}`);
  process.exit(1);
}

fs.mkdirSync(artifactOutputRoot, { recursive: true });

const generatedAt = new Date().toISOString();

const nextEntries = artifacts.map((artifact) => {
  const fileName = buildArtifactFileName({
    projectName,
    version,
    framework,
    platform,
    arch,
    kind: artifact.kind,
    ext: artifact.ext,
  });
  const target = buildArtifactTargetPath({
    outputRoot,
    version,
    framework,
    platform,
    arch,
    fileName,
  });
  fs.copyFileSync(artifact.path, target);
  return {
    collectedAt: generatedAt,
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

const entriesByPath = new Map(
  existingEntries
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry.path)))
    .map((entry) => [entry.path, entry]),
);
for (const entry of nextEntries) {
  entriesByPath.set(entry.path, entry);
}
const entries = [...entriesByPath.values()].sort(compareEntries);
const manifest = {
  generatedAt,
  layout: 'release/final/<version>/<framework>/<platform>/<arch>/<file>',
  versions: summarizeVersions(entries),
  artifacts: entries,
};

fs.writeFileSync(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputRoot, 'manifest.md'), renderRootMarkdown(manifest));

for (const [versionName, versionEntries] of groupBy(entries, (entry) => entry.version)) {
  const versionManifest = {
    generatedAt,
    version: versionName,
    artifacts: versionEntries.sort(compareEntries),
  };
  const currentVersionRoot = path.join(outputRoot, sanitize(versionName));
  fs.mkdirSync(currentVersionRoot, { recursive: true });
  fs.writeFileSync(
    path.join(currentVersionRoot, 'manifest.json'),
    `${JSON.stringify(versionManifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(currentVersionRoot, 'manifest.md'),
    renderVersionMarkdown(versionManifest),
  );
}

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

function migrateLegacyEntries(entries, root) {
  return entries.map((entry) => {
    if (!entry?.path) {
      return entry;
    }
    const absolutePath = path.join(repoRoot, entry.path);
    if (!fs.existsSync(absolutePath) || isStructuredReleasePath(entry.path)) {
      return entry;
    }
    const migratedTarget = buildArtifactTargetPath({
      outputRoot: root,
      version: entry.version,
      framework: entry.framework,
      platform: entry.platform,
      arch: entry.arch,
      fileName: entry.fileName,
    });
    fs.mkdirSync(path.dirname(migratedTarget), { recursive: true });
    if (path.resolve(absolutePath) !== path.resolve(migratedTarget)) {
      fs.copyFileSync(absolutePath, migratedTarget);
      fs.rmSync(absolutePath, { force: true });
    }
    return {
      ...entry,
      path: path.relative(repoRoot, migratedTarget),
      sizeBytes: fs.statSync(migratedTarget).size,
      sha256: sha256(migratedTarget),
    };
  });
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

function resolveSourceRoot({ repoRoot: root, framework: runtime, platform: targetPlatform, sourceRoot: explicitSourceRoot }) {
  if (explicitSourceRoot) {
    return path.isAbsolute(explicitSourceRoot)
      ? explicitSourceRoot
      : path.resolve(root, explicitSourceRoot);
  }
  if (runtime === 'electron') {
    return path.join(root, 'release');
  }
  return path.join(root, 'apps', appDir(targetPlatform), 'target', 'release', 'bundle');
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

function collectArtifacts(root, options = {}) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const excludedRoots = (options.excludedRoots ?? []).map((entry) => path.resolve(entry));
  const files = walk(root, excludedRoots).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ['.dmg', '.msi', '.exe', '.pkg', '.zip', '.appimage', '.deb', '.rpm'].includes(ext);
  });
  return files.map((file) => ({
    path: file,
    ext: path.extname(file),
    kind: artifactKind(file),
  }));
}

function walk(dir, excludedRoots = []) {
  const resolvedDir = path.resolve(dir);
  if (excludedRoots.some((excludedRoot) => isSameOrChildPath(resolvedDir, excludedRoot))) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath, excludedRoots);
    }
    return [fullPath];
  });
}

function artifactKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.dmg' || ext === '.msi' || ext === '.exe' || ext === '.pkg') {
    return 'installer';
  }
  if (ext === '.zip' || ext === '.appimage' || ext === '.deb' || ext === '.rpm') {
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

function buildArtifactFileName({ projectName, version, framework, platform, arch, kind, ext }) {
  return [
    sanitize(projectName),
    version,
    framework,
    platform,
    arch,
    kind,
  ].join('-') + ext;
}

function buildArtifactTargetPath({ outputRoot, version, framework, platform, arch, fileName }) {
  return path.join(outputRoot, sanitize(version), framework, platform, arch, fileName);
}

function isStructuredReleasePath(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/');
  return segments.length >= 6 && segments[0] === 'release' && segments[1] === 'final';
}

function compareEntries(left, right) {
  return (
    right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' }) ||
    left.framework.localeCompare(right.framework) ||
    left.platform.localeCompare(right.platform) ||
    left.arch.localeCompare(right.arch) ||
    left.fileName.localeCompare(right.fileName)
  );
}

function summarizeVersions(entries) {
  return [...groupBy(entries, (entry) => entry.version).entries()]
    .map(([versionName, versionEntries]) => ({
      version: versionName,
      artifactCount: versionEntries.length,
      frameworks: [...new Set(versionEntries.map((entry) => entry.framework))].sort(),
      platforms: [...new Set(versionEntries.map((entry) => entry.platform))].sort(),
      generatedAt: versionEntries
        .map((entry) => entry.collectedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    }))
    .sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

function groupBy(entries, getKey) {
  const groups = new Map();
  for (const entry of entries) {
    const key = getKey(entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  return groups;
}

function isSameOrChildPath(candidate, parent) {
  const relativePath = path.relative(parent, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function renderRootMarkdown(manifest) {
  const lines = [
    '# Release Manifest',
    '',
    `Generated at: ${manifest.generatedAt}`,
    '',
    `Layout: \`${manifest.layout}\``,
    '',
    '## Versions',
    '',
    '| Version | Artifacts | Frameworks | Platforms | Latest Collection |',
    '|---|---:|---|---|---|',
  ];
  for (const versionEntry of manifest.versions) {
    lines.push(
      `| ${versionEntry.version} | ${versionEntry.artifactCount} | ${versionEntry.frameworks.join(', ')} | ${versionEntry.platforms.join(', ')} | ${versionEntry.generatedAt ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push('| Project | Version | Framework | Platform | Arch | Kind | File | Relative Path | Size | SHA-256 |');
  lines.push('|---|---|---|---|---|---|---|---|---:|---|');
  for (const entry of manifest.artifacts) {
    lines.push(
      `| ${entry.projectName} | ${entry.version} | ${entry.framework} | ${entry.platform} | ${entry.arch} | ${entry.kind} | ${entry.fileName} | \`${entry.path}\` | ${entry.sizeBytes} | \`${entry.sha256}\` |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderVersionMarkdown(manifest) {
  const lines = [
    `# Release Manifest - ${manifest.version}`,
    '',
    `Generated at: ${manifest.generatedAt}`,
    '',
    '| Framework | Platform | Arch | Kind | File | Relative Path | Size | SHA-256 |',
    '|---|---|---|---|---|---|---:|---|',
  ];
  for (const entry of manifest.artifacts) {
    lines.push(
      `| ${entry.framework} | ${entry.platform} | ${entry.arch} | ${entry.kind} | ${entry.fileName} | \`${entry.path}\` | ${entry.sizeBytes} | \`${entry.sha256}\` |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
