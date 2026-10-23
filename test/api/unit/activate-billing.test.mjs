import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  template,
  validate,
  activate,
  roleScopes,
} from '../../../apps/api/scripts/activate-billing.mjs';
const ready = () => {
  const m = template();
  for (const g of m.grants) {
    g.membershipId = randomUUID();
    g.organizationIds = g.scopeType === 'organizations' ? [randomUUID()] : [];
  }
  return m;
};
test('template covers all six roles and eleven scopes but refuses missing real identities', () => {
  assert.equal(template().grants.length, 11);
  assert.throws(() => validate(template()));
  validate(ready());
});
test('rejects shared operators, expired grants and remote plaintext', () => {
  const m = ready();
  m.grants[1].membershipId = m.grants[0].membershipId;
  assert.throws(() => validate(m));
  const expired = ready();
  expired.grants[0].expiresAt = '2020-01-01';
  assert.throws(() => validate(expired));
  const remote = ready();
  remote.accessUrl = 'http://example.com';
  assert.throws(() => validate(remote));
});
test('no product changes if catalog platform authorization is denied', async () => {
  let calls = 0;
  await assert.rejects(
    activate(ready(), 'test', async () => {
      calls++;
      return new Response('{}', { status: 403 });
    }),
    /403/,
  );
  assert.equal(calls, 1);
});
test('uses stable manifest keys and API role ids; does not patch an already aligned product', async () => {
  const m = ready(),
    writes = [];
  const result = await activate(m, 'test', async (url, options) => {
    if (url.pathname.endsWith('/catalogs/billing/v1'))
      return Response.json({
        roles: Object.keys(roleScopes).map((code) => ({
          code,
          id: randomUUID(),
        })),
      });
    if (options.method === 'GET')
      return Response.json({ status: 'active', provisioningMode: 'none' });
    assert.equal(options.method, 'POST');
    writes.push(JSON.parse(options.body));
    return Response.json({ id: randomUUID() });
  });
  assert.equal(result.length, 11);
  assert.deepEqual(
    writes.map((x) => x.idempotencyKey),
    m.grants.map((x) => x.idempotencyKey),
  );
  assert.ok(writes.every((x) => x.roleId && !x.role));
});
