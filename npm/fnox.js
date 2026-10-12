#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const tty = require('node:tty');

const targets = {
  'darwin arm64': 'darwin-arm64',
  'darwin x64': 'darwin-x64',
  'linux arm64': 'linux-arm64',
  'linux x64': 'linux-x64',
  'win32 arm64': 'windows-arm64',
  'win32 x64': 'windows-x64',
};

function fail(message) {
  process.stderr.write(`fnox: ${message}\n`);
  process.exit(1);
}

function binaryPath() {
  const target = targets[`${process.platform} ${process.arch}`];
  if (!target) fail(`no fnox binary is published for ${process.platform}-${process.arch}`);
  const pkg = `@ai-ecoverse/fnox-${target}`;
  const file = process.platform === 'win32' ? 'fnox.exe' : 'fnox';
  let bin;
  try {
    bin = require.resolve(`${pkg}/bin/${file}`);
  } catch {
    fail(`${pkg} is not installed; reinstall without --omit=optional or --no-optional`);
  }
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(bin, 0o755);
      } catch {}
    }
  }
  return bin;
}

const forwarded = process.platform === 'win32' ? [] : ['SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR2'];
const swallowed = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : [];
if (process.platform !== 'win32') {
  (tty.isatty(0) ? swallowed : forwarded).push('SIGINT');
}

const child = spawn(binaryPath(), process.argv.slice(2), { stdio: 'inherit' });

const handlers = new Map();
for (const signal of forwarded) {
  handlers.set(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
for (const signal of swallowed) handlers.set(signal, () => {});
for (const [signal, handler] of handlers) process.on(signal, handler);

child.on('error', (err) => fail(err.message));
child.on('exit', (code, signal) => {
  for (const [name, handler] of handlers) process.removeListener(name, handler);
  if (signal) {
    process.exitCode = 128 + (os.constants.signals[signal] || 0);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
