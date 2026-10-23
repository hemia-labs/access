const fs = require("node:fs"),
  { randomBytes, randomUUID } = require("node:crypto");
const auth = JSON.parse(fs.readFileSync(process.env.HEMIA_ADMIN_SESSION_FILE));
const root = require("node:path").resolve(__dirname, "../../../..");
const statePath = process.env.HEMIA_ACCEPTANCE_STATE_FILE;
if (!statePath)
  throw Error(
    "HEMIA_ACCEPTANCE_STATE_FILE is required (outside the repository)",
  );
let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath))
  : { users: {} };
const save = () =>
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
async function call(base, method, path, body) {
  const r = await fetch(base + path, {
    method,
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + auth.accessToken,
      Cookie: auth.cookie,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      method + " " + path + " " + r.status + " " + JSON.stringify(data),
    );
  return data;
}
const access = (m, p, b) => call("http://localhost:3019", m, p, b),
  identity = (m, p, b) => call("http://localhost:4000", m, p, b);
(async () => {
  const { template, activate } = await import(
    root + "/access/apps/api/scripts/activate-billing.mjs"
  );
  if (!state.manifest) {
    state.manifest = template();
    save();
  }
  let orgs = await access("GET", "/v1/organizations?limit=100");
  if (!Array.isArray(orgs)) orgs = orgs.items || orgs.data;
  for (const [key, type] of [
    ["hemia-billing-acceptance", "internal"],
    ["billing-acceptance-a", "customer"],
    ["billing-acceptance-b", "customer"],
    ["hemia-billing-acceptance-secondary", "internal"],
  ]) {
    const org =
      orgs.find((o) => o.code === key) ||
      (await access("POST", "/v1/organizations", {
        code: key,
        slug: key,
        name: key,
        type,
        status: "active",
        metadata: { purpose: "billing-authorization-acceptance" },
      }));
    state[key] = org.id;
    save();
  }
  state.secondaryOrganizationId = state["hemia-billing-acceptance-secondary"];
  save();
  await access("POST", "/v1/system-roles/catalogs/billing/v1", {});
  await access("PATCH", "/v1/products/billing", { provisioning_mode: "none" });
  const orgId = state["hemia-billing-acceptance"];
  for (const recipient of [orgId, state.secondaryOrganizationId]) {
    const products = await access(
      "GET",
      `/v1/organizations/${recipient}/products`,
    );
    if (
      !products.some(
        (p) =>
          p.product?.code === "billing" &&
          ["enabled", "active", "ready"].includes(p.status),
      )
    )
      await access(
        "POST",
        `/v1/organizations/${recipient}/products/billing/enable`,
        {
          source: "internal",
        },
      );
  }
  const users = await identity("GET", "/api/v1/users");
  const cases = [
    ...state.manifest.grants.map((g) => ({
      key: g.role.replace("billing.", "") + "-" + g.scopeType,
      grant: g,
    })),
    { key: "no-role" },
    { key: "customer-admin" },
  ];
  for (const c of cases) {
    const email = `billing-${c.key.replaceAll("_", "-")}@integration.hemia.test`;
    if (!state.users[c.key]) {
      state.users[c.key] = {
        email,
        password: randomBytes(24).toString("base64url"),
      };
      save();
    }
    const saved = state.users[c.key];
    const user =
      users.find((u) => u.email === email) ||
      (await identity("POST", "/api/v1/users", {
        email,
        password: saved.password,
        firstName: "Billing QA",
        lastName: c.key,
        status: "active",
      }));
    saved.id = user.id;
    save();
    const recipient =
      c.key === "customer-admin" ? state["billing-acceptance-a"] : orgId;
    const memberships = await access(
      "GET",
      `/v1/organizations/${recipient}/memberships`,
    );
    const member =
      memberships.find((m) => m.identityReference?.subjectId === user.id) ||
      (await access("POST", `/v1/organizations/${recipient}/memberships`, {
        identity: {
          issuer: "http://localhost:4000",
          subject_id: user.id,
          email,
          name: "Billing QA " + c.key,
        },
        membership_type: "member",
        role_codes: c.key === "customer-admin" ? ["organization_admin"] : [],
      }));
    saved.membershipId = member.id;
    saved.organizationId = recipient;
    save();
    if (member.status !== "active")
      await access(
        "POST",
        `/v1/organizations/${recipient}/memberships/${member.id}/activate`,
        {},
      );
    if (c.grant) {
      c.grant.membershipId = member.id;
      c.grant.organizationIds =
        c.grant.scopeType === "organizations"
          ? [state["billing-acceptance-a"]]
          : [];
      save();
    }
  }
  const results = await activate(state.manifest, auth.accessToken);
  state.results = results;
  save();
  const viewer = state.users["viewer-all_customers"];
  const secondaryMembers = await access(
    "GET",
    `/v1/organizations/${state.secondaryOrganizationId}/memberships`,
  );
  const secondaryMember =
    secondaryMembers.find(
      (member) => member.identityReference?.subjectId === viewer.id,
    ) ||
    (await access(
      "POST",
      `/v1/organizations/${state.secondaryOrganizationId}/memberships`,
      {
        identity: {
          issuer: "http://localhost:4000",
          subject_id: viewer.id,
          email: viewer.email,
          name: "Billing QA secondary viewer",
        },
        membership_type: "member",
        role_codes: [],
      },
    ));
  if (secondaryMember.status !== "active")
    await access(
      "POST",
      `/v1/organizations/${state.secondaryOrganizationId}/memberships/${secondaryMember.id}/activate`,
      {},
    );
  if (!state.secondaryAssignmentId) {
    const catalog = await access(
      "POST",
      "/v1/system-roles/catalogs/billing/v1",
      {},
    );
    const assignment = await access("POST", "/v1/system-roles/assignments", {
      roleId: catalog.roles.find((role) => role.code === "billing.viewer").id,
      membershipId: secondaryMember.id,
      scopeType: "all_customers",
      organizationIds: [],
      validFrom: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      idempotencyKey: randomUUID(),
    });
    state.secondaryAssignmentId = assignment.id;
    save();
  }
  fs.writeFileSync(
    root + "/docs/migracion/billing-acceptance-manifest.local.json",
    JSON.stringify(state.manifest, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        organizations: 4,
        users: Object.keys(state.users).length,
        grants: results.length,
        administrator: "admin@hemia.mx",
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
