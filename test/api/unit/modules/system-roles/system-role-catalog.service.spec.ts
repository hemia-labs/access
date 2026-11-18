import { DataSource, EntityManager } from 'typeorm';
import { AccessActor } from '../../../../../apps/api/src/common/auth/access-actor.type';
import { SystemRoleCatalogService } from '../../../../../apps/api/src/modules/system-roles/catalogs/system-role-catalog.service';
import { legalRoleCatalogV2 } from '../../../../../apps/api/src/modules/system-roles/catalogs/legal-role-catalog';
import {
  billingRoleCatalog,
  billingRoleCatalogV2,
} from '../../../../../apps/api/src/modules/system-roles/catalogs/billing-role-catalog';

const actor: AccessActor = {
  identityReferenceId: '10000000-0000-4000-8000-000000000001',
  issuer: 'https://identity.example.test',
  subjectId: '10000000-0000-4000-8000-000000000002',
  identityType: 'workforce_user',
};

function setup(
  administrator = true,
  existing: unknown[] = [],
  productCode = 'legal',
) {
  const rows = (sql: string, parameters?: unknown[]) => {
    if (sql.includes('FROM organization_memberships'))
      return administrator ? [{ id: 'membership' }] : [];
    if (sql.includes('SELECT id FROM products'))
      return [
        { id: parameters?.[0] === 'billing' ? 'billing-product' : 'product' },
      ];
    if (sql.includes('SELECT r.*'))
      return parameters?.[1] === 2 &&
        parameters?.[0] ===
          (productCode === 'billing' ? 'billing-product' : 'product')
        ? existing
        : [];
    if (sql.includes('SELECT id,code,name,status FROM products'))
      return [
        { id: 'product', code: 'legal', name: 'Legal', status: 'active' },
        {
          id: 'billing-product',
          code: 'billing',
          name: 'Billing',
          status: 'active',
        },
      ];
    if (sql.startsWith('INSERT INTO system_roles('))
      return [{ id: 'role-' + String(parameters?.[1]), code: parameters?.[1] }];
    return [];
  };
  const query = jest.fn((sql: string, parameters?: unknown[]) =>
    Promise.resolve(rows(sql, parameters)),
  );
  const manager = { query } as unknown as EntityManager;
  const database = {
    transaction: jest.fn((callback: (m: EntityManager) => Promise<unknown>) =>
      callback(manager),
    ),
  } as unknown as DataSource;
  const audit = { record: jest.fn() };
  const outbox = { record: jest.fn() };
  const service = new SystemRoleCatalogService(
    database,
    audit,
    outbox as never,
  );
  return { service, query, audit, outbox };
}

