#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { plan } from './release-lib.mjs';

function output(key, value) {
  const line = `${key}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  process.stdout.write(line);
}

const result = await plan();
process.stderr.write(
  `fnox ${result.upstream} at ${result.ref}; last release ${result.last?.version ?? 'none'}; ${result.commits.length} commits since; release type ${result.type ?? 'none'}\n`
);
output('version', result.version);
output('upstream', result.upstream);
output('ref', result.ref);
