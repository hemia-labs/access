import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function compareVersions(left, right) {
  const parse = value => {
    assert(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value), 'Expected stable SemVer');
    const parts = value.split('.').map(Number);
    assert(parts.every(Number.isSafeInteger), 'Version number is too large');
    return parts;
  };
  const a = parse(left), b = parse(right);
  return a.map((value, index) => Math.sign(value - b[index])).find(Boolean) ?? 0;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const versionFiles = ['apps/api/package.json', 'apps/web/package.json',
  'apps/api/CHANGELOG.md', 'apps/web/CHANGELOG.md', 'bun.lock'];

export function accessChangeset(source) {
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const targets = [...header.matchAll(/^\s*["']?([^"'\s:]+)["']?\s*:\s*(patch|minor|major)\s*$/gm)].map(m => m[1]);
  return targets.length > 0 && targets.every(name => ['api', 'web'].includes(name));
}

export function isAccessVersionBatch(before, after, files, removedNotes) {
  assert.equal(after.api, after.web, 'Access packages must share a version');
  compareVersions(after.api, after.web); // Validate stable SemVer.
  if (before.api === after.api || before.web === after.web) return false;
  assert(compareVersions(after.api, before.api) > 0 &&
    compareVersions(after.web, before.web) > 0, 'Access version must increase');
  const consumed = new Set(removedNotes.filter(note => accessChangeset(note.source)).map(note => note.path));
  return consumed.size > 0 && versionFiles.every(name => files.includes(name)) &&
    files.every(name => versionFiles.includes(name) || consumed.has(name));
}

export function retryReleaseTag(tag, api, web) {
  assert.equal(api, web, 'Access packages must share a version');
  compareVersions(api, web);
  assert.equal(tag, `access-v${api}`, 'Retry tag must match the committed version');
  return tag;
}

function pending() {
  const found = readdirSync(join(root, '.changeset')).filter(name => name.endsWith('.md'))
    .some(name => accessChangeset(readFileSync(join(root, '.changeset', name), 'utf8')));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pending=${found}\n`);
  console.log(`Pending Access changesets: ${found}`);
}

function retry(tag) {
  const versions = ['api', 'web'].map(name => JSON.parse(readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')).version);
  retryReleaseTag(tag, ...versions);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release=true\ntag=${tag}\n`);
  console.log(`Explicit unpublished release retry: ${tag}`);
}

function classify(base) {
  assert(/^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base), 'Expected previous main commit');
  const before = {}, after = {};
  for (const name of ['api', 'web']) {
    before[name] = JSON.parse(git('show', `${base}:apps/${name}/package.json`)).version;
    after[name] = JSON.parse(readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')).version;
  }
  const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  const removedNotes = git('diff', '--diff-filter=D', '--name-only', base, 'HEAD', '--', '.changeset')
    .split('\n').filter(name => /^\.changeset\/[a-z0-9-]+\.md$/.test(name))
    .map(path => ({ path, source: git('show', `${base}:${path}`) }));
  const release = isAccessVersionBatch(before, after, files, removedNotes);
  const tag = `access-v${after.api}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release=${release}\ntag=${tag}\n`);
  console.log(release ? `Access version-only merge: ${tag}` : 'No Access version-only merge; update version PR if pending');
}

function notes() {
  const version = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')).version;
  const sections = [];
  for (const name of ['api', 'web']) {
    const text = readFileSync(join(root, 'apps', name, 'CHANGELOG.md'), 'utf8');
    const entry = text.split(/^## /m).slice(1).find(section => section.split(/\r?\n/, 1)[0].trim() === version);
    assert(entry, `Missing ${name} changelog entry for ${version}`);
    sections.push(`## ${name}\n\n${entry.slice(version.length).trim()}`);
  }
  console.log(sections.join('\n\n'));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'classify') classify(argument);
  else if (command === 'notes') notes();
  else if (command === 'pending') pending();
  else if (command === 'retry') retry(argument);
  else throw new Error('Usage: node scripts/access-version.mjs <classify BASE_SHA|notes|pending|retry TAG>');
}
