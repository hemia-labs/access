const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { randomUUID, randomBytes, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const dotenv = require(root + '/access/apps/api/node_modules/dotenv');
const s = JSON.parse(fs.readFileSync(process.env.HEMIA_ACCEPTANCE_STATE_FILE));
const admin = JSON.parse(fs.readFileSync(process.env.HEMIA_ADMIN_SESSION_FILE));
const e = dotenv.parse(fs.readFileSync(root + '/access/apps/api/.env.local'));
async function access(token, method, p, body, status = 201) {
  const r = await fetch('http://localhost:3019' + p, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(r.status, status, `${method} ${p}: ${await r.clone().text()}`);
  return r.json();
}
async function login(user, product) {
  const r = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user.email, password: user.password }),
  });
  assert.equal(r.status, 201);
  const cookie = r.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
  if (product === 'billing') {
    const start = await fetch('http://localhost:3015/auth/login', {
      redirect: 'manual',
    });
    const code = await fetch(start.headers.get('location'), {
      headers: { cookie },
      redirect: 'manual',
    });
    const end = await fetch(code.headers.get('location'), {
      redirect: 'manual',
    });
    return end.headers
      .getSetCookie()
      .map((x) => x.split(';')[0])
      .join('; ');
  }
  const verifier = randomBytes(32).toString('base64url');
  const q = new URLSearchParams({
    client_id: 'access',
    redirect_uri: 'http://localhost:3019/auth/callback',
    response_type: 'code',
    scope: 'openid profile email access.access',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: randomUUID(),
    nonce: randomUUID(),
  });
  const code = await fetch('http://localhost:4000/oauth/authorize?' + q, {
    headers: { cookie },
    redirect: 'manual',
  });
  const token = await fetch('http://localhost:4000/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: 'access',
      client_secret: e.IDENTITY_INTROSPECTION_CLIENT_SECRET,
      redirect_uri: 'http://localhost:3019/auth/callback',
      code: new URL(code.headers.get('location')).searchParams.get('code'),
      code_verifier: verifier,
    }),
  });
  assert.equal(token.status, 201);
  return (await token.json()).access_token;
}
const session = (cookie) =>
  fetch('http://localhost:3015/auth/session', { headers: { cookie } });
const denyEventually = async (cookie) => {
  for (let i = 0; i < 60; i++) {
    const r = await session(cookie);
    if ([401, 403].includes(r.status)) return r.status;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Delegated access was not invalidated');
};
(async () => {
  const delegate = s.users['operator-organizations'],
    recipient = s.users['no-role'];
  const token = await login(delegate, 'access');
  const catalog = await access(
    admin.accessToken,
    'POST',
    '/v1/system-roles/catalogs/billing/v1',
    {},
  );
  const viewer = catalog.roles.find((r) => r.code === 'billing.viewer').id;
  const otherRole = catalog.roles.find((r) => r.code === 'billing.operator').id;
  const base = {
    roleId: viewer,
    scopeType: 'organizations',
    organizationIds: [s['billing-acceptance-a']],
    validFrom: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const delegations = [],
    grants = [];
  let suspended = false;
  try {
    const d = await access(
      admin.accessToken,
      'POST',
      '/v1/system-roles/delegations',
      {
        ...base,
        membershipId: delegate.membershipId,
        recipientOrganizationId: recipient.organizationId,
        canGrant: true,
        canRevoke: true,
        idempotencyKey: randomUUID(),
      },
    );
    delegations.push(d.id);
    const grant = {
      ...base,
      membershipId: recipient.membershipId,
      authorityDelegationId: d.id,
      idempotencyKey: randomUUID(),
    };
    for (const override of [
      { organizationIds: [s['billing-acceptance-b']] },
      { membershipId: delegate.membershipId },
      { roleId: otherRole },
    ])
      await access(
        token,
        'POST',
        '/v1/system-roles/assignments',
        { ...grant, ...override, idempotencyKey: randomUUID() },
        403,
      );
    const g = await access(
      token,
      'POST',
      '/v1/system-roles/assignments',
      grant,
    );
    grants.push(g.id);
    let cookie = await login(recipient, 'billing');
    assert.equal((await session(cookie)).status, 200);
    await access(
      admin.accessToken,
      'POST',
      `/v1/system-roles/delegations/${d.id}/revoke`,
      { expectedVersion: 1 },
    );
    delegations.shift();
    await denyEventually(cookie);
    const replacement = await access(
      admin.accessToken,
      'POST',
      '/v1/system-roles/delegations',
      {
        ...base,
        membershipId: delegate.membershipId,
        recipientOrganizationId: recipient.organizationId,
        canGrant: true,
        canRevoke: true,
        idempotencyKey: randomUUID(),
      },
    );
    delegations.push(replacement.id);
    cookie = await login(recipient, 'billing');
    assert.ok(
      [401, 403].includes((await session(cookie)).status),
      'new delegation cannot inherit old assignments',
    );
    await access(
      admin.accessToken,
      'POST',
      `/v1/system-roles/assignments/${g.id}/revoke`,
      { expectedVersion: 1 },
    );
    grants.shift();
    const renewed = await access(
      token,
      'POST',
      '/v1/system-roles/assignments',
      {
        ...grant,
        authorityDelegationId: replacement.id,
        idempotencyKey: randomUUID(),
      },
    );
    grants.push(renewed.id);
    cookie = await login(recipient, 'billing');
    assert.equal((await session(cookie)).status, 200);
    await access(
      admin.accessToken,
      'POST',
      `/v1/organizations/${delegate.organizationId}/memberships/${delegate.membershipId}/suspend`,
      {},
    );
    suspended = true;
    await denyEventually(cookie);
    const report = {
      delegatedGrant: true,
      scopeEscalationDenied: true,
      selfAssignmentDenied: true,
      roleEscalationDenied: true,
      revocationPropagated: true,
      noAutomaticTransfer: true,
      administratorSuspensionPropagated: true,
    };
    fs.writeFileSync(
      root + '/docs/migracion/billing-delegations-results.local.json',
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    if (suspended)
      await access(
        admin.accessToken,
        'POST',
        `/v1/organizations/${delegate.organizationId}/memberships/${delegate.membershipId}/activate`,
        {},
      );
    for (const id of grants)
      await access(
        admin.accessToken,
        'POST',
        `/v1/system-roles/assignments/${id}/revoke`,
        { expectedVersion: 1 },
      );
    for (const id of delegations)
      await access(
        admin.accessToken,
        'POST',
        `/v1/system-roles/delegations/${id}/revoke`,
        { expectedVersion: 1 },
      );
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
