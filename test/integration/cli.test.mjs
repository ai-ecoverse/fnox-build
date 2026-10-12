import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ageKeypair, describeRun, fnox, scratch } from './helpers.mjs';

test('fnox --version prints the upstream version', (t) => {
  const { project, env } = scratch(t);
  const res = fnox(['--version'], { cwd: project, env });
  assert.equal(res.status, 0, describeRun(res));
  assert.match(res.stdout.trim(), /^fnox \d+\.\d+\.\d+$/);
  if (process.env.FNOX_UPSTREAM_VERSION) {
    assert.equal(res.stdout.trim(), `fnox ${process.env.FNOX_UPSTREAM_VERSION}`);
  }
});

test('the plain provider stores and returns a value', (t) => {
  const { project, env } = scratch(t);
  writeFileSync(join(project, 'fnox.toml'), '[providers.plain]\ntype = "plain"\n');

  const set = fnox(['set', 'GREETING', '--provider', 'plain'], {
    cwd: project,
    env,
    input: 'hello from plain',
  });
  assert.equal(set.status, 0, describeRun(set));

  const get = fnox(['get', 'GREETING'], { cwd: project, env });
  assert.equal(get.status, 0, describeRun(get));
  assert.equal(get.stdout.trim(), 'hello from plain');
});

test('the age provider encrypts at rest and decrypts with the identity', (t) => {
  const { project, env } = scratch(t);
  const { identity, recipient } = ageKeypair();
  writeFileSync(
    join(project, 'fnox.toml'),
    `[providers.age]\ntype = "age"\nrecipients = ["${recipient}"]\n`
  );

  const set = fnox(['set', 'API_KEY', '--provider', 'age'], {
    cwd: project,
    env,
    input: 'sk-age-round-trip',
  });
  assert.equal(set.status, 0, describeRun(set));
  const config = readFileSync(join(project, 'fnox.toml'), 'utf8');
  assert.match(config, /API_KEY/);
  assert.doesNotMatch(config, /sk-age-round-trip/);

  const get = fnox(['get', 'API_KEY'], { cwd: project, env: { ...env, FNOX_AGE_KEY: identity } });
  assert.equal(get.status, 0, describeRun(get));
  assert.equal(get.stdout.trim(), 'sk-age-round-trip');

  const wrong = fnox(['get', 'API_KEY'], {
    cwd: project,
    env: { ...env, FNOX_AGE_KEY: ageKeypair().identity },
  });
  assert.notEqual(wrong.status, 0, describeRun(wrong));
  assert.doesNotMatch(wrong.stdout, /sk-age-round-trip/);
});