describe('Legal v2 catalog publication', () => {
  it('publishes seven scoped roles with audit/outbox and grants no assignments', async () => {
    const { service, query, audit, outbox } = setup();
    const result = await service.registerLegalV2(actor, {});
    expect(result).toMatchObject({ catalogVersion: 2, replayed: false });
    expect(result.roles).toHaveLength(7);
    expect(
      result.roles.some((r) => r.code === 'legal.integration_manager'),
    ).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor,
        action: 'system_role_catalog.register',
      }),
    );
    expect(outbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'access.system_role_catalog.registered.v1',
      }),
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO system_role_assignments'),
      ),
    ).toBe(false);
  });

  it.each(['service_account', 'customer_user'] as const)(
    'denies publication by unauthorized %s',
    async (identityType) => {
      const { service, query, audit } = setup(false);
      await expect(
        service.registerLegalV2({ ...actor, identityType }, {}),
      ).rejects.toMatchObject({ status: 403 });
      expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
        false,
      );
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('returns the original catalog on replay without another audit event', async () => {
    const existing = legalRoleCatalogV2.roles.map((role) => ({
      id: 'role-' + role.code,
      code: role.code,
      name: role.name,
      contract_version: 1,
      status: 'active',
      sealed: true,
      scope_profile: 'legal_v1',
      scopes: role.allowed_scopes
        .map(
          (scope: { scope_type: string; consumer_scope_type: string }) =>
            scope.scope_type + ':' + scope.consumer_scope_type,
        )
        .sort(),
    }));
    const { service, query, audit, outbox } = setup(true, existing);
    await expect(service.registerLegalV2(actor, {})).resolves.toMatchObject({
      catalogVersion: 2,
      replayed: true,
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
    const catalogs = await service.list(actor);
    expect(
      catalogs.find((c) => c.productCode === 'legal' && c.version === 2)
        ?.publicationStatus,
    ).toBe('published');
    expect(
      catalogs.find((c) => c.productCode === 'legal' && c.version === 1)
        ?.publicationStatus,
    ).toBe('pending');
    expect(audit.record).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    const replay = await service.registerLegalV2(actor, {});
    expect(replay.roles).toEqual(
      legalRoleCatalogV2.roles.map((role) => ({
        id: 'role-' + role.code,
        code: role.code,
      })),
    );
    expect(
      query.mock.calls.some(
        ([sql]) => sql.includes('FROM products') && sql.includes('FOR UPDATE'),
      ),
    ).toBe(true);
  });

  it('reports a divergent stored catalog without modifying it', async () => {
    const { service, query, audit, outbox } = setup(true, [
      { code: 'legal.integration_manager' },
    ]);
    const catalogs = await service.list(actor);
    expect(
      catalogs.find((c) => c.productCode === 'legal' && c.version === 2)
        ?.publicationStatus,
    ).toBe('conflict');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });
  it('denies listing to machine accounts before reading the catalogs', async () => {
    const { service, query } = setup();
    await expect(
      service.list({ ...actor, identityType: 'service_account' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects a different stored artifact and custom request bodies', async () => {
    const { service } = setup(true, [{ code: 'legal.integration_manager' }]);
    await expect(service.registerLegalV2(actor, {})).rejects.toMatchObject({
      status: 409,
    });
    expect(() => service.registerLegalV2(actor, { roles: [] })).toThrow(
      'body must be empty',
    );
  });
});

describe('Billing v2 catalog publication', () => {
  it('preserves v1 and adds only the global webhook reader in v2', async () => {
    expect(billingRoleCatalog.catalog_version).toBe(1);
    expect(billingRoleCatalog.roles).toHaveLength(6);
    expect(billingRoleCatalogV2.contract_version).toBe(1);
    expect(billingRoleCatalogV2.roles.slice(0, -1)).toEqual(
      billingRoleCatalog.roles,
    );
    expect(billingRoleCatalogV2.roles.at(-1)).toEqual({
      code: 'billing.webhook_viewer',
      name: 'Consulta de webhooks',
      allowed_scopes: ['all_customers'],
    });
    const { service, query, audit, outbox } = setup();
    const catalogs = await service.list(actor);
    expect(
      catalogs
        .filter((catalog) => catalog.productCode === 'billing')
        .map((catalog) => catalog.version),
    ).toEqual([1, 2]);
    const result = await service.registerBillingV2(actor, {});
    expect(result).toMatchObject({ catalogVersion: 2, replayed: false });
    expect(result.roles).toHaveLength(billingRoleCatalogV2.roles.length);
    const inserts = query.mock.calls.filter(([sql]) =>
      sql.startsWith('INSERT INTO system_roles('),
    );
    expect(
      inserts.every(([, values]) => values?.[3] === 1 && values?.[4] === 2),
    ).toBe(true);
    expect(query.mock.calls).toContainEqual([
      expect.stringContaining('INSERT INTO system_role_scopes'),
      [
        'role-billing.webhook_viewer',
        ['all_customers'],
        ['not_applicable'],
        'billing_v1',
      ],
    ]);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO system_role_assignments'),
      ),
    ).toBe(false);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.record).toHaveBeenCalledTimes(1);
  });

  it('replays v2 without altering v1 or creating another audit event', async () => {
    const existing = billingRoleCatalogV2.roles.map((role) => ({
      id: 'role-' + role.code,
      code: role.code,
      name: role.name,
      contract_version: 1,
      status: 'active',
      sealed: true,
      scope_profile: 'billing_v1',
      scopes: role.allowed_scopes
        .map((scope) => `${scope}:not_applicable`)
        .sort(),
    }));
    const { service, query, audit, outbox } = setup(true, existing, 'billing');
    expect(
      (await service.list(actor)).find(
        (catalog) => catalog.productCode === 'billing' && catalog.version === 2,
      )?.publicationStatus,
    ).toBe('published');
    await expect(service.registerBillingV2(actor, {})).resolves.toMatchObject({
      catalogVersion: 2,
      replayed: true,
      roles: existing.map(({ id, code }) => ({ id, code })),
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
    expect((await service.registerBilling(actor, {})).catalogVersion).toBe(1);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.startsWith('INSERT INTO system_roles('),
      ),
    ).toHaveLength(billingRoleCatalog.roles.length);
  });

  it('requires platform administrator authority and rejects custom or divergent artifacts', async () => {
    const unauthorized = setup(false);
    await expect(
      unauthorized.service.registerBillingV2(actor, {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      unauthorized.query.mock.calls.some(([sql]) => sql.startsWith('INSERT')),
    ).toBe(false);
    const { service, query } = setup(
      true,
      [{ code: 'billing.webhook_viewer' }],
      'billing',
    );
    await expect(service.registerBillingV2(actor, {})).rejects.toMatchObject({
      status: 409,
    });
    expect(() => service.registerBillingV2(actor, { roles: [] })).toThrow(
      'body must be empty',
    );
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
  });
});
