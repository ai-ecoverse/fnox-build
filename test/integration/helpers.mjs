import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..');
export const testdata = join(import.meta.dirname, 'testdata');
export const isWindows = process.platform === 'win32';

export function hostPlatform() {
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'x64' }[process.arch];
  if (!os || !arch) throw new Error(`no fnox build for ${process.platform}-${process.arch}`);
  return `${os}-${arch}`;
}

export const fnoxBin = process.env.FNOX_BIN
  ? resolve(process.env.FNOX_BIN)
  : join(root, 'artifacts', 'build', `fnox-${hostPlatform()}${isWindows ? '.exe' : ''}`);

function baseEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(FNOX_|AWS_|AZURE_|VAULT_|OP_|BW_|GOOGLE_)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fnox-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  const env = {
    ...baseEnv(),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    FNOX_CONFIG_DIR: join(home, '.config', 'fnox'),
    FNOX_STATE_DIR: join(home, '.local', 'state', 'fnox'),
    FNOX_DAEMON: 'off',
    NO_COLOR: '1',
  };
  return { dir, home, project, env };
}

export function fnox(args, { cwd, env, input }) {
  const res = spawnSync(fnoxBin, args, {
    cwd,
    env,
    input: input ?? '',
    encoding: 'utf8',
    timeout: 120000,
  });
  if (res.error) throw res.error;
  return res;
}

export function fnoxAsync(args, { cwd, env, timeoutMs = 120000 }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(fnoxBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      reject(new Error(`fnox ${args.join(' ')} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

export function describeRun(res) {
  return `exit ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
}

export function tomlLiteral(value) {
  if (value.includes("'") || /[\r\n]/.test(value))
    throw new Error(`cannot quote ${value} as a TOML literal`);
  return `'${value}'`;
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= generators[i];
    }
  }
  return chk;
}

function toWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

function bech32(hrp, bytes) {
  const words = toWords(bytes);
  const expanded = [
    ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((c) => c.charCodeAt(0) & 31),
  ];
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => BECH32[w]).join('')}`;
}

export function ageKeypair() {
  const jwk = generateKeyPairSync('x25519').privateKey.export({ format: 'jwk' });
  return {
    identity: bech32('age-secret-key-', Buffer.from(jwk.d, 'base64url')).toUpperCase(),
    recipient: bech32('age', Buffer.from(jwk.x, 'base64url')),
  };
}
