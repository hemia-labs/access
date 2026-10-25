import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = name => JSON.parse(readFileSync(join(root, 'apps', name, 'package.json'))).version;
const before = { api: version('api'), web: version('web') };
assert.equal(before.api, before.web, 'Access packages must share a version');
execFileSync(process.execPath, [join(root, 'node_modules/@changesets/cli/bin.js'), 'version'], { cwd: root, stdio: 'inherit' });
assert.equal(version('api'), version('web'), 'Access packages must share a version');
assert.notEqual(version('api'), before.api, 'No pending Access changesets');
let lock = readFileSync(join(root, 'bun.lock'), 'utf8');
for (const name of ['api', 'web']) {
  const entry = new RegExp(`("apps/${name}":\\s*\\{\\s*"name":\\s*"${name}",\\s*"version":\\s*")([^"]+)(")`, 'g');
  const matches = [...lock.matchAll(entry)];
  assert.equal(matches.length, 1, `Expected one ${name} workspace`);
  assert.equal(matches[0][2], before[name], 'Lockfile version differs');
  lock = lock.replace(entry, (_match, prefix, _old, suffix) => `${prefix}${version(name)}${suffix}`);
}
writeFileSync(join(root, 'bun.lock'), lock);
execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' });
