import {
  authorizationMode,
  authenticatedActions,
  requireOrganizationAccess,
} from '../../../../apps/api/src/common/auth/authorization-mode';
import { readableOrganizationIds } from '../../../../apps/api/src/common/auth/readable-organizations';
import { requirePlatformAdministrator } from '../../../../apps/api/src/common/auth/platform-administration';
import { SystemAuthorizationService } from '../../../../apps/api/src/modules/access-context/authorization/system-authorization.service';
import { ConsoleAuthorizationService } from '../../../../apps/api/src/modules/access-context/authorization/console-authorization.service';

const actor = {
  identityReferenceId: '11111111-1111-4111-8111-111111111111',
  issuer: 'https://id.test',
  subjectId: 'person',
  identityType: 'workforce_user' as const,
};
const organization = '22222222-2222-4222-8222-222222222222';
const membership = {
  organization_id: organization,
  organization_code: 'hemia',
  organization_name: 'Hemia',
  membership_id: '33333333-3333-4333-8333-333333333333',
  context_version: 1,
  authority_expires_at: null,
  external_tenant_id: null,
  provisioning_status: null,
};

describe('Temporary authenticated action mode', () => {
  const previous = process.env.HEMIA_AUTHORIZATION_MODE;
  beforeEach(() => {
    process.env.HEMIA_AUTHORIZATION_MODE = 'authenticated';
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.HEMIA_AUTHORIZATION_MODE;
    else process.env.HEMIA_AUTHORIZATION_MODE = previous;
  });
  it('defaults to roles and rejects an unknown mode', () => {
    delete process.env.HEMIA_AUTHORIZATION_MODE;
    expect(authorizationMode()).toBe('roles');
    process.env.HEMIA_AUTHORIZATION_MODE = 'anything';
    expect(() => authorizationMode()).toThrow(
      'Invalid HEMIA_AUTHORIZATION_MODE',
    );
  });
  it('does not bypass machine policies', () => {
    expect(
      authenticatedActions({ ...actor, identityType: 'service_account' }),
    ).toBe(false);
  });
  it('keeps organization boundaries without consulting role tables', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{ organization_id: organization }]),
    };
    expect(
      await readableOrganizationIds(db as never, actor, 'membership.invite'),
    ).toEqual([organization]);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('JOIN roles'),
      [actor.identityReferenceId],
    );
    db.query.mockResolvedValue([]);
    await expect(
      requireOrganizationAccess(db as never, actor, organization),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('administration can target an owned pending/suspended organization, without weakening session eligibility', async () => {
    const db = { query: jest.fn().mockResolvedValue([{ id: organization }]) };
    await requireOrganizationAccess(db as never, actor, organization);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining("o.status='active'"),
      [actor.identityReferenceId, organization],
    );
  });
  it('platform actions require active internal membership but no platform role', async () => {
    const db = { query: jest.fn().mockResolvedValue([{ id: 'membership' }]) };
    await requirePlatformAdministrator(db as never, actor);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('platform_super_admin'),
      [actor.identityReferenceId],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("o.type='internal'"),
      [actor.identityReferenceId],
    );
    db.query.mockResolvedValue([]);
    await expect(
      requirePlatformAdministrator(db as never, actor),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['billing', 'legal'] as const)(
    'issues %s context from membership with no fabricated role assignments',
    async (product) => {
      const expires = new Date(Date.now() + 90000);
      const db = {
        query: jest
          .fn()
          .mockResolvedValue([
            { ...membership, authority_expires_at: expires },
          ]),
      };
      const jwks = { signContextToken: jest.fn().mockResolvedValue('signed') };
      const service = new SystemAuthorizationService(
        db as never,
        jwks as never,
      );
      const discovered = await service.organizations(actor, product);
      expect(discovered[0].organization_id).toBe(organization);
      expect(
        await service.resolve(actor, organization, `${product}-api`, product),
      ).toEqual({ authorized: true, context_token: 'signed' });
      expect(jwks.signContextToken).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: organization,
          membership_id: membership.membership_id,
          identity_issuer: actor.issuer,
          assignments: [],
          catalog_version: product === 'legal' ? 2 : 1,
        }),
        actor.subjectId,
        `${product}-api`,
        expect.objectContaining({
          expiresAt: Math.floor(+expires / 1000),
          type: 'hemia-context+jwt',
        }),
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("op.status='enabled'"),
        expect.any(Array),
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.not.stringContaining('system_role_assignments'),
        expect.any(Array),
      );
    },
  );
  it('refuses no membership and invalid audiences', async () => {
    const db = { query: jest.fn().mockResolvedValue([]) };
    const jwks = { signContextToken: jest.fn() };
    const s = new SystemAuthorizationService(db as never, jwks as never);
    await expect(
      s.resolve(actor, organization, 'billing-api', 'billing'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.resolve(actor, organization, 'wrong', 'billing'),
    ).rejects.toMatchObject({ status: 400 });
    expect(jwks.signContextToken).not.toHaveBeenCalled();
  });
  it('never gives Console a synthetic superadministrator role', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([
        {
          membership_id: membership.membership_id,
          context_version: 1,
          expires_at: null,
        },
      ]),
    };
    const jwks = { signContextToken: jest.fn().mockResolvedValue('signed') };
    await new ConsoleAuthorizationService(db as never, jwks as never).resolve(
      actor,
      organization,
    );
    expect(jwks.signContextToken).toHaveBeenCalledWith(
      expect.objectContaining({
        global_roles: [],
        permissions: [],
        membership_id: membership.membership_id,
      }),
      actor.subjectId,
      'console-api',
      expect.any(Object),
    );
  });
});
