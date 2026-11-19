import accessConfig from '../../../../apps/api/src/config/access.config';
import { authorizationMode } from '../../../../apps/api/src/common/auth/authorization-mode';
import { requirePlatformAdministrator } from '../../../../apps/api/src/common/auth/platform-administration';
import { readableOrganizationIds } from '../../../../apps/api/src/common/auth/readable-organizations';

const actor = {
  identityReferenceId: '11111111-1111-4111-8111-111111111111',
  issuer: 'https://id.test',
  subjectId: 'person',
  identityType: 'workforce_user' as const,
};

describe('Mandatory role authorization', () => {
  const previous = process.env.HEMIA_AUTHORIZATION_MODE;
  const previousBilling = process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
  beforeEach(() => {
    delete process.env.HEMIA_AUTHORIZATION_MODE;
    delete process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.HEMIA_AUTHORIZATION_MODE;
    else process.env.HEMIA_AUTHORIZATION_MODE = previous;
    if (previousBilling === undefined)
      delete process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
    else process.env.HEMIA_BILLING_AUTHORIZATION_MODE = previousBilling;
  });

  it.each([undefined, '', 'roles'])(
    'defaults to role authorization for all products with setting %s',
    (mode) => {
      if (mode !== undefined) process.env.HEMIA_AUTHORIZATION_MODE = mode;
      expect(authorizationMode()).toBe('roles');
      expect(authorizationMode('billing')).toBe('roles');
      expect(authorizationMode('legal')).toBe('roles');
      expect(accessConfig()).toMatchObject({
        authorizationMode: 'roles',
        billingAuthorizationMode: 'roles',
      });
    },
  );

  it.each(['HEMIA_AUTHORIZATION_MODE', 'HEMIA_BILLING_AUTHORIZATION_MODE'])(
    'rejects obsolete and unknown %s values in the startup configuration factory',
    (variable) => {
      for (const mode of ['authenticated', 'anything']) {
        process.env[variable] = mode;
        expect(() => accessConfig()).toThrow(
          `Invalid ${variable}: only roles is supported`,
        );
      }
    },
  );

  it('does not mask an invalid global mode with the former Billing override', () => {
    process.env.HEMIA_AUTHORIZATION_MODE = 'authenticated';
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = 'roles';
    expect(() => accessConfig()).toThrow('Invalid HEMIA_AUTHORIZATION_MODE');
  });

  it('requires a platform role even for an authenticated internal member', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(
      requirePlatformAdministrator({ query } as never, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.code = 'platform_super_admin'"),
      [actor.identityReferenceId],
    );
  });

  it('does not discover organizations through membership alone', async () => {
    const query = jest.fn().mockResolvedValue([]);
    expect(
      await readableOrganizationIds(
        { query } as never,
        actor,
        'organization.read',
      ),
    ).toEqual([]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN role_permissions'),
      [actor.identityReferenceId],
    );
  });
});
