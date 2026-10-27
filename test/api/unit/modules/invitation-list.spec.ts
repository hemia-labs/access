import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvitationsController } from '../../../../apps/api/src/modules/invitations/invitations.controller';
import { ACCESS_PERMISSION_KEY } from '../../../../apps/api/src/common/auth/access-permission.decorator';
import { InvitationsService } from '../../../../apps/api/src/modules/invitations/invitations.service';
import { ListInvitationsQueryDto } from '../../../../apps/api/src/modules/invitations/dtos/invitation.dto';

const serviceActor = {
  identityReferenceId: 'service',
  issuer: 'https://id.test',
  subjectId: 'service',
  identityType: 'service_account' as const,
  scopes: ['membership.read'],
};

describe('Invitation listing', () => {
  it('does not require platform-only authorization before filtering the list by actor', () => {
    const handler = Object.getOwnPropertyDescriptor(
      InvitationsController.prototype,
      'listAll',
    )?.value as object;
    expect(Reflect.getMetadata(ACCESS_PERMISSION_KEY, handler)).toBeUndefined();
  });
  it('paginates by organization, includes its name and excludes tokens and unrelated organization fields', async () => {
    const repository = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'invitation',
            organizationId: 'organization',
            tokenHash: 'private-hash',
            emailNormalized: 'person@example.test',
            status: 'pending',
            expiresAt: new Date('2020-01-01'),
            organization: { name: 'Hemia', metadata: { private: true } },
          },
        ],
        26,
      ]),
    };
    const service = new InvitationsService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.listAll(
      {
        limit: 25,
        offset: 25,
        organization_id: 'organization',
      },
      serviceActor,
    );
    expect(repository.findAndCount).toHaveBeenCalledWith({
      where: { organizationId: 'organization' },
      relations: { organization: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 25,
      skip: 25,
    });
    expect(result).toMatchObject({
      total: 26,
      limit: 25,
      offset: 25,
      items: [{ organizationName: 'Hemia', status: 'expired' }],
    });
    expect(result.items[0]).not.toHaveProperty('tokenHash');
    expect(result.items[0]).not.toHaveProperty('organization');
  });
  it('keeps accepted invitations accepted even after their expiry date', async () => {
    const repository = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'invitation',
            status: 'accepted',
            expiresAt: new Date('2020-01-01'),
          },
        ],
        1,
      ]),
    };
    const service = new InvitationsService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(
      (await service.listAll(new ListInvitationsQueryDto(), serviceActor))
        .items[0].status,
    ).toBe('accepted');
    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 25, skip: 0 }),
    );
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { offset: -1 },
    { offset: 0.5 },
    { organization_id: 'not-a-uuid' },
  ])('rejects invalid pagination or organization %p', async (query) => {
    expect(
      (await validate(plainToInstance(ListInvitationsQueryDto, query))).length,
    ).toBeGreaterThan(0);
  });
});
