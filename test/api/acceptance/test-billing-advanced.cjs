const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "../../../..");
const billing = path.resolve(root, "../billing/apps/api");
const { Client } = require(billing + "/node_modules/pg");
const Redis = require(billing + "/node_modules/ioredis");
const dotenv = require(billing + "/node_modules/dotenv");
const statePath = process.env.HEMIA_ACCEPTANCE_STATE_FILE;
assert.ok(statePath, "HEMIA_ACCEPTANCE_STATE_FILE required");
const state = JSON.parse(fs.readFileSync(statePath));
assert.ok(
  process.argv.includes("--refresh") || process.argv.includes("--isolation"),
  "choose --refresh or --isolation",
);
const env = (dir) => {
  const e = {};
  for (const f of [".env", ".env.local"])
    try {
      Object.assign(e, dotenv.parse(fs.readFileSync(dir + "/" + f)));
    } catch {}
  return e;
};
const be = env(billing),
  ie = env(root + "/identity/backend");
const db = (e) =>
  new Client({
    host: e.DB_HOST,
    port: Number(e.DB_PORT),
    user: e.DB_USERNAME,
    password: e.DB_PASSWORD,
    database: e.DB_DATABASE,
    connectionTimeoutMillis: 5000,
  });
const redis = new Redis({
  host: be.REDIS_HOST,
  port: Number(be.REDIS_PORT) || 6379,
  password: be.REDIS_PASSWORD || undefined,
  db: Number(be.REDIS_DB) || 0,
});
const bd = db(be),
  idb = db(ie);
const report = [];
const request = (user, url, method = "GET", body) =>
  fetch(url, {
    method,
    headers: {
      cookie: user.billingCookie,
      origin: "http://localhost:5175",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
const api = (user, p, method, body) =>
  request(
    user,
    "http://localhost:3015/api/v1/billing/console" + p,
    method,
    body,
  );
const sessionKey = (u) =>
  "sso:session:" +
  u.billingCookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("billing_session="))
    .split("=")[1];
async function refresh() {
  const u =
    state.users[process.env.HEMIA_REFRESH_USER || "viewer-all_customers"];
  const key = sessionKey(u),
    before = JSON.parse(await redis.get(key));
  assert.ok(before?.refreshToken);
  const claims = JSON.parse(
    Buffer.from(before.accessToken.split(".")[1], "base64url"),
  );
  assert.ok(
    claims.exp * 1000 < Date.now(),
    "Run after the real 15-minute token expiry; do not modify clocks/tokens",
  );
  const hash = createHash("sha256").update(before.accessToken).digest("hex");
  const parent = (
    await idb.query("SELECT family_id FROM oauth_tokens WHERE token_hash=$1", [
      hash,
    ])
  ).rows[0];
  assert.ok(parent);
  const count = async () =>
    Number(
      (
        await idb.query(
          "SELECT count(*) FROM oauth_tokens WHERE family_id=$1 AND refresh_token_hash IS NOT NULL",
          [parent.family_id],
        )
      ).rows[0].count,
    );
  const initial = await count();
  const responses = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      request(u, `http://localhost:${i % 2 ? 3014 : 3015}/auth/session`),
    ),
  );
  for (const r of responses) {
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).organizationId, u.organizationId);
  }
  const after = JSON.parse(await redis.get(key));
  assert.equal(after.id, before.id);
  assert.notEqual(after.refreshToken, before.refreshToken);
  assert.ok(Date.parse(after.expiresAt) > Date.now());
  assert.equal(
    await count(),
    initial + 1,
    "exactly one refresh child across two instances",
  );
  report.push({
    case: "expired-token-concurrent-refresh",
    requests: 16,
    instances: 2,
    refreshChildren: 1,
    selectionPreserved: true,
  });
}
async function isolation() {
  const a = state["billing-acceptance-a"],
    b = state["billing-acceptance-b"];
  const auditor = state.users["auditor-organizations"],
    writer = state.users["invoice_operator-organizations"];
  const baseline = await api(auditor, "/dashboard/summary");
  assert.equal(baseline.status, 200);
  const base = (await baseline.json()).pendingInvoices;
  const payments = [],
    invoices = [];
  try {
    for (const organization of [a, b]) {
      const pay = (
        await bd.query(
          "INSERT INTO payments(organization_id,provider,amount,currency,status,provider_capture_id) VALUES($1,'paypal',116,'MXN','paid',$2) RETURNING id",
          [organization, "acceptance-" + randomUUID()],
        )
      ).rows[0].id;
      payments.push(pay);
      const inv = (
        await bd.query(
          "INSERT INTO invoices(organization_id,payment_id,rfc,legal_name,tax_regime,cfdi_use,subtotal,tax_amount,total,currency,status,metadata) VALUES($1,$2,'AAA010101AAA','Acceptance synthetic','601','G03',100,16,116,'MXN','pending',$3) RETURNING id",
          [organization, pay, JSON.stringify({ acceptance: true })],
        )
      ).rows[0].id;
      invoices.push(inv);
    }
    const list = await api(auditor, "/invoices");
    assert.equal(list.status, 200);
    const rows = await list.json();
    assert.ok(rows.some((x) => x.id === invoices[0]));
    assert.ok(!rows.some((x) => x.id === invoices[1]));
    assert.equal((await api(auditor, "/invoices/" + invoices[0])).status, 200);
    assert.equal((await api(auditor, "/invoices/" + invoices[1])).status, 403);
    const forged = await api(auditor, "/invoices?organization_id=" + b);
    assert.equal(forged.status, 200);
    assert.deepEqual(
      await forged.json(),
      [],
      "forged filter cannot broaden scope",
    );
    const dash = await (await api(auditor, "/dashboard/summary")).json();
    assert.equal(
      dash.pendingInvoices,
      base + 1,
      "aggregate excludes customer B",
    );
    for (const action of ["issue", "cancel"])
      assert.equal(
        (await api(writer, `/invoices/${invoices[1]}/${action}`, "POST", {}))
          .status,
        403,
        "cross-customer mutation denied before provider",
      );
    const row = (
      await bd.query("SELECT status,metadata FROM invoices WHERE id=$1", [
        invoices[1],
      ])
    ).rows[0];
    assert.equal(row.status, "pending");
    assert.deepEqual(row.metadata, { acceptance: true });
    report.push({
      case: "two-customer-isolation",
      list: true,
      detail: true,
      forgedFilter: true,
      aggregate: true,
      issueDenied: true,
      cancelDenied: true,
    });
  } finally {
    if (invoices.length)
      await bd.query("DELETE FROM invoices WHERE id=ANY($1::uuid[])", [
        invoices,
      ]);
    if (payments.length)
      await bd.query("DELETE FROM payments WHERE id=ANY($1::uuid[])", [
        payments,
      ]);
  }
}
(async () => {
  try {
    await bd.connect();
    await idb.connect();
    if (process.argv.includes("--refresh")) await refresh();
    if (process.argv.includes("--isolation")) await isolation();
    fs.writeFileSync(
      root + "/docs/migracion/billing-advanced-results.local.json",
      JSON.stringify({ at: new Date().toISOString(), cases: report }, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    await Promise.all([redis.quit(), bd.end(), idb.end()]);
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
