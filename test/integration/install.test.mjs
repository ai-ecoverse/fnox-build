import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { describeRun, fnoxBin, isWindows, root, scratch } from './helpers.mjs';

const installer = join(root, 'install.sh');
const skip = isWindows ? 'install.sh is for macOS and Linux' : false;
const goos = process.platform;
const goarch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
const asset = `fnox-${goos}-${goarch}`;
const tag = 'v1.39.0-slicc.3';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function expectedVersion() {
  const res = spawnSync(fnoxBin, ['--version'], { encoding: 'utf8' });
  assert.equal(res.status, 0, describeRun(res));
  const out = res.stdout.trim();
  if (process.env.FNOX_UPSTREAM_VERSION) {
    assert.equal(out, `fnox ${process.env.FNOX_UPSTREAM_VERSION}`);
  }
  return out;
}

async function serve(t, files) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const match = req.url.match(/^\/(?:latest\/download|download\/([^/]+))\/([^/]+)$/);
    const body = match && files[match[2]];
    if (!body) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-length': body.length }).end(body);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  return { base: `http://127.0.0.1:${server.address().port}`, requests };
}

function release(binary, name = asset) {
  const other = Buffer.from('another binary');
  return {
    [name]: binary,
    'fnox-windows-amd64.exe': other,
    SHA256SUMS: Buffer.from(
      `${sha256(other)}  fnox-windows-amd64.exe\n${sha256(binary)}  ${name}\n`
    ),
  };
}

function setup(t, files) {
  const box = scratch(t);
  const dir = join(box.dir, 'install dir');
  const env = { ...box.env, PATH: process.env.PATH, TMPDIR: box.dir };
  delete env.VERSION;
  delete env.INSTALL_DIR;
  return serve(t, files).then((server) => ({ ...box, dir, env, ...server }));
}

