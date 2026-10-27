import { In } from 'typeorm';
import {
  readableOrganizationIds,
  requireReadableOrganization,
} from '../../../../apps/api/src/common/auth/readable-organizations';
import { InvitationsService } from '../../../../apps/api/src/modules/invitations/invitations.service';
import { OrganizationsService } from '../../../../apps/api/src/modules/organizations/organizations.service';

const actor = {
  identityReferenceId: 'person',
  issuer: 'http://identity.test',
  subjectId: 'person',
  identityType: 'workforce_user' as const,
};
const row = (
  permission: string,
  organization = 'own',
  scope = 'organization',
) => ({
  organization_id: organization,
  permission_code: permission,
  role_scope: scope,
});
const source = (rows: ReturnType<typeof row>[]) => ({
  query: jest.fn().mockResolvedValue(rows),
});

describe('Caller-scoped organization reads', () => {
  it('uses active, unexpired memberships and role grants, scoped by the current identity', async () => {
    const ds = source([
      row('organization.*'),
      row('membership.read'),
      row('organization.read', 'other'),
    ]);
    expect(
      await readableOrganizationIds(ds as never, actor, 'organization.read'),
    ).toEqual(['own', 'other']);
    expect(ds.query).toHaveBeenCalledWith(
      expect.stringContaining('membership.expires_at > now()'),
      ['person'],
    );
    expect(ds.query).toHaveBeenCalledWith(
      expect.stringContaining('membership_role.expires_at > now()'),
      ['person'],
    );
    expect(ds.query).toHaveBeenCalledWith(
      expect.stringContaining("organization.status = 'active'"),
      ['person'],
    );
  });
  it('an organization wildcard never becomes global platform authority', async () => {
    const ds = source([row('*')]);
    expect(
      await readableOrganizationIds(ds as never, actor, 'membership.read'),
    ).toEqual(['own']);
    expect(() => requireReadableOrganization(['own'], 'other')).toThrow(
      'Insufficient permission',
    );
  });
  it('preserves global access for explicit platform and service grants only', async () => {
    expect(
      await readableOrganizationIds(
        source([row('*', 'own', 'platform')]) as never,
        actor,
        'membership.read',
      ),
    ).toBeNull();
    const ds = source([]);
    expect(
      await readableOrganizationIds(
        ds as never,
        {
          ...actor,
          identityType: 'service_account',
          scopes: ['organization.read'],
        },
        'organization.read',
      ),
    ).toBeNull();
    await expect(
      readableOrganizationIds(
        ds as never,
        { ...actor, identityType: 'service_account', scopes: [] },
        'organization.read',
      ),
    ).rejects.toThrow('Insufficient permission');
    expect(ds.query).not.toHaveBeenCalled();
  });
  it('filters organizations in the database before applying limits', async () => {
    const ds = source([row('organization.read')]);
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const service = new OrganizationsService(
      ds as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.findAll({ limit: '25' }, actor);
    expect(repository.find).toHaveBeenCalledWith({
      where: { id: In(['own']) },
      order: { createdAt: 'DESC' },
      take: 25,
    });
    await expect(service.findOneVisible('other', actor)).rejects.toThrow(
      'Insufficient permission',
    );
  });
  it('filters invitations and their count, and refuses a foreign organization filter', async () => {
    const ds = source([row('membership.read')]);
    const repository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    const service = new InvitationsService(
      ds as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.listAll({ limit: 25, offset: 0 }, actor);
    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: In(['own']) } }),
    );
    repository.findAndCount.mockClear();
    await expect(
      service.listAll(
        { limit: 25, offset: 0, organization_id: 'other' },
        actor,
      ),
    ).rejects.toThrow('Insufficient permission');
    expect(repository.findAndCount).not.toHaveBeenCalled();
  });
  it('refuses invitation details from another organization', async () => {
    const ds = source([row('membership.read')]);
    const repository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'invite',
        organizationId: 'other',
        tokenHash: 'secret',
      }),
    };
    const service = new InvitationsService(
      ds as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.findOne('invite', actor)).rejects.toThrow(
      'Insufficient permission',
    );
    await expect(service.findAll('other', actor)).rejects.toThrow(
      'Insufficient permission',
    );
  });
  it('returns empty lists with no grants and never queries unfiltered data', async () => {
    const ds = source([]);
    const repository = { find: jest.fn(), findAndCount: jest.fn() };
    const organizations = new OrganizationsService(
      ds as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const invitations = new InvitationsService(
      ds as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await organizations.findAll({}, actor)).toEqual([]);
    expect(await invitations.listAll({ limit: 25, offset: 0 }, actor)).toEqual({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.findAndCount).not.toHaveBeenCalled();
  });
});
