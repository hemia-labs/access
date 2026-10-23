import { DataSource, EntityManager } from 'typeorm';
import { AccessActor } from '../../../../../apps/api/src/common/auth/access-actor.type';
import { AuditService } from '../../../../../apps/api/src/modules/audit/audit.service';
import { OutboxService } from '../../../../../apps/api/src/modules/outbox/outbox.service';
import { AccessContextCacheService } from '../../../../../apps/api/src/modules/access-context/cache/access-context-cache.service';
import {
  covers,
  SystemRoleHistoryService,
} from '../../../../../apps/api/src/modules/system-roles/history/system-role-history.service';

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const actor: AccessActor = {
  identityReferenceId: id(1),
  issuer: 'https://identity.test',
  subjectId: 'admin',
  identityType: 'workforce_user',
};
const request = {
  expectedVersion: 1,
  idempotencyKey: id(7),
  roleId: id(4),
  scopeType: 'organizations',
  organizationIds: [id(6)],
  validFrom: '2026-01-01T00:00:00Z',
  expiresAt: null,
};
function fixture(kind = 'assignment') {
  const initial = {
    id: id(5),
    membership_id: id(2),
    grantee_membership_id: id(2),
    role_id: id(4),
    scope_type: 'organizations',
    consumer_scope_type: 'not_applicable',
    valid_from: new Date(request.validFrom),
    expires_at: null,
    status: 'active',
    version: 1,
    sealed: true,
    delegation_id: null,
    replaces_assignment_id: null,
    replaces_delegation_id: null,
    created_by_identity_id: id(1),
    revoked_by_identity_id: null as string | null,
    recipient_organization_id: id(3),
    can_grant: true,
    can_revoke: true,
  };
  type Grant = typeof initial;
  let state = {
    old: initial,
    created: null as Grant | null,
    targets: [] as string[],
    version: 1,
  };
  let committed = false;
  const options = {
    platform: true,
    canGrant: true,
    canRevoke: true,
    authorityActive: true,
    eligible: true,
    self: false,
  };
  const query = jest.fn((sql: string, args: unknown[] = []): unknown[] => {
    if (
      sql.startsWith('SELECT * FROM system_role_') &&
      sql.includes('FOR UPDATE')
    )
      return [{ ...state.old }];
    if (sql.includes('idempotency_key = $2'))
      return state.created ? [{ ...state.created }] : [];
    if (sql.startsWith('SELECT * FROM system_role_delegations'))
      return [
        {
          ...initial,
          id: id(9),
          grantee_membership_id: id(1),
          can_grant: options.canGrant,
          can_revoke: options.canRevoke,
          status: options.authorityActive ? 'active' : 'revoked',
        },
      ];
    if (sql.startsWith('SELECT m.*'))
      return [
        {
          id: args[0],
          organization_id: id(3),
          identity_reference_id:
            args[0] === id(1) || options.self ? id(1) : id(8),
          issuer: actor.issuer,
          subject_id: 'ana',
          status: 'active',
          expires_at: null,
          organization_status: 'active',
          organization_type: options.eligible ? 'internal' : 'customer',
          identity_status: 'active',
          identity_type: 'workforce_user',
        },
      ];
    if (sql.startsWith('SELECT m.id'))
      return options.platform ? [{ id: id(1) }] : [];
    if (sql.startsWith('SELECT target_type'))
      return (
        args[0] === state.created?.id
          ? state.targets
          : ['organization:' + id(6)]
      ).map((target) => ({ target }));
    if (
      sql.startsWith('SELECT r.id') ||
      sql.startsWith('SELECT id FROM organizations')
    )
      return [{ id: id(6) }];
    if (sql.includes('WITH retained'))
      return [{ product_code: 'billing', assignments: 1, targets: 1 }];
    if (sql.startsWith('SELECT c.id')) return [];
    if (sql.startsWith('SELECT DISTINCT'))
      return [{ identity_reference_id: id(8) }];
    if (sql.startsWith('SELECT $1::uuid')) return [{ id: id(2) }];
    if (sql.startsWith(`UPDATE system_role_${kind}s`)) {
      state.old = {
        ...state.old,
        status: 'revoked',
        version: 2,
        revoked_by_identity_id: id(1),
      };
      return [[{ ...state.old }], 1];
    }
    if (sql.startsWith(`INSERT INTO system_role_${kind}s`)) {
      state.created = {
        ...initial,
        id: args[0] as string,
        role_id: args[2] as string,
        scope_type: args[3] as string,
        valid_from: new Date(args[4] as string),
        expires_at: args[5] as null,
        [`replaces_${kind}_id`]: args[8],
        delegation_id: kind === 'assignment' ? (args[10] as null) : null,
      };
      return [{ ...state.created }];
    }
    if (sql.startsWith(`INSERT INTO system_role_${kind}_targets`)) {
      state.targets = args[3] as string[];
      return [];
    }
    if (sql.startsWith('UPDATE organization_memberships')) {
      state.version++;
      return [
        [
          {
            id: id(2),
            organization_id: id(3),
            identity_reference_id: id(8),
            issuer: actor.issuer,
            subject_id: 'ana',
            context_version: state.version,
          },
        ],
        1,
      ];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const manager = { query } as unknown as EntityManager;
  const transaction = jest.fn(
    async (
      _isolation: string,
      operation: (m: EntityManager) => Promise<unknown>,
    ) => {
      const before = structuredClone(state);
      committed = false;
      try {
        const value = await operation(manager);
        committed = true;
        return value;
      } catch (error) {
        state = before;
        throw error;
      }
    },
  );
  const audit = {
    record: jest
      .fn<Promise<undefined>, Parameters<AuditService['record']>>()
      .mockResolvedValue(undefined),
  };
  const outbox = {
    record: jest
      .fn<Promise<undefined>, Parameters<OutboxService['record']>>()
      .mockResolvedValue(undefined),
  };
  Object.assign(outbox, {
    recordMany: async (
      ...[manager, inputs]: Parameters<
        import('../../../../../apps/api/src/modules/outbox/outbox.service').OutboxService['recordMany']
      >
    ) => {
      for (const input of inputs) await outbox.record(manager, input);
    },
  });
  const cache = {
    key: (value: string) => value,
    del: jest.fn(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    }),
  };
  const service = new SystemRoleHistoryService(
    { transaction } as unknown as DataSource,
    audit as unknown as AuditService,
    outbox as unknown as OutboxService,
    cache as unknown as AccessContextCacheService,
  );
  return {
    service,
    options,
    query,
    transaction,
    audit,
    outbox,
    cache,
    state: () => state,
  };
}

describe('System role history transaction orchestration', () => {
  it('revokes A, creates B and records invalidation/audit on the same manager before cache eviction', async () => {
    const f = fixture();
    const result = await f.service.replaceAssignment(actor, id(5), request);
    expect(result).toMatchObject({ version: 1, replayed: false });
    expect(f.state().old).toMatchObject({ status: 'revoked', version: 2 });
    expect(f.state().created).toMatchObject({ replaces_assignment_id: id(5) });
    expect(f.state().version).toBe(2);
    expect(f.transaction.mock.calls[0][0]).toBe('SERIALIZABLE');
    expect(f.audit.record.mock.calls[0][0]).toBe(
      f.outbox.record.mock.calls[0][0],
    );
    expect(f.audit.record.mock.calls[0][1].before?.targets).toEqual([
      'organization:' + id(6),
    ]);
    expect(f.outbox.record.mock.calls[0][1]).toMatchObject({
      type: 'access.membership.context_invalidated.v1',
      data: { context_version: 2 },
    });
    expect(
      f.query.mock.calls.some(([sql]) =>
        /DELETE|UPDATE system_role_assignment_targets/.test(sql),
      ),
    ).toBe(false);
    expect(f.cache.del).toHaveBeenCalledWith(id(8));
  });
  it('replays the same replacement without repeating writes and rejects a reused key with other contents', async () => {
    const f = fixture();
    const first = await f.service.replaceAssignment(actor, id(5), request);
    expect(await f.service.replaceAssignment(actor, id(5), request)).toEqual({
      ...first,
      replayed: true,
    });
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.outbox.record).toHaveBeenCalledTimes(1);
    await expect(
      f.service.replaceAssignment(actor, id(5), {
        ...request,
        organizationIds: [id(3)],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(['audit', 'outbox'] as const)(
    'propagates %s failures to roll back the transaction without touching cache',
    async (dependency) => {
      const f = fixture();
      f[dependency].record.mockRejectedValueOnce(new Error('write failed'));
      await expect(
        f.service.replaceAssignment(actor, id(5), request),
      ).rejects.toThrow('write failed');
      expect(f.state()).toMatchObject({
        old: { status: 'active', version: 1 },
        created: null,
        version: 1,
      });
      expect(f.cache.del).not.toHaveBeenCalled();
    },
  );
  it('rejects stale versions and invalid input before writing', async () => {
    const f = fixture();
    await expect(
      f.service.replaceAssignment(actor, id(5), {
        ...request,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(() =>
      f.service.replaceAssignment(actor, id(5), { ...request, sealed: true }),
    ).toThrow();
    expect(() =>
      f.service.replaceAssignment(actor, id(5), {
        ...request,
        organizationIds: [id(6), id(6)],
      }),
    ).toThrow();
    expect(f.audit.record).not.toHaveBeenCalled();
  });
  it('does not derive platform authority from organizational administration', async () => {
    const f = fixture();
    f.options.platform = false;
    await expect(
      f.service.replaceAssignment(actor, id(5), request),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.outbox.record).not.toHaveBeenCalled();
  });
  it.each(['self', 'eligible'] as const)(
    'rejects self assignment and ineligible recipients: %s',
    async (flag) => {
      const f = fixture();
      f.options[flag] = flag === 'self';
      await expect(
        f.service.replaceAssignment(actor, id(5), request),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it('requires both delegated capabilities and contained targets for replacement', async () => {
    const f = fixture();
    f.options.platform = false;
    const delegated = { ...request, authorityDelegationId: id(9) };
    f.options.canGrant = false;
    await expect(
      f.service.replaceAssignment(actor, id(5), delegated),
    ).rejects.toMatchObject({ status: 403 });
    f.options.canGrant = true;
    f.options.canRevoke = false;
    await expect(
      f.service.replaceAssignment(actor, id(5), delegated),
    ).rejects.toMatchObject({ status: 403 });
    f.options.canRevoke = true;
    await expect(
      f.service.replaceAssignment(actor, id(5), {
        ...delegated,
        organizationIds: [id(3)],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.replaceAssignment(actor, id(5), delegated),
    ).resolves.toMatchObject({ replayed: false });
    expect(f.state().created?.delegation_id).toBe(id(9));
  });
  it('rejects a revoked authority and delegated administration of delegations', async () => {
    const f = fixture();
    f.options.authorityActive = false;
    await expect(
      f.service.revokeAssignment(actor, id(5), {
        expectedVersion: 1,
        authorityDelegationId: id(9),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.revokeDelegation(actor, id(5), {
        expectedVersion: 1,
        authorityDelegationId: id(9),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('replaces a delegation without moving its descendant assignments', async () => {
    const f = fixture('delegation');
    await f.service.replaceDelegation(actor, id(5), {
      ...request,
      recipientOrganizationId: id(3),
      canGrant: true,
      canRevoke: true,
    });
    expect(f.state().created).toMatchObject({ replaces_delegation_id: id(5) });
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.startsWith('UPDATE system_role_assignments'),
      ),
    ).toBe(false);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes('SELECT membership_id AS id FROM system_role_assignments'),
      ),
    ).toBe(true);
    expect(f.outbox.record).toHaveBeenCalled();
  });
  it('replays revocation and retries failed post-commit cache eviction without repeating the transaction writes', async () => {
    const f = fixture();
    f.cache.del.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(
      f.service.revokeAssignment(actor, id(5), { expectedVersion: 1 }),
    ).rejects.toThrow('redis unavailable');
    expect(f.state().old.status).toBe('revoked');
    await expect(
      f.service.revokeAssignment(actor, id(5), { expectedVersion: 1 }),
    ).resolves.toEqual({ id: id(5), version: 2, replayed: true });
    expect(f.state().created).toBeNull();
    expect(f.outbox.record).toHaveBeenCalledTimes(1);
  });
  it('does not conflate customer scope with catalog authority', () => {
    expect(covers('all_customers', [], 'catalog_global', [])).toBe(false);
    expect(covers('organizations', [id(6)], 'all_customers', [])).toBe(false);
    expect(covers('organizations', [id(6)], 'organizations', [id(6)])).toBe(
      true,
    );
  });
});
