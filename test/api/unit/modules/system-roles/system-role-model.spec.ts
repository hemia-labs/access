import { DataSource } from 'typeorm';
import * as path from 'path';

/** Metadata-only check: never connects to PostgreSQL or executes migrations. */
class OfflineDataSource extends DataSource {
  buildForTest() {
    return this.buildMetadatas();
  }
}

describe('System role persistence model', () => {
  const source = new OfflineDataSource({
    type: 'postgres',
    entities: [
      path.resolve(
        __dirname,
        '../../../../../apps/api/src/modules/**/*.entity.ts',
      ),
    ],
    synchronize: false,
    migrationsRun: false,
  });

  beforeAll(async () => source.buildForTest());

  it('links assignments to membership, delegation and allowed role scope', () => {
    const entity = source.getMetadata('system_role_assignments');
    expect(
      entity.foreignKeys.map((key) => key.referencedEntityMetadata.tableName),
    ).toEqual(
      expect.arrayContaining([
        'organization_memberships',
        'system_role_delegations',
        'system_role_scopes',
      ]),
    );
    expect(
      entity.uniques.some(
        (key) =>
          key.columns.map((column) => column.propertyName).join(',') ===
          'createdByIdentityId,idempotencyKey',
      ),
    ).toBe(true);
    expect(
      entity.checks.some((check) =>
        check.expression.includes('expires_at > valid_from'),
      ),
    ).toBe(true);
    expect(
      entity.checks.some((check) =>
        check.expression.includes('revoked_by_identity_id IS NOT NULL'),
      ),
    ).toBe(true);
  });

  it.each(['assignment', 'delegation'])(
    'preserves typed %s targets and both parent dimensions',
    (kind) => {
      const entity = source.getMetadata(`system_role_${kind}_targets`);
      const parent = entity.foreignKeys.find(
        (key) =>
          key.referencedEntityMetadata.tableName === `system_role_${kind}s`,
      );
      expect(parent?.columns.map((column) => column.databaseName)).toEqual([
        `${kind}_id`,
        'scope_type',
        'consumer_scope_type',
      ]);
      expect(
        entity.primaryColumns.map((column) => column.databaseName),
      ).toEqual([`${kind}_id`, 'target_type', 'target_id']);
      expect(
        entity.checks.some((check) =>
          check.expression.includes(
            "target_type = 'organization' AND organization_id IS NOT NULL",
          ),
        ),
      ).toBe(true);
      expect(
        entity.findColumnWithDatabaseName('target_id')?.generatedType,
      ).toBe('STORED');
      expect(entity.findColumnWithDatabaseName('target_id')?.asExpression).toBe(
        'COALESCE(organization_id, resource_id)',
      );
      expect(
        entity.findColumnWithDatabaseName('organization_id')?.isNullable,
      ).toBe(true);
      expect(
        entity.foreignKeys.some(
          (key) => key.referencedEntityMetadata.tableName === 'organizations',
        ),
      ).toBe(true);
    },
  );

  it.each(['assignment', 'delegation'])(
    'preserves a unique predecessor and idempotency for each %s',
    (kind) => {
      const entity = source.getMetadata(`system_role_${kind}s`);
      const predecessor = `replaces_${kind}_id`;
      expect(
        entity.foreignKeys.some(
          (key) =>
            key.referencedEntityMetadata === entity &&
            key.columns[0].databaseName === predecessor,
        ),
      ).toBe(true);
      expect(
        entity.uniques.some(
          (key) =>
            key.columns.length === 1 &&
            key.columns[0].databaseName === predecessor,
        ),
      ).toBe(true);
      expect(
        entity.checks.some((check) =>
          check.expression.includes(`${predecessor} <> id`),
        ),
      ).toBe(true);
      expect(
        entity.uniques.some(
          (key) =>
            key.columns.map((column) => column.databaseName).join(',') ===
            'created_by_identity_id,idempotency_key',
        ),
      ).toBe(true);
    },
  );

  it.each([
    'system_roles',
    'system_role_assignments',
    'system_role_delegations',
  ])('starts %s open for transaction-scoped creation', (table) => {
    const column = source
      .getMetadata(table)
      .findColumnWithDatabaseName('sealed');
    expect(column?.default).toBe(false);
    expect(column?.isNullable).toBe(false);
  });

  it('binds scope profiles and both dimensions through composite foreign keys', () => {
    const scopes = source.getMetadata('system_role_scopes');
    expect(scopes.primaryColumns.map((column) => column.databaseName)).toEqual([
      'role_id',
      'scope_type',
      'consumer_scope_type',
    ]);
    expect(
      scopes.foreignKeys[0].columns.map((column) => column.databaseName),
    ).toEqual(['role_id', 'scope_profile']);
    const roles = source.getMetadata('system_roles');
    expect(roles.findColumnWithDatabaseName('scope_profile')?.isNullable).toBe(
      false,
    );
    expect(
      roles.findColumnWithDatabaseName('scope_profile')?.default,
    ).toBeUndefined();
    for (const kind of ['assignment', 'delegation']) {
      const parent = source.getMetadata(`system_role_${kind}s`);
      expect(
        parent.foreignKeys
          .find((key) => key.referencedEntityMetadata === scopes)
          ?.columns.map((column) => column.databaseName),
      ).toEqual(['role_id', 'scope_type', 'consumer_scope_type']);
      expect(
        parent.findColumnWithDatabaseName('consumer_scope_type')?.default,
      ).toBeUndefined();
    }
  });

  it('versions roles per product and requires an explicit administrative capability', () => {
    const role = source.getMetadata('system_roles');
    expect(
      role.uniques.some(
        (key) =>
          key.columns.map((column) => column.propertyName).join(',') ===
          'productId,code,catalogVersion',
      ),
    ).toBe(true);
    const delegation = source.getMetadata('system_role_delegations');
    expect(
      delegation.checks.some(
        (check) => check.expression === 'can_grant OR can_revoke',
      ),
    ).toBe(true);
  });
});
