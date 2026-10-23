const fs = require("node:fs"),
  assert = require("node:assert/strict");
const statePath = process.env.HEMIA_ACCEPTANCE_STATE_FILE;
if (!statePath) throw Error("HEMIA_ACCEPTANCE_STATE_FILE is required");
const root = require("node:path").resolve(__dirname, "../../../..");
const state = JSON.parse(fs.readFileSync(statePath));
assert.equal(
  state.manifest.grants.length,
  11,
  "all eleven role/scope cases are required",
);
assert.deepEqual(
  Object.keys(state.users).sort(),
  [
    ...state.manifest.grants.map(
      (grant) => grant.role.replace("billing.", "") + "-" + grant.scopeType,
    ),
    "no-role",
    "customer-admin",
  ].sort(),
  "all thirteen acceptance users are required",
);
const catalog = require(
  require("node:path").resolve(
    root,
    "../billing/apps/api/src/modules/auth/billing-authorization-v1.json",
  ),
);
const report = [];
const updatedCookie = (cookie, response) => {
  const pairs = new Map();
  for (const pair of [
    ...cookie.split(";"),
    ...response.headers.getSetCookie().map((value) => value.split(";")[0]),
  ]) {
    const trimmed = pair.trim(),
      separator = trimmed.indexOf("=");
    if (separator > 0)
      pairs.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
};
(async () => {
  for (const [name, user] of Object.entries(state.users)) {
    const r = await fetch("http://localhost:4000/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: user.email, password: user.password }),
    });
    assert.equal(r.status, 201, name + " login");
    const cookie = r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    const start = await fetch("http://localhost:3015/auth/login", {
      redirect: "manual",
    });
    assert.equal(start.status, 302, name + " start");
    const authorize = await fetch(start.headers.get("location"), {
      headers: { cookie },
      redirect: "manual",
    });
    assert.equal(authorize.status, 302, name + " authorize");
    const callbackUrl = authorize.headers.get("location");
    assert.ok(
      callbackUrl?.startsWith("http://localhost:3015/auth/callback?"),
      name + " code",
    );
    const callback = await fetch(callbackUrl, { redirect: "manual" });
    let billingCookie = callback.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    user.billingCookie = billingCookie;
    const session = await fetch("http://localhost:3015/auth/session", {
      headers: { cookie: billingCookie },
    });
    if (name === "no-role" || name === "customer-admin") {
      assert.ok([401, 403].includes(session.status), name + " deny");
      report.push({ case: name, status: "denied", http: session.status });
      continue;
    }
    if (session.status !== 200)
      throw Error(
        name +
          " session " +
          session.status +
          " " +
          JSON.stringify(await session.json()) +
          " callback " +
          callback.headers.get("location"),
      );
    let body = await session.json();
    if (name === "viewer-all_customers") {
      assert.ok(
        state.secondaryOrganizationId,
        "prepare must create a second eligible organization",
      );
      assert.equal(
        body.requiresOrganizationSelection,
        true,
        "multi-organization selection must be exercised",
      );
    }
    if (body.requiresOrganizationSelection) {
      assert.equal(name, "viewer-all_customers");
      assert.ok(body.organizations.length >= 2);
      const select = (id, cookie = billingCookie) =>
        fetch("http://localhost:3015/auth/organization", {
          method: "POST",
          headers: {
            cookie,
            origin: "http://localhost:5175",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organizationId: id }),
        });
      const denied = await select(state["billing-acceptance-b"]);
      assert.equal(
        denied.status,
        409,
        "organization outside eligible memberships",
      );
      const secondary = await select(state.secondaryOrganizationId);
      assert.equal(secondary.status, 201);
      assert.equal(
        (await secondary.json()).organizationId,
        state.secondaryOrganizationId,
      );
      const secondaryCookie = updatedCookie(billingCookie, secondary);
      const secondarySession = await fetch(
        "http://localhost:3015/auth/session",
        { headers: { cookie: secondaryCookie } },
      );
      assert.equal(secondarySession.status, 200);
      assert.equal(
        (await secondarySession.json()).organizationId,
        state.secondaryOrganizationId,
      );
      const selected = await select(user.organizationId, secondaryCookie);
      assert.equal(selected.status, 201);
      billingCookie = updatedCookie(secondaryCookie, selected);
      user.billingCookie = billingCookie;
      body = await (
        await fetch("http://localhost:3015/auth/session", {
          headers: { cookie: billingCookie },
        })
      ).json();
      assert.equal(body.organizationId, user.organizationId);
      report.push({
        case: "organization-selection",
        status: "passed",
        unauthorizedOrganization: 409,
      });
    }
    const grant = state.manifest.grants.find(
      (g) => g.membershipId === user.membershipId,
    );
    const expected = catalog.roles.find(
      (role) => role.code === grant.role,
    ).permissions;
    assert.deepEqual(
      [...body.permissions].sort(),
      [...expected].sort(),
      name + " exact permissions",
    );
    for (const [path, permission] of [
      ["catalog/products", "billing.catalog.read"],
      ["invoices", "billing.invoices.read"],
      ["webhooks", "billing.webhooks.read"],
    ]) {
      const response = await fetch(
        "http://localhost:3015/api/v1/billing/console/" + path,
        { headers: { cookie: billingCookie } },
      );
      assert.equal(
        response.status,
        expected.includes(permission) ? 200 : 403,
        name + " " + path,
      );
    }
    report.push({
      case: name,
      status: "passed",
      permissions: body.permissions.length,
    });
    console.log(name, "PASS");
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.writeFileSync(
    root + "/docs/migracion/billing-acceptance-results.local.json",
    JSON.stringify(
      { testedAt: new Date().toISOString(), cases: report },
      null,
      2,
    ),
  );
  console.log("E2E", report.length, "cases PASS");
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
