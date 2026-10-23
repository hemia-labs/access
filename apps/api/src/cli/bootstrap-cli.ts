import 'reflect-metadata';
import { readFileSync, statSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { isUUID } from 'class-validator';
import { AppDataSource } from '../../data-source';
import { bootstrapSystemRoles } from './system-bootstrap';

async function main(product: 'billing' | 'legal') {
  const { values } = parseArgs({
    options: {
      'membership-id': { type: 'string' },
      email: { type: 'string' },
      reason: { type: 'string' },
      'token-file': { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    !values['membership-id'] ||
    !isUUID(values['membership-id']) ||
    !values.email ||
    !values.reason ||
    !values['token-file']
  )
    throw new Error(
      'Required: --membership-id UUID --email EMAIL --reason TEXT --token-file PRIVATE_FILE [--apply]',
    );
  const file = statSync(values['token-file']);
  if (!file.isFile() || (file.mode & 0o077) !== 0 || file.size > 8192)
    throw new Error(
      'Token file must be private (0600 or 0400), regular and at most 8192 bytes',
    );
  const token = readFileSync(values['token-file'], 'utf8').trim();
  if (!token || /\s/.test(token))
    throw new Error('Token file must contain one opaque Identity access token');
  const issuer = process.env.IDENTITY_ISSUER?.replace(/\/$/, '');
  if (!issuer) throw new Error('IDENTITY_ISSUER is required');
  const url = new URL(issuer);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('Identity requires HTTPS except local development');
  const response = await fetch(new URL('/oidc/userinfo', issuer), {
    headers: { authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error('Identity rejected the user token: ' + response.status);
  const user = (await response.json()) as { sub?: string; email?: string };
  if (
    !user.sub ||
    typeof user.email !== 'string' ||
    user.email.toLowerCase() !== values.email.toLowerCase()
  )
    throw new Error('Identity token must belong to the requested recipient');
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations())
      throw new Error(
        'Pending migrations; apply them explicitly before bootstrap',
      );
    const executor = userInfo();
    const result = await bootstrapSystemRoles(product, AppDataSource, {
      identity: { issuer, subject: user.sub, email: user.email },
      membershipId: values['membership-id'],
      reason: values.reason,
      executor: {
        username: executor.username,
        hostname: hostname(),
        uid: executor.uid,
      },
      apply: values.apply,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await AppDataSource.destroy();
  }
}
export function runBootstrap(product: 'billing' | 'legal') {
  void main(product).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Bootstrap failed');
    process.exitCode = 1;
  });
}
