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
const net = require('node:net'),
  { spawn, execFileSync } = require('node:child_process');
const billing =
  process.env.HEMIA_BILLING_DIR || path.resolve(root, '../billing/apps/api');
const { Client } = require(root + '/access/apps/api/node_modules/pg');
const { EventBus } = require(
  root + '/access/apps/api/node_modules/@hemia/event-bus',
);
const url = new URL(e.AMQP_URL);
let online = true;
const sockets = new Set();
const proxy = net.createServer((c) => {
  if (!online) return c.destroy();
  const u = net.connect(Number(url.port) || 5672, url.hostname);
  for (const x of [c, u]) {
    sockets.add(x);
    x.on('error', () => {}).on('close', () => {
      c.destroy();
      u.destroy();
      sockets.delete(x);
    });
  }
  c.pipe(u);
  u.pipe(c);
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await f()) return;
    await delay(250);
  }
  throw Error('Timed out waiting for recovery');
}
function launch(dir, env, label) {
  const fd = fs.openSync('/tmp/hemia-' + label + '-dev.log', 'a');
  const p = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: dir,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  fs.closeSync(fd);
  p.unref();
  return p;
}
function currentPid(port) {
  try {
    return Number(
      execFileSync('lsof', ['-t', '-iTCP:' + port, '-sTCP:LISTEN'])
        .toString()
        .trim(),
    );
  } catch {
    return null;
  }
}
async function stopPort(port) {
  const pid = currentPid(port);
  if (!pid) return;
  const command = execFileSync('ps', [
    '-p',
    String(pid),
    '-o',
    'command=',
  ]).toString();
  assert.ok(
    command.includes('dist/src/main.js'),
    'Only stop development backends',
  );
  process.kill(pid, 'SIGTERM');
  await until(() => !currentPid(port), 10000);
}
async function ready() {
  await until(async () => {
    try {
      return (await fetch('http://localhost:3019/health/ready')).ok;
    } catch {
      return false;
    }
  });
  await until(async () => {
    try {
      return (
        (
          await fetch('http://localhost:3015/auth/login', {
            redirect: 'manual',
          })
        ).status === 302
      );
    } catch {
      return false;
    }
  });
}
(async () => {
  assert.equal(
    process.env.HEMIA_ALLOW_BACKEND_RESTART,
    '1',
    'Explicit opt-in required: restarts local Access/Billing APIs',
  );
  const db = new Client({
    host: e.DB_HOST,
    port: Number(e.DB_PORT),
    user: e.DB_USERNAME,
    password: e.DB_PASSWORD,
    database: e.DB_DATABASE,
    connectionTimeoutMillis: 5000,
  });
  let grant,
    revoked = false,
    bus,
    started = false;
  try {
    await db.connect();
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    const target = new URL(url);
    target.hostname = '127.0.0.1';
    target.port = String(proxy.address().port);
    await stopPort(3014);
    await stopPort(3015);
    await stopPort(3019);
    started = true;
    launch(
      root + '/access/apps/api',
      { AMQP_URL: target.toString() },
      'access',
    );
    launch(billing, { AMQP_URL: target.toString() }, 'billing');
    await ready();
    const recipient = s.users['no-role'];
    const catalog = await access(
      admin.accessToken,
      'POST',
      '/v1/system-roles/catalogs/billing/v1',
      {},
    );
    grant = await access(
      admin.accessToken,
      'POST',
      '/v1/system-roles/assignments',
      {
        roleId: catalog.roles.find((r) => r.code === 'billing.viewer').id,
        membershipId: recipient.membershipId,
        scopeType: 'organizations',
        organizationIds: [s['billing-acceptance-a']],
        validFrom: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        idempotencyKey: randomUUID(),
      },
    );
    await delay(6000);
    const cookie = await login(recipient, 'billing');
    assert.equal((await session(cookie)).status, 200);
    online = false;
    for (const socket of sockets) socket.destroy();
    await delay(500);
    await access(
      admin.accessToken,
      'POST',
      `/v1/system-roles/assignments/${grant.id}/revoke`,
      { expectedVersion: 1 },
    );
    revoked = true;
    assert.equal(
      (await session(cookie)).status,
      200,
      'existing read context survives bounded event outage',
    );
    const findEvents = async () =>
      (
        await db.query(
          "SELECT id,event_type,payload,status,occurred_at,published_at FROM outbox_events WHERE event_type='access.membership.context_invalidated.v1' AND payload->'data'->>'membership_id'=$1 ORDER BY occurred_at DESC LIMIT 2",
          [recipient.membershipId],
        )
      ).rows;
    let events = await findEvents();
    assert.ok(events.length === 2);
    const latest = events[0];
    assert.notEqual(latest.status, 'published');
    console.log(
      'PASS outbox persists invalidation while transport is down; checking the real 60-second bound',
    );
    await delay(61000);
    assert.ok(
      [401, 403].includes((await session(cookie)).status),
      'expired context cannot survive missing events',
    );
    online = true;
    const restored = Date.now();
    await until(async () => {
      events = await findEvents();
      return events.find((x) => x.id === latest.id)?.status === 'published';
    }, 90000);
    const recoveryMs = Date.now() - restored;
    // Warm a still-authorized fixture. Deliver a real prior invalidation to prove subscription recovery.
    const viewer = s.users['viewer-organizations'];
    const liveCookie = await login(viewer, 'billing');
    assert.equal((await session(liveCookie)).status, 200);
    const prior = (
      await db.query(
        "SELECT id,event_type,payload,occurred_at FROM outbox_events WHERE event_type='access.membership.context_invalidated.v1' AND payload->'data'->>'membership_id'=$1 ORDER BY occurred_at DESC LIMIT 1",
        [viewer.membershipId],
      )
    ).rows[0];
    assert.ok(prior);
    bus = await EventBus.connect({
      url: url.toString(),
      serviceName: 'hemia-access',
    });
    async function replay(ev) {
      await bus.publish(ev.event_type, ev.payload.data, {
        eventId: ev.id,
        occurredAt: new Date(ev.occurred_at).toISOString(),
        source: ev.payload.source,
      });
    }
    const eventLog = billing + '/events.log.jsonl';
    const consumed = (id) =>
      fs
        .readFileSync(eventLog, 'utf8')
        .split('\n')
        .filter((line) => {
          try {
            const row = JSON.parse(line);
            return row.event === 'event_consumed' && row.id === id;
          } catch {
            return false;
          }
        }).length;
    const before = consumed(prior.id);
    await replay(prior);
    await until(() => consumed(prior.id) > before);
    // Older/equal revisions invalidate cache generations but preserve an up-to-date session.
    assert.equal((await session(liveCookie)).status, 200);
    // Reverse historical context versions and duplicate stable IDs: neither may grant authority.
    const previousCounts = events.map((ev) => consumed(ev.id));
    for (const ev of [events[0], events[1], events[0], events[1]])
      await replay(ev);
    await until(() =>
      events.every((ev, index) => consumed(ev.id) >= previousCounts[index] + 2),
    );
    const deniedCookie = await login(recipient, 'billing');
    assert.ok([401, 403].includes((await session(deniedCookie)).status));
    const report = {
      at: new Date().toISOString(),
      outboxSurvivesDisconnect: true,
      readCacheBoundSeconds: 60,
      expiredContextDenied: true,
      automaticOutboxRecovery: true,
      subscriptionRecoveredWithoutRestart: true,
      duplicatesAndOutOfOrderDoNotRestoreAuthority: true,
      recoveryMs,
    };
    fs.writeFileSync(
      root + '/docs/migracion/billing-broker-recovery-results.local.json',
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    online = true;
    if (grant && !revoked)
      await access(
        admin.accessToken,
        'POST',
        `/v1/system-roles/assignments/${grant.id}/revoke`,
        { expectedVersion: 1 },
      );
    await bus?.close();
    if (started) {
      await stopPort(3015);
      await stopPort(3019);
      launch(root + '/access/apps/api', {}, 'access');
      launch(billing, {}, 'billing');
    }
    for (const socket of sockets) socket.destroy();
    proxy.close();
    await db.end();
    if (started) await ready();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
