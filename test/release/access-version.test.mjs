import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { accessChangeset, isAccessVersionBatch, retryReleaseTag } from '../../scripts/access-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const note = '---\n"api": major\n---\nInitial Access release.\n';
const files = ['apps/api/package.json', 'apps/web/package.json', 'apps/api/CHANGELOG.md', 'apps/web/CHANGELOG.md', 'bun.lock', '.changeset/access.md'];
const removed = [{ path: '.changeset/access.md', source: note }];
const before = { api: '0.1.0', web: '0.1.0' };
const after = { api: '1.0.0', web: '1.0.0' };

test('only complete version merges consuming Access changesets can publish', () => {
  assert(isAccessVersionBatch(before, after, files, removed));
  assert.equal(isAccessVersionBatch(before, before, files, removed), false);
  assert.equal(isAccessVersionBatch(before, after, [...files, 'apps/api/src/main.ts'], removed), false);
  assert.equal(isAccessVersionBatch(before, after, files.slice(1), removed), false);
  assert.equal(isAccessVersionBatch(before, after, files, []), false);
  assert.equal(accessChangeset('---\n"@hemia/auth": patch\n---\nSDK'), false);
  assert.throws(() => isAccessVersionBatch(after, before, files, removed), /must increase/);
  assert.throws(() => isAccessVersionBatch(before, { ...after, web: '2.0.0' }, files, removed), /share a version/);
});

test('retry accepts only the committed shared stable version', () => {
  assert.equal(retryReleaseTag('access-v1.0.0', '1.0.0', '1.0.0'), 'access-v1.0.0');
  assert.throws(() => retryReleaseTag('access-v1.0.1', '1.0.0', '1.0.0'));
  assert.throws(() => retryReleaseTag('access-v1.0.0', '1.0.0', '1.0.1'));
  assert.throws(() => retryReleaseTag('access-v1.0.0-rc.1', '1.0.0-rc.1', '1.0.0-rc.1'));
});

test('real Changesets produces synchronized packages, lock, changelogs, tag and release notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'access-version-'));
  try {
    for (const folder of ['apps/api', 'apps/web', '.changeset', 'scripts', 'bin']) mkdirSync(join(dir, folder), { recursive: true });
    for (const path of ['package.json', 'bun.lock', 'apps/api/package.json', 'apps/web/package.json', '.changeset/config.json',
      'scripts/access-version.mjs', 'scripts/version-access.mjs']) copyFileSync(join(root, path), join(dir, path));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
    writeFileSync(join(dir, '.changeset/access.md'), note);
    git('add', '.changeset');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'functional change');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const cli = (...args) => execFileSync(process.execPath, [join(dir, 'scripts/access-version.mjs'), ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    assert(cli('pending').includes('true'));
    writeFileSync(join(dir, 'bin/bun'), '#!/bin/sh\ntest "$*" = "install --frozen-lockfile"\n', { mode: 0o755 });
    execFileSync(process.execPath, [join(dir, 'scripts/version-access.mjs')], {
      cwd: dir, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` }, stdio: 'pipe',
    });
    const versions = ['api', 'web'].map(name => JSON.parse(readFileSync(join(dir, 'apps', name, 'package.json'))).version);
    assert.equal(versions[0], versions[1]);
    const lock = readFileSync(join(dir, 'bun.lock'), 'utf8');
    for (const name of ['api', 'web']) {
      assert(lock.split(`"apps/${name}": {`)[1].split('}')[0].includes(`"version": "${versions[0]}"`));
      assert(readFileSync(join(dir, 'apps', name, 'CHANGELOG.md'), 'utf8').includes(`## ${versions[0]}`));
    }
    assert(cli('pending').includes('false'));
    const base = git('rev-parse', 'HEAD');
    git('add', 'apps', '.changeset', 'bun.lock');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'version');
    assert(cli('classify', base).includes(`Access version-only merge: access-v${versions[0]}`));
    assert(cli('notes').includes('Initial Access release.'));
    assert(cli('retry', `access-v${versions[0]}`).includes('Explicit unpublished release retry'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
