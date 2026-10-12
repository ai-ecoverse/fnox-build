import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [state, seconds] = process.argv.slice(2);
const countFile = join(state, 'count');
const count = (existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0) + 1;
writeFileSync(countFile, String(count));
const token = `tok-${count}-${randomBytes(8).toString('hex')}`;
appendFileSync(join(state, 'tokens'), `${token}\n`);
const expires = new Date(Date.now() + Number(seconds) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
process.stderr.write(`lease ${count} for ${process.env.FNOX_LEASE_LABEL}\n`);
process.stdout.write(
  `${JSON.stringify({ credentials: { GH_TOKEN: token }, expires_at: expires, lease_id: `test-lease-${count}` })}\n`
);