function run(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('sh', [installer, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`install.sh timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 120000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

function uname(box, os, machine) {
  const shims = join(box.dir, 'shims');
  mkdirSync(shims, { recursive: true });
  writeFileSync(
    join(shims, 'uname'),
    `#!/bin/sh\ncase "$1" in -s) echo ${os} ;; -m) echo ${machine} ;; *) echo ${os} ;; esac\n`
  );
  chmodSync(join(shims, 'uname'), 0o755);
  return { ...box.env, PATH: `${shims}${delimiter}${process.env.PATH}` };
}

function leftovers(dir) {
  return readdirSync(dir).filter((name) => name !== 'fnox');
}

test('install.sh installs the latest release into INSTALL_DIR and verifies it', {
  skip,
}, async (t) => {
  const binary = readFileSync(fnoxBin);
  const box = await setup(t, release(binary));
  const version = expectedVersion();
  const env = { ...box.env, SLICC_INSTALL_BASE_URL: box.base, INSTALL_DIR: box.dir };

  const res = await run([], env);
  assert.equal(res.status, 0, describeRun(res));
  assert.equal(res.stdout.trim(), version);
  assert.deepEqual(box.requests, ['/latest/download/SHA256SUMS', `/latest/download/${asset}`]);
  const installed = join(box.dir, 'fnox');
  assert.equal(sha256(readFileSync(installed)), sha256(binary));
  assert.equal(statSync(installed).mode & 0o777, 0o755);
  assert.deepEqual(leftovers(box.dir), []);
  assert.ok(
    res.stderr.includes(
      `${box.dir} is not on your PATH; add it with: export PATH="${box.dir}:$PATH"`
    ),
    describeRun(res)
  );

  const again = await run([], env);
  assert.equal(again.status, 0, describeRun(again));
  assert.equal(again.stdout.trim(), version);
  assert.equal(sha256(readFileSync(installed)), sha256(binary));
  assert.deepEqual(readdirSync(box.dir), ['fnox']);
});

test('install.sh replaces an existing fnox, and takes --version and --dir', { skip }, async (t) => {
  const binary = readFileSync(fnoxBin);
  const box = await setup(t, release(binary));
  mkdirSync(box.dir, { recursive: true });
  writeFileSync(join(box.dir, 'fnox'), '#!/bin/sh\necho old\n', { mode: 0o755 });
  const env = { ...box.env, SLICC_INSTALL_BASE_URL: box.base };

  const res = await run(['--version', tag.slice(1), '--dir', box.dir], env);
  assert.equal(res.status, 0, describeRun(res));
  assert.equal(res.stdout.trim(), expectedVersion());
  assert.deepEqual(box.requests, [`/download/${tag}/SHA256SUMS`, `/download/${tag}/${asset}`]);
  assert.equal(sha256(readFileSync(join(box.dir, 'fnox'))), sha256(binary));

  box.requests.length = 0;
  const pinned = await run([], { ...env, VERSION: tag, INSTALL_DIR: box.dir });
  assert.equal(pinned.status, 0, describeRun(pinned));
  assert.deepEqual(box.requests, [`/download/${tag}/SHA256SUMS`, `/download/${tag}/${asset}`]);
  assert.deepEqual(leftovers(box.dir), []);
});

test('install.sh defaults to ~/.local/bin and is quiet about a PATH that has it', {
  skip,
}, async (t) => {
  const box = await setup(t, release(readFileSync(fnoxBin)));
  const bin = join(box.home, '.local', 'bin');
  const env = {
    ...box.env,
    SLICC_INSTALL_BASE_URL: box.base,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
  };

  const res = await run([], env);
  assert.equal(res.status, 0, describeRun(res));
  assert.ok(existsSync(join(bin, 'fnox')));
  assert.doesNotMatch(res.stderr, /not on your PATH/);
});

test('install.sh says when another fnox earlier on PATH shadows it', { skip }, async (t) => {
  const box = await setup(t, release(readFileSync(fnoxBin)));
  const upstream = join(box.dir, '..', 'upstream');
  mkdirSync(upstream, { recursive: true });
  writeFileSync(join(upstream, 'fnox'), '#!/bin/sh\necho upstream\n', { mode: 0o755 });
  const env = {
    ...box.env,
    SLICC_INSTALL_BASE_URL: box.base,
    PATH: [upstream, box.dir, process.env.PATH].join(delimiter),
  };

  const res = await run(['--dir', box.dir], env);
  assert.equal(res.status, 0, describeRun(res));
  assert.ok(
    res.stderr.includes(`note: ${join(upstream, 'fnox')} comes first on your PATH`),
    describeRun(res)
  );
  assert.doesNotMatch(res.stderr, /not on your PATH/);
});

test('install.sh refuses a binary whose checksum does not match', { skip }, async (t) => {
  const binary = readFileSync(fnoxBin);
  const files = release(binary);
  files[asset] = Buffer.concat([binary, Buffer.from('tampered')]);
  const box = await setup(t, files);
  mkdirSync(box.dir, { recursive: true });
  writeFileSync(join(box.dir, 'fnox'), '#!/bin/sh\necho old\n', { mode: 0o755 });

  const res = await run(['--dir', box.dir], { ...box.env, SLICC_INSTALL_BASE_URL: box.base });
  assert.equal(res.status, 1, describeRun(res));
  assert.match(res.stderr, /checksum of .* nothing was installed/);
  assert.equal(readFileSync(join(box.dir, 'fnox'), 'utf8'), '#!/bin/sh\necho old\n');
  assert.deepEqual(leftovers(box.dir), []);
});

test('install.sh refuses a release whose SHA256SUMS has no entry for the platform', {
  skip,
}, async (t) => {
  const files = release(readFileSync(fnoxBin));
  files.SHA256SUMS = Buffer.from(
    `${sha256(files['fnox-windows-amd64.exe'])}  fnox-windows-amd64.exe\n`
  );
  const box = await setup(t, files);

  const res = await run(['--dir', box.dir], { ...box.env, SLICC_INSTALL_BASE_URL: box.base });
  assert.equal(res.status, 1, describeRun(res));
  assert.match(res.stderr, /SHA256SUMS has no entry for fnox-/);
  assert.deepEqual(readdirSync(box.dir), []);
});

test('install.sh maps aarch64 to the linux-arm64 asset', { skip }, async (t) => {
  const fake = Buffer.from('#!/bin/sh\necho "fnox 0.0.0-fake"\n');
  const box = await setup(t, release(fake, 'fnox-linux-arm64'));
  const env = { ...uname(box, 'Linux', 'aarch64'), SLICC_INSTALL_BASE_URL: box.base };

  const res = await run(['--dir', box.dir], env);
  assert.equal(res.status, 0, describeRun(res));
  assert.equal(res.stdout.trim(), 'fnox 0.0.0-fake');
  assert.deepEqual(box.requests, [
    '/latest/download/SHA256SUMS',
    '/latest/download/fnox-linux-arm64',
  ]);
});

test('install.sh points other systems at npm', { skip }, async (t) => {
  const box = await setup(t, {});
  const env = { ...uname(box, 'FreeBSD', 'amd64'), SLICC_INSTALL_BASE_URL: box.base };

  const res = await run(['--dir', box.dir], env);
  assert.equal(res.status, 1, describeRun(res));
  assert.match(res.stderr, /npm install -g @ai-ecoverse\/fnox/);
  assert.deepEqual(box.requests, []);
});

test('install.sh --help prints usage, and an unknown flag fails', { skip }, async (t) => {
  const box = await setup(t, {});
  const help = await run(['--help'], box.env);
  assert.equal(help.status, 0, describeRun(help));
  assert.match(help.stdout, /SLICC's patched build of fnox/);
  assert.match(help.stdout, /--version X/);

  const bad = await run(['--bogus'], box.env);
  assert.equal(bad.status, 2, describeRun(bad));
  assert.deepEqual(box.requests, []);
});
