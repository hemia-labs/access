import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const roleScopes = {
  'billing.viewer': ['all_customers', 'organizations'],
  'billing.operator': ['all_customers', 'organizations'],
  'billing.catalog_manager': ['catalog_global'],
  'billing.invoice_operator': ['all_customers', 'organizations'],
  'billing.auditor': ['all_customers', 'organizations'],
  'billing.integration_operator': ['all_customers', 'organizations'],
};
export function template(now = Date.now()) {
  return {
    accessUrl: 'http://localhost:3019',
    administratorEmail: 'admin@hemia.mx',
    grants: Object.entries(roleScopes).flatMap(([role, scopes]) =>
      scopes.map((scopeType) => ({
        role,
        scopeType,
        membershipId: null,
        organizationIds: scopeType === 'organizations' ? [null] : [],
        idempotencyKey: randomUUID(),
        validFrom: new Date(now).toISOString(),
        expiresAt: new Date(now + 7 * 86400000).toISOString(),
      })),
    ),
  };
}
export function validate(manifest) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const url = new URL(manifest.accessUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Invalid Access base URL');
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw Error('Remote Access requires HTTPS');
  if (!Array.isArray(manifest.grants) || manifest.grants.length !== 11)
    throw Error('Provide all eleven role/scope cases');
  const cases = new Set(),
    members = new Set(),
    keys = new Set();
  for (const grant of manifest.grants) {
    if (!roleScopes[grant.role]?.includes(grant.scopeType))
      throw Error('Invalid role/scope');
    if (!uuid.test(grant.membershipId) || !uuid.test(grant.idempotencyKey))
      throw Error('Fill real membership IDs and UUID idempotency keys');
    if (
      !Array.isArray(grant.organizationIds) ||
      (grant.scopeType === 'organizations'
        ? grant.organizationIds.length !== 1
        : grant.organizationIds.length !== 0) ||
      grant.organizationIds.some((id) => !uuid.test(id))
    )
      throw Error(
        'Restricted test cases require exactly one real customer organization',
      );
    const from = Date.parse(grant.validFrom),
      until = Date.parse(grant.expiresAt);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(until) ||
      until <= Date.now() ||
      until <= from ||
      until - from > 7 * 86400000
    )
      throw Error('Test grants must expire within seven days of validFrom');
    cases.add(`${grant.role}:${grant.scopeType}`);
    members.add(grant.membershipId);
    keys.add(grant.idempotencyKey);
  }
  if (cases.size !== 11 || members.size !== 11 || keys.size !== 11)
    throw Error('Use separate memberships and keys for all eleven cases');
}
export async function activate(manifest, token, request = fetch) {
  validate(manifest);
  if (!token)
    throw Error(
      'ACCESS_ADMIN_TOKEN must contain an authenticated platform administrator bearer token',
    );
  const call = async (method, path, body) => {
    const response = await request(new URL(path, manifest.accessUrl), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw Error(
        `${method} ${path}: HTTP ${response.status}; stop and resume with the same manifest`,
      );
    return response.json();
  };
  // Publish first: the server must validate platform authority before any product mutation.
  const catalog = await call(
    'POST',
    '/v1/system-roles/catalogs/billing/v1',
    {},
  );
  if (
    catalog.roles?.length !== 6 ||
    Object.keys(roleScopes).some(
      (code) => !catalog.roles.some((role) => role.code === code),
    )
  )
    throw Error('Unexpected Billing catalog');
  const product = await call('GET', '/v1/products/billing');
  if (product.status !== 'active')
    throw Error('Billing product must already be active');
  if (product.provisioningMode !== 'none')
    await call('PATCH', '/v1/products/billing', { provisioning_mode: 'none' });
  const results = [];
  for (const grant of manifest.grants) {
    const { role, ...body } = grant;
    const result = await call('POST', '/v1/system-roles/assignments', {
      ...body,
      roleId: catalog.roles.find((item) => item.code === role).id,
    });
    results.push({
      role,
      scope: grant.scopeType,
      assignmentId: result.id,
      replayed: result.replayed ?? false,
    });
  }
  return results;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv[2] === '--template')
      console.log(JSON.stringify(template(), null, 2));
    else {
      const manifest = JSON.parse(await readFile(process.argv[3], 'utf8'));
      if (process.argv[2] === '--check') {
        validate(manifest);
        console.log('Manifest valid; no changes applied');
      } else if (process.argv[2] === '--apply')
        console.log(
          JSON.stringify(
            await activate(manifest, process.env.ACCESS_ADMIN_TOKEN),
            null,
            2,
          ),
        );
      else
        throw Error(
          'Use --template | --check manifest.json | --apply manifest.json',
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
