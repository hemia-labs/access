import { AccessContextService } from './access-context.service';

describe('AccessContextService', () => {
  const actor = {
    identityReferenceId: 'identity-id',
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType: 'workforce_user' as const,
  };

  const query = (rows: unknown[]) => {
    const builder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
    return builder;
  };

  const service = (rows: unknown[]) => {
    const builder = query(rows);
    return {
      builder,
      service: new AccessContextService(
        { createQueryBuilder: jest.fn(() => builder) } as never,
        {
          key: (id: string) => `access:context:${id}`,
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn(),
          del: jest.fn(),
        } as never,
        {
          signContextToken: jest.fn().mockResolvedValue('signed-token'),
        } as never,
        {
          get: jest.fn((_key: string, fallback: string) => fallback),
        } as never,
      ),
    };
  };

  it('combines roles and permissions without duplicates', async () => {
    const { service: accessContext } = service([
      row('engineering', 'organization.read'),
      row('engineering', 'organization.read'),
      row('organization_member', 'membership.read'),
    ]);

    const context = await accessContext.context(actor);

    expect(context.organizations[0]).toMatchObject({
      context_version: 3,
      roles: ['engineering', 'organization_member'],
      permissions: ['organization.read', 'membership.read'],
    });
  });

  it('checks only effective permissions', async () => {
    const { service: accessContext } = service([row('engineering', 'organization.read')]);

    await expect(
      accessContext.check(actor, '11111111-1111-4111-8111-111111111111', 'organization.read'),
    ).resolves.toEqual({ allowed: true });
    await expect(
      accessContext.check(actor, '11111111-1111-4111-8111-111111111111', 'role.assign'),
    ).resolves.toEqual({ allowed: false });
  });

  it('allows wildcard permissions', async () => {
    const { service: accessContext } = service([row('platform_super_admin', '*')]);

    await expect(
      accessContext.check(actor, '11111111-1111-4111-8111-111111111111', 'role.assign'),
    ).resolves.toEqual({ allowed: true });
  });

  it('allows prefix wildcard permissions', async () => {
    const { service: accessContext } = service([row('organization_admin', 'membership.*')]);

    await expect(
      accessContext.check(actor, '11111111-1111-4111-8111-111111111111', 'membership.invite'),
    ).resolves.toEqual({ allowed: true });
    await expect(
      accessContext.check(actor, '11111111-1111-4111-8111-111111111111', 'role.assign'),
    ).resolves.toEqual({ allowed: false });
  });

  it('uses active membership, active organization, active catalog filters', async () => {
    const { service: accessContext, builder } = service([]);

    await accessContext.context(actor);

    expect(builder.innerJoin).toHaveBeenCalledWith(
      'organizations',
      'organization',
      expect.stringContaining('organization.status = :active'),
    );
    expect(builder.andWhere).toHaveBeenCalledWith('membership.status = :active', {
      active: 'active',
    });
    expect(builder.leftJoin).toHaveBeenCalledWith(
      expect.any(Function),
      'membership_role',
      expect.stringContaining('membership_role.expires_at > now()'),
    );
  });

  it('returns a context token on resolve', async () => {
    const { service: accessContext } = service([row('engineering', 'organization.read')]);

    await expect(
      accessContext.resolve(actor, '11111111-1111-4111-8111-111111111111'),
    ).resolves.toMatchObject({
      authorized: true,
      context_token: 'signed-token',
      context_version: 3,
    });
  });
});

function row(role_code: string, permission_code: string) {
  return {
    organization_id: '11111111-1111-4111-8111-111111111111',
    organization_code: 'hemia',
    organization_name: 'Hemia',
    organization_status: 'active',
    membership_id: '22222222-2222-4222-8222-222222222222',
    membership_status: 'active',
    context_version: 3,
    role_code,
    permission_code,
  };
}
