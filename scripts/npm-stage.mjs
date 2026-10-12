#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assetName, PLATFORMS, packageName, SCOPE } from './platforms.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    from: { type: 'string', default: join(root, 'artifacts', 'release') },
    out: { type: 'string', default: join(root, 'dist', 'npm') },
    only: { type: 'string', multiple: true },
  },
});

if (!values.version) {
  process.stderr.write(
    'usage: npm-stage.mjs --version <semver> [--from dir] [--out dir] [--only os-arch]...\n'
  );
  process.exit(2);
}
const version = values.version.replace(/^v/, '');
const selected = values.only?.length
  ? PLATFORMS.filter((t) => values.only.includes(t.platform))
  : PLATFORMS;
const launcherName = `${SCOPE}/fnox`;
const license = join(values.from, 'LICENSE');
if (!existsSync(license))
  throw new Error(`missing ${license}, fnox's license from the source it was built from`);
const fnoxRef = readFileSync(join(root, 'FNOX_REF'), 'utf8').trim();
const upstream = version.replace(/-slicc\..*$/, '').replace(/-dry-run\..*$/, '');

const common = {
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/ai-ecoverse/fnox-build.git' },
  homepage: 'https://github.com/ai-ecoverse/fnox-build#readme',
};

const readme = `# ${launcherName}

[fnox](https://fnox.jdx.dev), the secret manager by [@jdx](https://github.com/jdx), built natively for macOS, Linux and Windows from SLICC's fork [ai-ecoverse/fnox](https://github.com/ai-ecoverse/fnox) at commit [\`${fnoxRef.slice(0, 12)}\`](https://github.com/ai-ecoverse/fnox/commit/${fnoxRef}) (fnox ${upstream} plus SLICC's carried patches).

\`\`\`sh
npx ${launcherName} --version
npm install -g ${launcherName}
\`\`\`

This package is a small Node launcher that runs the signed binary from the matching platform package (${PLATFORMS.map((t) => `\`${packageName(t)}\``).join(', ')}). Versions are \`<fnox version>-slicc.<build>\`. See [ai-ecoverse/fnox-build](https://github.com/ai-ecoverse/fnox-build) for what the build carries, how it is signed, and how to verify it. fnox is MIT-licensed; its license is in \`LICENSE\`.
`;

function write(dir, file, content) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, file),
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
  );
}

function stagePlatform(target) {
  const source = join(values.from, assetName(target));
  if (!existsSync(source)) throw new Error(`missing ${source}`);
  const name = packageName(target);
  const dir = join(values.out, `fnox-${target.platform}`);
  const file = target.os === 'win32' ? 'fnox.exe' : 'fnox';
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(source, join(dir, 'bin', file));
  chmodSync(join(dir, 'bin', file), 0o755);
  copyFileSync(license, join(dir, 'LICENSE'));
  write(dir, 'package.json', {
    name,
    version,
    description: `The fnox binary for ${target.label}`,
    ...common,
    os: [target.os],
    cpu: [target.cpu],
    files: [`bin/${file}`],
    preferUnplugged: true,
  });
  write(
    dir,
    'README.md',
    `# ${name}\n\nThe \`fnox\` binary for ${target.label}, built by [ai-ecoverse/fnox-build](https://github.com/ai-ecoverse/fnox-build). Install [${launcherName}](https://www.npmjs.com/package/${launcherName}) instead of this package.\n`
  );
  return name;
}

function stageLauncher(platforms) {
  const dir = join(values.out, 'fnox');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(join(root, 'npm', 'fnox.js'), join(dir, 'bin', 'fnox.js'));
  chmodSync(join(dir, 'bin', 'fnox.js'), 0o755);
  copyFileSync(license, join(dir, 'LICENSE'));
  write(dir, 'README.md', readme);
  write(dir, 'package.json', {
    name: launcherName,
    version,
    description: 'fnox, the secret manager, as signed native builds of SLICC’s patched fork',
    ...common,
    bin: { fnox: 'bin/fnox.js' },
    files: ['bin/fnox.js'],
    engines: { node: '>=18' },
    optionalDependencies: Object.fromEntries(platforms.map((name) => [name, version])),
  });
}

rmSync(values.out, { recursive: true, force: true });
const platforms = selected.map(stagePlatform);
stageLauncher(platforms);
process.stdout.write(
  `staged ${launcherName}@${version} and ${platforms.length} platform packages in ${values.out}\n`
);
