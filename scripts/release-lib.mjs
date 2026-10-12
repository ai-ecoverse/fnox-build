import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import semver from 'semver';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'ai-ecoverse/fnox-build';
export const UPSTREAM = 'jdx/fnox';
export const HOMESCOOP = 'ai-ecoverse/homescoop';
const TAG = /^v(\d+\.\d+\.\d+)-slicc\.(\d+)$/;
const SOURCE_LINE = /^Source tree: `([0-9a-f]{40})`/m;
const PIN_FILES = new Set(['HOMESCOOP_REF']);

const quiet = { log() {}, error() {}, warn() {}, success() {} };

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function source() {
  const [tag, tagSha] = readFileSync(join(root, 'FNOX_TAG'), 'utf8').trim().split(/\s+/);
  const homescoop = readFileSync(join(root, 'HOMESCOOP_REF'), 'utf8').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[0-9a-f]{40}$/.test(tagSha ?? '')) {
    throw new Error('FNOX_TAG must hold "<tag> <commit sha>"');
  }
  if (!/^[0-9a-f]{40}$/.test(homescoop))
    throw new Error('HOMESCOOP_REF must hold one full commit sha');
  return { tag, tagSha, upstream: tag.slice(1), homescoop };
}

export function sourceTree() {
  if (!existsSync(join(root, 'work', 'fnox', '.fnox-build-source'))) return '';
  return execFileSync('bash', [join(root, 'scripts', 'source-tree.sh')], {
    encoding: 'utf8',
  }).trim();
}

export function sourceLine(tree) {
  return `Source tree: \`${tree}\``;
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
      const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-m', hash)
        .split('\n')
        .filter(Boolean);
      return { hash, message: message.trim(), files };
    });
}

async function releasedTree(tag) {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return '';
  return (await res.json()).body?.match(SOURCE_LINE)?.[1] ?? '';
}

function onlyPins(commit) {
  return commit.files.length > 0 && commit.files.every((file) => PIN_FILES.has(file));
}

export async function plan() {
  const pinned = source();
  const all = releases();
  const last = all[0];
  const commits = commitsSince(last?.tag);
  const tree = sourceTree();
  const lastTree = last ? await releasedTree(last.tag) : '';
  const sameSource = Boolean(tree) && tree === lastTree;
  const counted = sameSource ? commits.filter((commit) => !onlyPins(commit)) : commits;
  const type = await analyzeCommits({}, { commits: counted, logger: quiet, cwd: root });
  const build =
    1 + Math.max(0, ...all.filter((r) => r.upstream === pinned.upstream).map((r) => r.build));
  const version = `${pinned.upstream}-slicc.${build}`;
  if (type && last && !semver.gt(version, last.version)) {
    throw new Error(
      `fnox ${pinned.upstream} would release ${version}, which is not newer than ${last.version}`
    );
  }
  return {
    ...pinned,
    last,
    commits,
    skipped: commits.length - counted.length,
    tree,
    sameSource,
    type,
    version: type ? version : '',
  };
}
