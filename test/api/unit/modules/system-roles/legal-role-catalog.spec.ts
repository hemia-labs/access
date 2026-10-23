import {
  legalRoleCatalog,
  legalRoleCatalogV2,
} from '../../../../../apps/api/src/modules/system-roles/catalogs/legal-role-catalog';
test('publishes integrations as a new immutable catalog without changing v1 roles or assigning anyone', () => {
  expect(legalRoleCatalog.catalog_version).toBe(1);
  expect(legalRoleCatalog.roles).toHaveLength(6);
  expect(legalRoleCatalogV2.catalog_version).toBe(2);
  expect(legalRoleCatalogV2.roles).toHaveLength(7);
  expect(legalRoleCatalogV2.roles.slice(0, 6)).toEqual(legalRoleCatalog.roles);
  const integration = legalRoleCatalogV2.roles.find(
    (r) => r.code === 'legal.integration_manager',
  );
  expect(integration?.allowed_scopes).toEqual([
    { scope_type: 'issuers', consumer_scope_type: 'not_applicable' },
    { scope_type: 'applications', consumer_scope_type: 'not_applicable' },
  ]);
});
