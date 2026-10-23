import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { validate } from 'class-validator';
import { OrganizationsService } from '../../../../../apps/api/src/modules/organizations/organizations.service';
import { MembershipsService } from '../../../../../apps/api/src/modules/memberships/memberships.service';
import { InvitationsService } from '../../../../../apps/api/src/modules/invitations/invitations.service';
import { RolesService } from '../../../../../apps/api/src/modules/roles/roles.service';
import { UpdateOrganizationDto } from '../../../../../apps/api/src/modules/organizations/dtos/update-organization.dto';
import { SetOrganizationTypeDto } from '../../../../../apps/api/src/modules/organizations/dtos/set-organization-type.dto';
import {
  protectRoleAssignment,
  requirePlatformAdministrator,
} from '../../../../../apps/api/src/common/auth/platform-administration';

const actor = {
  identityReferenceId: 'actor',
  issuer: 'issuer',
  subjectId: 'subject',
  identityType: 'workforce_user' as const,
};

function fixture(platform = false, type = 'internal') {
  let committed = false;
  const organization = { id: 'org', type, status: 'active', version: 2 };
  const repository = {
    findOne: jest.fn().mockResolvedValue(organization),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => v),
  };
  const manager = {
    query: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('WITH sources')
          ? [
              [
                {
                  id: 'member',
                  organization_id: 'org',
                  identity_reference_id: 'member-identity',
                  issuer: 'issuer',
                  subject_id: 'subject',
                  context_version: 9,
                },
              ],
              1,
            ]
          : platform
            ? [{ id: 'admin-membership' }]
            : [],
      ),
    ),
    getRepository: jest.fn(() => repository),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (m: unknown) => unknown) => {
      const result = await callback(manager);
      committed = true;
      return result;
    }),
  };
  const audit = { record: jest.fn() };
  const outbox = { record: jest.fn() };
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
    key: jest.fn((id: string) => id),
    del: jest.fn(() => {
      expect(committed).toBe(true);
    }),
  };
  const service = new OrganizationsService(
    dataSource as never,
    repository as never,
    audit,
    outbox as never,
    cache as never,
  );
  return {
    service,
    manager,
    repository,
    dataSource,
    audit,
    outbox,
    cache,
    organization,
  };
}

