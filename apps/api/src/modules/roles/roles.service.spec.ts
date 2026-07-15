import { HttpStatus } from '@nestjs/common';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  const actor = {
    identityReferenceId: 'identity-id',
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType: 'workforce_user' as const,
  };

  it('does not delete system roles', async () => {
    const service = new RolesService(
      {} as never,
      { findOneBy: jest.fn().mockResolvedValue({ id: 'role-id', isSystem: true }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { key: jest.fn(), del: jest.fn() } as never,
    );

    await expect(
      service.removeOrganizationRole('org-id', 'role-id'),
    ).rejects.toMatchObject({
      code: 'ACCESS_CONFLICT',
      status: HttpStatus.CONFLICT,
    });
  });

  it('increments context_version when role is assigned', async () => {
    const membership = {
      id: 'membership-id',
      organizationId: 'org-id',
      version: 1,
      contextVersion: 1,
      identityReferenceId: 'member-identity-id',
    };
    const repositories: Record<string, unknown> = {
      Membership: {
        findOneBy: jest.fn().mockResolvedValue(membership),
        save: jest.fn(async (value) => value),
      },
      Role: {
        findOne: jest.fn().mockResolvedValue({ id: 'role-id', code: 'engineering' }),
      },
      MembershipRole: {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
        findOneByOrFail: jest.fn(async () => ({ membershipId: 'membership-id', roleId: 'role-id' })),
      },
    };
    const service = new RolesService(
      {
        transaction: (callback: (manager: unknown) => unknown) =>
          callback({
            getRepository: (entity: { name: string }) => repositories[entity.name],
          }),
      } as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      { record: jest.fn() } as never,
      { key: jest.fn(), del: jest.fn() } as never,
    );

    await service.assignMembershipRole(actor, 'org-id', 'membership-id', {
      roleCode: 'engineering',
    });

    expect(membership.contextVersion).toBe(2);
  });
});
