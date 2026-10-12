#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { HOMESCOOP, plan, REPO, root, sourceLine, UPSTREAM } from './release-lib.mjs';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const dryRun = values['dry-run'];
const version = readFileSync(join(root, 'dist', 'VERSION'), 'utf8').trim();

function fail(message) {
  process.stderr.write(`release: ${message}\n`);
  process.exit(1);
}

const result = await plan();
if (!result.tree) fail('the fnox source is not in work/fnox; run scripts/fetch.sh first');
if (!dryRun && result.version !== version) {
  fail(
    `the packaged version is ${version}, but the commits on HEAD release ${result.version || 'nothing'}`
  );
}

const tag = `v${version}`;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const changes = await generateNotes(
  {},
  {
    commits: result.commits,
    lastRelease: result.last ? { gitTag: result.last.tag, version: result.last.version } : {},
    nextRelease: { gitTag: tag, version },
    options: { repositoryUrl: `https://github.com/${REPO}` },
    cwd: root,
  }
);
const notes = `fnox ${result.upstream}: [${UPSTREAM} ${result.tag}](https://github.com/${UPSTREAM}/tree/${result.tagSha}) with the patch series of [${HOMESCOOP}@${result.homescoop.slice(0, 12)}](https://github.com/${HOMESCOOP}/tree/${result.homescoop}/packages/wasi-fnox). Verify a download with \`SHA256SUMS\` and \`gh attestation verify <file> --repo ${REPO}\`.

${sourceLine(result.tree)}

${changes}`;
const notesFile = join(root, 'dist', 'release-notes.md');
writeFileSync(notesFile, notes);
process.stdout.write(notes);

const assets = readdirSync(join(root, 'artifacts', 'release'))
  .filter((name) => name.startsWith('fnox-') || name === 'SHA256SUMS')
  .map((name) => join(root, 'artifacts', 'release', name));
if (assets.length !== 7) fail(`expected 6 binaries and SHA256SUMS, found ${assets.length} assets`);
if (dryRun) {
  process.stdout.write(`\nwould create ${tag} at ${head} with ${assets.length} assets\n`);
  process.exit(0);
}

const gh = spawnSync(
  'gh',
  [
    'release',
    'create',
    tag,
    '--target',
    head,
    '--title',
    tag,
    '--notes-file',
    notesFile,
    '--latest',
    ...assets,
  ],
  { cwd: root, stdio: 'inherit' }
);
if (gh.status !== 0) fail(`gh release create ${tag} failed`);

const npm = spawnSync(process.execPath, [join(root, 'scripts', 'npm-publish.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (npm.status !== 0) fail('npm publish failed');
