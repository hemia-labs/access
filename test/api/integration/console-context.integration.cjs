// Synthetic TEMP tables in a disposable PostgreSQL container; no application DB,
// environment credentials, migrations, seeds, volumes or published non-loopback ports.
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const apiRequire = createRequire(path.resolve(__dirname, '../../../apps/api/package.json'));
apiRequire('reflect-metadata');
apiRequire('ts-node').register({
  project: path.resolve(__dirname, '../../../apps/api/tsconfig.json'),
  transpileOnly: true,
});
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = apiRequire('pg');
const { ConfigService } = apiRequire('@nestjs/config');
const { ConsoleAuthorizationService } = require('../../../apps/api/src/modules/access-context/authorization/console-authorization.service.ts');
const { AccessJwksService } = require('../../../apps/api/src/modules/access-context/jwks/access-jwks.service.ts');

const container = `console-context-test-${randomUUID()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const ids = {
  org: '11111111-1111-4111-8111-111111111111',
  identity: '22222222-2222-4222-8222-222222222222',
  membership: '33333333-3333-4333-8333-333333333333',
  role: '44444444-4444-4444-8444-444444444444',
  permission: '55555555-5555-4555-8555-555555555555',
  product: '66666666-6666-4666-8666-666666666666',
  extraRole: '77777777-7777-4777-8777-777777777777',
};
const actor = {
  issuer: 'http://identity.test', subjectId: 'operator',
  identityReferenceId: ids.identity, identityType: 'workforce_user',
};

async function main() {
  let client;
  let count = 0;
  try {
    docker('run', '--rm', '--detach', '--pull=never', '--name', container,
      '--env', 'POSTGRES_USER=console_test', '--env', 'POSTGRES_DB=console_test',
      '--env', 'POSTGRES_PASSWORD=synthetic-test-only',
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql', 'postgres:18');
    const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
    for (let attempt = 0; attempt < 100; attempt++) {
      client = new Client({ host: '127.0.0.1', port, user: 'console_test',
        database: 'console_test', password: 'synthetic-test-only', connectionTimeoutMillis: 1000 });
      try { await client.connect(); break; }
      catch (error) {
        await client.end(); client = undefined;
        if (attempt === 99) throw error;
        await delay(100);
      }
    }
    await client.query(`BEGIN;
      CREATE TEMP TABLE identity_references (id uuid, issuer text, subject_id text, status text, identity_type text) ON COMMIT DROP;
      CREATE TEMP TABLE organizations (id uuid, status text) ON COMMIT DROP;
      CREATE TEMP TABLE organization_memberships (id uuid, identity_reference_id uuid, organization_id uuid, status text, expires_at timestamptz, context_version integer) ON COMMIT DROP;
      CREATE TEMP TABLE membership_roles (membership_id uuid, role_id uuid, expires_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE roles (id uuid, code text, scope text, organization_id uuid, status text) ON COMMIT DROP;
      CREATE TEMP TABLE role_permissions (role_id uuid, permission_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE permissions (id uuid, code text, scope text, status text) ON COMMIT DROP;
      CREATE TEMP TABLE products (id uuid, code text, status text) ON COMMIT DROP;
      CREATE TEMP TABLE organization_products (organization_id uuid, product_id uuid, status text, expires_at timestamptz) ON COMMIT DROP;
      INSERT INTO identity_references VALUES ('${ids.identity}', 'http://identity.test', 'operator', 'active', 'workforce_user');
      INSERT INTO organizations VALUES ('${ids.org}', 'active');
      INSERT INTO organization_memberships VALUES ('${ids.membership}', '${ids.identity}', '${ids.org}', 'active', NULL, 7);
      INSERT INTO membership_roles VALUES ('${ids.membership}', '${ids.role}', NULL);
      INSERT INTO roles VALUES ('${ids.role}', 'platform_super_admin', 'platform', NULL, 'active');
      INSERT INTO role_permissions VALUES ('${ids.role}', '${ids.permission}');
      INSERT INTO permissions VALUES ('${ids.permission}', '*', 'platform', 'active');
      INSERT INTO products VALUES ('${ids.product}', 'console', 'active');
      INSERT INTO organization_products VALUES ('${ids.org}', '${ids.product}', 'enabled', NULL);`);
    const signer = new AccessJwksService(new ConfigService({ access: { issuer: 'http://access.test' } }));
    const service = new ConsoleAuthorizationService({
      query: async (sql, parameters) => (await client.query(sql, parameters)).rows,
    }, signer);
    const { jwtVerify, importJWK } = await import(pathToFileURL(apiRequire.resolve('jose')).href);
    const key = await importJWK(signer.getPublicJwks().keys[0], 'RS256');
    const resolve = () => service.resolve(actor, ids.org, 'console-api');
    const verified = async () => {
      const result = await resolve();
      return (await jwtVerify(result.context_token, key, { issuer: 'http://access.test',
        audience: 'console-api', algorithms: ['RS256'], typ: 'hemia-context+jwt',
        requiredClaims: ['sub', 'iat', 'nbf', 'exp', 'jti'] })).payload;
    };
    const initial = await verified();
    assert.equal(initial.sub, actor.subjectId);
    assert.equal(initial.identity_issuer, actor.issuer);
    assert.equal(initial.organization_id, ids.org);
    assert.equal(initial.membership_id, ids.membership);
    assert.equal(initial.contract_version, 1);
    assert.equal(initial.context_version, 7);
    assert.equal(initial.exp - initial.iat, 300);
    count++;

    const scenarios = [
      ['no organizations', 'DELETE FROM organizations'],
      ['no membership', 'DELETE FROM organization_memberships'],
      ['ordinary role', "UPDATE roles SET code = 'organization_owner'"],
      ['revoked role', 'DELETE FROM membership_roles'],
      ['suspended identity', "UPDATE identity_references SET status = 'suspended'"],
      ['service identity', "UPDATE identity_references SET identity_type = 'service_account'"],
      ['another issuer', "UPDATE identity_references SET issuer = 'http://other.test'"],
      ['another subject', "UPDATE identity_references SET subject_id = 'another-human'"],
      ['suspended organization', "UPDATE organizations SET status = 'suspended'"],
      ['suspended membership', "UPDATE organization_memberships SET status = 'suspended'"],
      ['expired membership', "UPDATE organization_memberships SET expires_at = now() - interval '1 second'"],
      ['expired role', "UPDATE membership_roles SET expires_at = now() - interval '1 second'"],
      ['inactive role', "UPDATE roles SET status = 'inactive'"],
      ['shadow organization role', `UPDATE roles SET scope = 'organization', organization_id = '${ids.org}'`],
      ['missing permission', 'DELETE FROM role_permissions'],
      ['ordinary permission', "UPDATE permissions SET code = 'organization.read'"],
      ['inactive permission', "UPDATE permissions SET status = 'inactive'"],
      ['incorrect permission scope', "UPDATE permissions SET scope = 'organization'"],
      ['disabled product', "UPDATE organization_products SET status = 'disabled'"],
      ['expired product', "UPDATE organization_products SET expires_at = now() - interval '1 second'"],
      ['inactive product catalog', "UPDATE products SET status = 'inactive'"],
      ['another product', "UPDATE products SET code = 'legal'"],
    ];
    for (const [name, mutation] of scenarios) {
      await client.query('SAVEPOINT scenario');
      await client.query(mutation);
      await assert.rejects(resolve, (error) => error.status === 403, name);
      await client.query('ROLLBACK TO SAVEPOINT scenario');
      await client.query('RELEASE SAVEPOINT scenario');
      count++;
    }
    for (const [table, alias] of [
      ['organization_memberships', 'membership'], ['membership_roles', 'role'],
      ['organization_products', 'product'],
    ]) {
      await client.query('SAVEPOINT scenario');
      const expiration = new Date(Date.now() + 60000);
      await client.query(`UPDATE ${table} SET expires_at = $1`, [expiration]);
      assert.equal((await verified()).exp, Math.floor(expiration.getTime() / 1000), alias);
      await client.query('ROLLBACK TO SAVEPOINT scenario');
      await client.query('RELEASE SAVEPOINT scenario');
      count++;
    }
    // Effective wildcard may come from a separate active role in the membership.
    await client.query(`INSERT INTO roles VALUES ('${ids.extraRole}', 'extra_permission', 'organization', '${ids.org}', 'active');
      INSERT INTO membership_roles VALUES ('${ids.membership}', '${ids.extraRole}', NULL);
      UPDATE role_permissions SET role_id = '${ids.extraRole}';`);
    assert.deepEqual((await verified()).permissions, ['*']);
    count++;
    const expiration = new Date(Date.now() + 60000);
    await client.query('UPDATE membership_roles SET expires_at = $1 WHERE role_id = $2', [expiration, ids.extraRole]);
    assert.equal((await verified()).exp, Math.floor(expiration.getTime() / 1000));
    count++;
    await client.query("UPDATE membership_roles SET expires_at = now() - interval '1 second' WHERE role_id = $1", [ids.extraRole]);
    await assert.rejects(resolve, (error) => error.status === 403);
    count++;
    await client.query('ROLLBACK');
    console.log(`Console signed context: ${count} PostgreSQL checks passed`);
  } finally {
    await client?.end();
    // Remove only this invocation's randomly named container.
    try { docker('rm', '--force', container); } catch { /* already removed */ }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
