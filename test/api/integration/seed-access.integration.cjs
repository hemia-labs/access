const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const api = path.resolve(__dirname, '../../../apps/api');
const req = createRequire(path.join(api, 'package.json'));
const { DataSource } = req('typeorm');
const { seedInitialAccess } = require(path.join(api, 'dist/src/database/seeds/001-initial-access'));
const expected = require('./seed-access.expected.json');
const port = Number(process.env.SEED_TEST_DATABASE_PORT);
assert(Number.isInteger(port) && port > 0, 'Use the disposable PostgreSQL runner');
const source = new DataSource({
  type: 'postgres', host: '127.0.0.1', port, username: 'postgres',
  password: 'isolated-test-only', database: 'access_seed_test',
  entities: [path.join(api, 'dist/src/**/*.entity.js')],
  migrations: [path.join(api, 'dist/src/database/migrations/*.js')],
  synchronize: false, migrationsRun: false,
});
const tables = async () => (await source.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).map(row => row.table_name);
const snapshot = async () => {
  const state = {};
  for (const table of await tables()) {
    assert(/^[a-z_]+$/.test(table));
    state[table] = await source.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`);
  }
  return state;
};
const unchanged = async label => {
  const before = await snapshot();
  await seedInitialAccess(source);
  assert.deepEqual(await snapshot(), before, label);
  console.log(`PASS ${label}`);
};
(async () => {
  await source.initialize();
  assert.deepEqual(await tables(), [], 'Requires an empty disposable database');
  await source.runMigrations({ transaction: 'all' });
  process.env.SEED_ADMIN_ISSUER = 'https://identity.seed.test';
  process.env.SEED_ADMIN_SUBJECT_ID = 'synthetic-seed-admin';
  process.env.SEED_ADMIN_EMAIL = 'admin@seed.test';
  await seedInitialAccess(source);
  const initial = await snapshot();
  for (const table of ['products', 'permissions', 'roles']) {
    const catalog = initial[table].map(({ row }) => Object.fromEntries(Object.keys(expected[table][0]).map(key => [key, row[key]]))).sort((a, b) => a.code.localeCompare(b.code));
    assert.deepEqual(catalog, expected[table], `${table} defaults must match the current Access catalog`);
  }
  const matrix = await source.query('SELECT r.code AS role,p.code AS permission FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id ORDER BY r.code,p.code');
  assert.deepEqual(matrix, expected.role_permissions);
  assert.equal(initial.organizations.length, 1);
  assert.equal(initial.identity_references.length, 1);
  assert.equal(initial.organization_memberships.length, 1);
  assert.equal(initial.membership_roles.length, 2);
  assert.equal(initial.organization_products.length, 11);
  assert(!(await tables()).some(name => /policy|policies|wasm|workload/.test(name)));
  assert(!initial.permissions.some(({ row }) => row.code.startsWith('policy.')));
  console.log('PASS fresh seed matches 16 permissions, 10 roles, 55 grants and 11 base products; obsolete policy/WASM data absent');
  await unchanged('second seed preserves every row and timestamp');
  await source.query("UPDATE permissions SET name='Custom permission',description='Custom',status='inactive' WHERE code='membership.read'");
  await source.query("UPDATE roles SET name='Custom role',description='Custom',status='inactive',is_system=false WHERE code='platform_support'");
  await source.query("UPDATE identity_references SET email_snapshot='custom@seed.test',display_name_snapshot='Custom',status='suspended'");
  await source.query("UPDATE organizations SET name='Custom Hemia',legal_name='Custom Legal',status='archived',metadata='{\"custom\":true}'");
  await source.query("UPDATE organization_memberships SET status='revoked',membership_type='member',metadata='{\"custom\":true}',version=7,context_version=9");
  await source.query("UPDATE products SET name='Custom Console',status='disabled',provisioning_mode='manual',metadata='{\"custom\":true}' WHERE code='console'");
  await source.query("UPDATE organization_products SET status='disabled',configuration='{\"custom\":true}',version=7");
  await source.query("UPDATE membership_roles SET expires_at='2000-01-01T00:00:00Z'");
  await source.query("DELETE FROM role_permissions WHERE role_id=(SELECT id FROM roles WHERE code='organization_admin') AND permission_id=(SELECT id FROM permissions WHERE code='membership.invite')");
  await source.query("DELETE FROM membership_roles WHERE role_id=(SELECT id FROM roles WHERE code='platform_super_admin')");
  await source.query("DELETE FROM organization_products WHERE product_id=(SELECT id FROM products WHERE code='docs')");
  process.env.SEED_ADMIN_EMAIL = 'different@seed.test';
  process.env.SEED_ADMIN_SUBJECT_ID = 'different-admin';
  process.env.SEED_ADMIN_ISSUER = 'https://different.seed.test';
  await unchanged('custom data and inactive states stay intact; removed permissions, roles and product accesses stay absent; changed env creates no new admin');
  await source.query('DELETE FROM membership_roles');
  await source.query('DELETE FROM organization_memberships');
  await unchanged('removed bootstrap membership and roles are not recreated');
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (source.isInitialized) await source.destroy();
});
