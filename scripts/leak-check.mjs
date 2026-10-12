#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PATTERNS = [
  ['a macOS temporary directory', /\/private\/(tmp|var)\//],
  ['a macOS per-user temporary directory', /\/var\/folders\//],
  ['a macOS home directory', /\/Users\/[^/\s]+/],
  ['a Linux home directory', /\/home\/[^/\s]+\//],
  ['a root home directory', /\/root\//],
  ['a Windows home directory', /[A-Za-z]:[\\/]Users[\\/]/i],
  ['a GitHub Actions Windows workspace', /[A-Za-z]:[\\/]a[\\/]/],
  ['a GitHub Actions runner directory', /runneradmin|\/runner\/work\/|\/Users\/runner\b/],
];

const [, , ...files] = process.argv;
if (!files.length) {
  process.stderr.write('usage: leak-check.mjs <binary>...\n');
  process.exit(2);
}

let leaks = 0;
for (const file of files) {
  const bytes = readFileSync(resolve(file));
  const text = bytes.toString('latin1');
  const runs = text.match(/[\x20-\x7e]{6,}/g) ?? [];
  const found = new Map();
  for (const run of runs) {
    for (const [what, pattern] of PATTERNS) {
      const match = run.match(pattern);
      if (!match) continue;
      const at = match.index ?? 0;
      const sample = run.slice(Math.max(0, at - 10), at + 100);
      if (!found.has(what)) found.set(what, { count: 0, sample });
      found.get(what).count += 1;
    }
  }
  if (!found.size) {
    process.stdout.write(`${file}: no host paths\n`);
    continue;
  }
  for (const [what, { count, sample }] of found) {
    leaks += count;
    process.stderr.write(
      `${file}: ${count} strings with ${what}, such as ${JSON.stringify(sample)}\n`
    );
  }
}
process.exit(leaks ? 1 : 0);
