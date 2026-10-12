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
  `jdx/fnox ${result.tag} with homescoop ${result.homescoop}; source tree ${result.tree || 'not fetched'}${result.sameSource ? ' (same as the last release)' : ''}; last release ${result.last?.version ?? 'none'}; ${result.commits.length} commits since, ${result.skipped} of them only move a pin to the same source; release type ${result.type ?? 'none'}\n`
);
output('version', result.version);
output('upstream', result.upstream);
output('homescoop', result.homescoop);
output('tree', result.tree);
