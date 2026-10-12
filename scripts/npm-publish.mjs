#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: join(root, 'dist', 'npm') },
    tag: { type: 'string', default: 'latest' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const dryRun = values['dry-run'];
const gate = 'FNOX_NPM_PUBLISH';

function fail(message) {
  process.stderr.write(`npm-publish: ${message}\n`);
  process.exit(1);
}

function npm(args, options = {}) {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  });
}

function minimumNpm() {
  const [major, minor, patch] = npm(['--version']).stdout.trim().split('.').map(Number);
  const ok = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
  if (!ok) fail('npm trusted publishing needs npm 11.5.1 or newer');
}

function published(name, version) {
  const res = npm(['view', `${name}@${version}`, 'version']);
  return res.status === 0 && res.stdout.trim() === version;
}

function registry() {
  const configured =
    process.env.npm_config_registry || npm(['config', 'get', 'registry']).stdout.trim();
  return (configured || 'https://registry.npmjs.org/').replace(/\/+$/, '');
}

async function onRegistry(base, name, version, timeoutMs) {
  try {
    const res = await fetch(`${base}/${name.replace('/', '%2f')}/${version}`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    return (await res.json()).version === version;
  } catch {
    return false;
  }
}

async function requireDependencies(pkg) {
  const deps = Object.entries(pkg.optionalDependencies || {});
  if (!deps.length) return;
  const base = registry();
  const waitMs = Number(process.env.FNOX_REGISTRY_WAIT_SECONDS ?? 900) * 1000;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const missing = [];
    for (const [name, version] of deps) {
      const timeoutMs = Math.min(30000, Math.max(5000, deadline - Date.now()));
      if (!(await onRegistry(base, name, version, timeoutMs))) missing.push(`${name}@${version}`);
    }
    if (!missing.length) break;
    if (Date.now() >= deadline) {
      fail(
        `refusing to publish ${pkg.name}@${pkg.version}; not on the registry: ${missing.join(', ')}`
      );
    }
    process.stdout.write(`waiting for ${missing.join(', ')} to appear on the registry\n`);
    await new Promise((r) => setTimeout(r, Math.min(30000, Math.max(1000, deadline - Date.now()))));
  }
  process.stdout.write(
    `every optional dependency of ${pkg.name}@${pkg.version} is on the registry\n`
  );
}

const packages = readdirSync(values.dir)
  .map((entry) => join(values.dir, entry))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .sort(
    (a, b) =>
      Number(Boolean(a.pkg.optionalDependencies)) - Number(Boolean(b.pkg.optionalDependencies))
  );

if (!dryRun && process.env[gate] !== 'true') {
  process.stdout.write(
    `::notice::skipping npm publish of ${packages.length} packages; set the repository variable ${gate} to true to publish them\n`
  );
  process.exit(0);
}

if (!dryRun) minimumNpm();
for (const { dir, pkg } of packages) {
  if (!dryRun && published(pkg.name, pkg.version)) {
    process.stdout.write(`${pkg.name}@${pkg.version} is already published\n`);
    continue;
  }
  if (!dryRun) await requireDependencies(pkg);
  const tag = dryRun ? 'dry-run' : values.tag;
  const args = ['publish', dir, '--access', 'public', '--tag', tag];
  args.push(dryRun ? '--dry-run' : '--provenance');
  const res = npm(args, { stdio: 'inherit' });
  if (res.status !== 0) fail(`npm publish ${pkg.name}@${pkg.version} failed`);
}
