import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeRun, fnoxAsync, scratch, testdata, tomlLiteral } from './helpers.mjs';

const tlsDir = process.env.FNOX_TEST_TLS_DIR;
const skip = tlsDir
  ? false
  : 'set FNOX_TEST_TLS_DIR after running scripts/test-tls.sh, which trusts a test CA system-wide';

if (!tlsDir && process.env.CI) {
  test('the proxy round trip runs in CI', () => {
    assert.fail('FNOX_TEST_TLS_DIR is not set; run scripts/test-tls.sh before npm test');
  });
}

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(443, host, () => resolve(server));
  });
}

async function fakeUpstream(t) {
  const seen = [];
  const options = {
    key: readFileSync(join(tlsDir, 'key.pem')),
    cert: readFileSync(join(tlsDir, 'cert.pem')),
  };
  const handler = (req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization }));
  };
  const hosts = process.platform === 'darwin' ? ['::'] : ['127.0.0.1', '::1'];
  const servers = [];
  for (const [index, host] of hosts.entries()) {
    try {
      servers.push(await listen(createServer(options, handler), host));
    } catch (err) {
      if (index === 0) throw err;
    }
  }
  t.after(() => Promise.all(servers.map((server) => new Promise((r) => server.close(r)))));
  return seen;
}

test('proxy run injects a renewed lease credential under one placeholder', { skip }, async (t) => {
  const { project, env, dir } = scratch(t);
  const state = join(dir, 'lease');
  mkdirSync(state);
  const seen = await fakeUpstream(t);
  const command = [process.execPath, join(testdata, 'lease.mjs'), state, '6']
    .map((part) => `"${part}"`)
    .join(' ');
  writeFileSync(
    join(project, 'fnox.toml'),
    [
      '[providers.plain]',
      'type = "plain"',
      '',
      '[leases.github]',
      'type = "command"',
      `create_command = ${tomlLiteral(command)}`,
      'duration = "1h"',
      '',
      '[proxy]',
      '[[proxy.rules]]',
      'secret = "GH_TOKEN"',
      'domain = "localhost"',
      'methods = ["GET"]',
      'paths = ["/repos/**"]',
      '',
    ].join('\n')
  );

  const res = await fnoxAsync(
    [
      'proxy',
      'run',
      '--',
      process.execPath,
      join(testdata, 'client.mjs'),
      '4500',
      '/repos/example/first',
      '/repos/example/second',
      '/admin/denied',
    ],
    { cwd: project, env }
  );
  assert.equal(res.status, 0, describeRun(res));

  const results = res.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const tokens = readFileSync(join(state, 'tokens'), 'utf8').trim().split('\n');
  const [first, second, denied] = results;
  assert.equal(results.length, 3, describeRun(res));
  assert.match(first.placeholder, /^fnox_proxy_[0-9a-f]{24}$/);
  assert.ok(!tokens.includes(first.placeholder), 'the child never sees a real token');

  assert.equal(first.status, 200, describeRun(res));
  assert.equal(second.status, 200, describeRun(res));
  assert.equal(denied.status, 403, describeRun(res));
  assert.equal(second.placeholder, first.placeholder);

  assert.deepEqual(
    seen.map((request) => request.path),
    ['/repos/example/first', '/repos/example/second'],
    'a request outside the rule never reaches the upstream'
  );
  assert.equal(seen[0].authorization, `Bearer ${tokens[0]}`);
  assert.ok(tokens.length >= 2, `the lease was renewed while the command ran: ${tokens}`);
  assert.notEqual(seen[1].authorization, seen[0].authorization);
  assert.ok(tokens.slice(1).some((token) => seen[1].authorization === `Bearer ${token}`));

  for (const result of [first, second]) {
    const body = JSON.parse(result.body);
    assert.equal(
      body.authorization,
      `Bearer ${first.placeholder}`,
      'reflected tokens are redacted'
    );
  }
  assert.ok(existsSync(join(env.FNOX_STATE_DIR, 'leases')), 'the lease is in the ledger');
});
