import { HttpStatus } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  const actor = {
    identityReferenceId: 'identity-id',
    issuer: 'http://localhost:4000',
    subjectId: 'user-id',
    identityType: 'workforce_user' as const,
  };

  it('does not activate membership when organization is not active', async () => {
    const membership = membershipRecord();
    const service = serviceWithTransaction({
      Membership: { findOneBy: jest.fn().mockResolvedValue(membership), save: jest.fn() },
      Organization: { findOneBy: jest.fn().mockResolvedValue({ status: 'suspended' }) },
    });

    await expect(
      service.setStatus(actor, 'org-id', 'membership-id', 'active'),
    ).rejects.toMatchObject({
      code: 'ACCESS_CONFLICT',
      status: HttpStatus.CONFLICT,
    });
  });

  it('increments context_version when membership is suspended', async () => {
    const membership = membershipRecord();
    const membershipRepository = {
      findOneBy: jest.fn().mockResolvedValue(membership),
      save: jest.fn(async (value) => value),
    };
    const service = serviceWithTransaction({ Membership: membershipRepository });

    const result = await service.setStatus(
      actor,
      'org-id',
      'membership-id',
      'suspended',
    );

    expect(result.contextVersion).toBe(2);
    expect(result.status).toBe('suspended');
  });

  const membershipRecord = () => ({
    id: 'membership-id',
    organizationId: 'org-id',
    status: 'pending',
    version: 1,
    contextVersion: 1,
    updatedByIdentityId: 'identity-id',
    identityReferenceId: 'member-identity-id',
  });

  const serviceWithTransaction = (repositories: Record<string, unknown>) =>
    new MembershipsService(
      {
        transaction: (callback: (manager: unknown) => unknown) =>
          callback({
            getRepository: (entity: { name: string }) =>
              repositories[entity.name] ?? { save: jest.fn(), findOneBy: jest.fn() },
          }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      { record: jest.fn() } as never,
      { key: jest.fn(), del: jest.fn() } as never,
    );
});