describe('Organization eligibility trust boundary', () => {
  it('rejects classification in the generic DTO and when bypassing HTTP', async () => {
    const dto = Object.assign(new UpdateOrganizationDto(), {
      type: 'internal',
    });
    expect(await validate(dto)).not.toHaveLength(0);
    const f = fixture(true);
    await expect(f.service.update(actor, 'org', dto)).rejects.toMatchObject({
      code: 'ACCESS_FORBIDDEN',
    });
    expect(f.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('requires a valid classification and expected version', async () => {
    expect(
      await validate(
        Object.assign(new SetOrganizationTypeDto(), {
          type: 'anything',
          version: 0,
        }),
      ),
    ).toHaveLength(2);
    const f = fixture(true);
    await expect(
      f.service.setType(actor, 'org', { type: 'customer', version: 1 }),
    ).rejects.toMatchObject({ code: 'ACCESS_CONFLICT' });
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it.each(['internal', 'customer'] as const)(
    'denies non-platform changes to %s',
    async (type) => {
      const f = fixture();
      await expect(
        f.service.setType(actor, 'org', { type, version: 2 }),
      ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
      expect(f.repository.save).not.toHaveBeenCalled();
    },
  );

  it('denies creation of internal organizations without platform authority', async () => {
    const f = fixture();
    await expect(
      f.service.create(actor, {
        code: 'hemia',
        name: 'Hemia',
        slug: 'hemia',
        type: 'internal',
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it.each(['internal', 'customer'] as const)(
    'audits classification %s and invalidates after commit',
    async (type) => {
      const f = fixture(true, type === 'internal' ? 'customer' : 'internal');
      expect(
        (await f.service.setType(actor, 'org', { type, version: 2 })).type,
      ).toBe(type);
      expect(f.audit.record).toHaveBeenCalledWith(
        f.manager,
        expect.objectContaining({
          action: 'organization.classification.change',
        }),
      );
      expect(f.outbox.record).toHaveBeenCalledWith(
        f.manager,
        expect.objectContaining({
          type: 'access.membership.context_invalidated.v1',
          data: expect.objectContaining({ context_version: 9 }) as unknown,
        }),
      );
      expect(f.cache.del).toHaveBeenCalledWith('member-identity');
    },
  );

  it('does not invalidate or save an unchanged classification', async () => {
    const f = fixture(true);
    await f.service.setType(actor, 'org', { type: 'internal', version: 2 });
    expect(f.repository.save).not.toHaveBeenCalled();
    expect(f.cache.del).not.toHaveBeenCalled();
  });

  it('does not invalidate cache when the transaction fails', async () => {
    const f = fixture(true);
    f.audit.record.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      f.service.setType(actor, 'org', { type: 'customer', version: 2 }),
    ).rejects.toThrow('audit unavailable');
    expect(f.cache.del).not.toHaveBeenCalled();
  });

  it.each(['active', 'suspended'] as const)(
    'protects lifecycle transition to %s for internal organizations',
    async (status) => {
      const f = fixture();
      await expect(
        f.service.setStatus(actor, 'org', status),
      ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
      expect(f.repository.save).not.toHaveBeenCalled();
    },
  );

  it('protects internal organization archival', async () => {
    const f = fixture();
    await expect(f.service.archive(actor, 'org')).rejects.toMatchObject({
      code: 'ACCESS_FORBIDDEN',
    });
  });

  it('protects internal membership creation before creating an identity', async () => {
    const f = fixture();
    const identities = { findOrCreateFromClaims: jest.fn() };
    const service = new MembershipsService(
      f.dataSource as never,
      {} as never,
      {} as never,
      identities as never,
      f.audit,
      f.outbox as never,
      f.cache as never,
    );
    await expect(
      service.create(actor, 'org', {} as never),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(identities.findOrCreateFromClaims).not.toHaveBeenCalled();
  });

  it('protects internal invitations before issuing them', async () => {
    const f = fixture();
    const service = new InvitationsService(
      f.dataSource as never,
      {} as never,
      {} as never,
      f.audit,
      f.outbox as never,
      f.cache as never,
    );
    await expect(
      service.create(actor, 'org', { email: 'user@example.com' }),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it('rejects platform roles in customer invitations before saving', async () => {
    const f = fixture(false, 'customer');
    f.repository.findOne
      .mockResolvedValueOnce(f.organization)
      .mockResolvedValueOnce({ scope: 'platform', status: 'active' });
    const service = new InvitationsService(
      f.dataSource as never,
      {} as never,
      {} as never,
      f.audit,
      f.outbox as never,
      f.cache as never,
    );
    await expect(
      service.create(actor, 'org', {
        email: 'user@example.com',
        role_codes: ['platform_super_admin'],
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it('rechecks the inviter authority when an internal invitation is accepted', async () => {
    const f = fixture();
    const invitation = {
      id: 'invitation',
      organizationId: 'org',
      createdByIdentityId: 'former-admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000),
      tokenHash: createHash('sha256').update('secret').digest('hex'),
    };
    const invitations = { findOneBy: jest.fn().mockResolvedValue(invitation) };
    Object.assign(f.repository, invitations);
    const identities = { findOrCreateFromClaims: jest.fn() };
    const service = new InvitationsService(
      f.dataSource as never,
      invitations as never,
      identities as never,
      f.audit,
      f.outbox as never,
      f.cache as never,
    );
    await expect(
      service.accept(actor, { token: 'secret' }),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(f.manager.query).toHaveBeenCalledWith(expect.any(String), [
      'former-admin',
    ]);
    expect(identities.findOrCreateFromClaims).not.toHaveBeenCalled();
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it.each(['active', 'suspended', 'revoked'] as const)(
    'protects internal membership transition to %s',
    async (status) => {
      const f = fixture();
      const service = new MembershipsService(
        f.dataSource as never,
        {} as never,
        {} as never,
        {} as never,
        f.audit,
        f.outbox as never,
        f.cache as never,
      );
      await expect(
        service.setStatus(actor, 'org', 'member', status),
      ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
      expect(f.repository.save).not.toHaveBeenCalled();
    },
  );

  it('denies assigning a platform role or a role of another organization', async () => {
    const f = fixture();
    for (const role of [
      { scope: 'platform', organizationId: null },
      { scope: 'organization', organizationId: 'other' },
    ]) {
      await expect(
        protectRoleAssignment(
          f.manager as unknown as EntityManager,
          actor,
          'org',
          { ...role, status: 'active' } as never,
        ),
      ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    }
  });

  it('does not accept service scopes as platform administrator authority', async () => {
    const f = fixture(true);
    await expect(
      requirePlatformAdministrator(f.manager as unknown as EntityManager, {
        ...actor,
        identityType: 'service_account',
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_FORBIDDEN' });
    expect(f.manager.query).not.toHaveBeenCalled();
  });

  it('rejects creation of a platform role through an organizational endpoint', () => {
    const f = fixture();
    const service = new RolesService(
      f.dataSource as never,
      f.repository as never,
      {} as never,
      f.audit,
      f.outbox as never,
      f.cache as never,
    );
    expect(() =>
      service.createOrganizationRole('org', {
        code: 'admin',
        name: 'Admin',
        scope: 'platform',
      }),
    ).toThrow();
    expect(f.repository.save).not.toHaveBeenCalled();
  });
});
