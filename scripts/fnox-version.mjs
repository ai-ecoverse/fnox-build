#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function fnoxVersion(cargoToml) {
  const section = cargoToml.match(/^\[workspace\.package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m);
  const version = section?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('no version in the [workspace.package] table of Cargo.toml');
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(
    `${fnoxVersion(readFileSync(process.argv[2] || 'work/fnox/Cargo.toml', 'utf8'))}\n`
  );
}
