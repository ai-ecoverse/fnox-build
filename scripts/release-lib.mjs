import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import semver from 'semver';
import { fnoxVersion } from './fnox-version.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FORK = 'ai-ecoverse/fnox';
const TAG = /^v(\d+\.\d+\.\d+)-slicc\.(\d+)$/;

const quiet = { log() {}, error() {}, warn() {}, success() {} };

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function fnoxRef() {
  const ref = readFileSync(join(root, 'FNOX_REF'), 'utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(ref))
    throw new Error(`FNOX_REF must hold one full commit sha, not ${ref}`);
  return ref;
}

export async function upstreamVersion(ref) {
  const local = join(root, 'work', 'fnox');
  if (existsSync(join(local, 'Cargo.toml'))) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: local,
      encoding: 'utf8',
    }).trim();
    if (head === ref) return fnoxVersion(readFileSync(join(local, 'Cargo.toml'), 'utf8'));
  }
  const url = `https://raw.githubusercontent.com/${FORK}/${ref}/Cargo.toml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return fnoxVersion(await res.text());
}

export function releases() {
  return git('tag', '--list', 'v*-slicc.*', '--merged', 'HEAD')
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => TAG.test(tag))
    .map((tag) => {
      const [, upstream, build] = tag.match(TAG);
      return { tag, version: tag.slice(1), upstream, build: Number(build) };
    })
    .sort((a, b) => semver.rcompare(a.version, b.version));
}

export function commitsSince(tag) {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const raw = git('log', '--format=%H%x1f%B%x1e', ...range);
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, message] = entry.split('\x1f');
      return { hash, message: message.trim() };
    });
}

export async function plan() {
  const ref = fnoxRef();
  const upstream = await upstreamVersion(ref);
  const all = releases();
  const last = all[0];
  const commits = commitsSince(last?.tag);
  const type = await analyzeCommits({}, { commits, logger: quiet, cwd: root });
  const build = 1 + Math.max(0, ...all.filter((r) => r.upstream === upstream).map((r) => r.build));
  const version = `${upstream}-slicc.${build}`;
  if (type && last && !semver.gt(version, last.version)) {
    throw new Error(
      `fnox ${upstream} at ${ref} would release ${version}, which is not newer than ${last.version}`
    );
  }
  return { ref, upstream, last, commits, type, version: type ? version : '' };
}
