import {
  authorizationMode,
  authenticatedActions,
} from '../../../../../apps/api/src/common/auth/authorization-mode';
import { SystemAuthorizationService } from '../../../../../apps/api/src/modules/access-context/authorization/system-authorization.service';
import { ConsoleAuthorizationService } from '../../../../../apps/api/src/modules/access-context/authorization/console-authorization.service';
import type { AccessJwksService } from '../../../../../apps/api/src/modules/access-context/jwks/access-jwks.service';

const actor = {
  identityReferenceId: '11111111-1111-4111-8111-111111111111',
  issuer: 'https://id.test',
  subjectId: 'operator',
  identityType: 'workforce_user' as const,
};
const organization = '22222222-2222-4222-8222-222222222222';
const row = (version = 1, code = 'billing.viewer') => ({
  organization_id: organization,
  organization_code: 'hemia',
  organization_name: 'Hemia',
  membership_id: '33333333-3333-4333-8333-333333333333',
  context_version: 1,
  authority_expires_at: null,
  contract_version: 1,
  catalog_version: version,
  assignment_id: '44444444-4444-4444-8444-444444444444',
  assignment_version: 1,
  role_code: code,
  scope_type: 'all_customers',
  consumer_scope_type: 'not_applicable',
  organization_ids: [],
  resource_ids: [],
  valid_from: new Date(Date.now() - 60000),
  expires_at: null,
});
const setup = (rows = [row()]) => {
  const query = jest.fn().mockResolvedValue(rows);
  const signContextToken = jest
    .fn<Promise<string>, Parameters<AccessJwksService['signContextToken']>>()
    .mockResolvedValue('signed');
  return {
    query,
    signContextToken,
    service: new SystemAuthorizationService(
      { query } as never,
      { signContextToken } as never,
    ),
  };
};

describe('Billing-only authorization mode and catalog compatibility', () => {
  const previous = process.env.HEMIA_AUTHORIZATION_MODE;
  const previousBilling = process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
  beforeEach(() => {
    process.env.HEMIA_AUTHORIZATION_MODE = 'authenticated';
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = 'roles';
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.HEMIA_AUTHORIZATION_MODE;
    else process.env.HEMIA_AUTHORIZATION_MODE = previous;
    if (previousBilling === undefined)
      delete process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
    else process.env.HEMIA_BILLING_AUTHORIZATION_MODE = previousBilling;
  });

  it.each([undefined, '', 'roles', 'authenticated'])(
    'inherits the global mode when the Billing override is %s',
    (globalMode) => {
      delete process.env.HEMIA_BILLING_AUTHORIZATION_MODE;
      if (globalMode === undefined) delete process.env.HEMIA_AUTHORIZATION_MODE;
      else process.env.HEMIA_AUTHORIZATION_MODE = globalMode;
      expect(authorizationMode('billing')).toBe(globalMode || 'roles');
      process.env.HEMIA_BILLING_AUTHORIZATION_MODE = '';
      expect(authorizationMode('billing')).toBe(globalMode || 'roles');
    },
  );

  it.each([
    { globalMode: 'roles', mode: 'roles' },
    { globalMode: 'roles', mode: 'authenticated' },
    { globalMode: 'authenticated', mode: 'roles' },
    { globalMode: 'authenticated', mode: 'authenticated' },
  ])('isolates the Billing override: %j', ({ globalMode, mode }) => {
    process.env.HEMIA_AUTHORIZATION_MODE = globalMode;
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = mode;
    expect(authorizationMode('billing')).toBe(mode);
    expect(authorizationMode('legal')).toBe(globalMode);
    expect(authorizationMode()).toBe(globalMode);
    expect(authenticatedActions(actor, 'billing')).toBe(
      mode === 'authenticated',
    );
    expect(authenticatedActions(actor, 'legal')).toBe(
      globalMode === 'authenticated',
    );
    expect(authenticatedActions(actor)).toBe(globalMode === 'authenticated');
    expect(
      authenticatedActions(
        { ...actor, identityType: 'service_account' },
        'billing',
      ),
    ).toBe(false);
  });

  it('rejects an unknown Billing mode without changing other products', () => {
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = 'anything';
    expect(() => authorizationMode('billing')).toThrow(
      'Invalid HEMIA_BILLING_AUTHORIZATION_MODE',
    );
    expect(authorizationMode('legal')).toBe('authenticated');
    expect(authorizationMode()).toBe('authenticated');
  });

  it('uses roles for both Billing discovery and signing while Legal and Console keep membership mode', async () => {
    const billing = setup([]);
    expect(await billing.service.organizations(actor, 'billing')).toEqual([]);
    await expect(
      billing.service.resolve(actor, organization, 'billing-api', 'billing'),
    ).rejects.toMatchObject({ status: 403 });
    expect(billing.signContextToken).not.toHaveBeenCalled();
    expect(billing.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM system_role_assignments'),
      expect.any(Array),
    );
    const legal = setup();
    expect(await legal.service.organizations(actor, 'legal')).toHaveLength(1);
    await legal.service.resolve(actor, organization, 'legal-api', 'legal');
    expect(legal.signContextToken).toHaveBeenCalledWith(
      expect.objectContaining({ assignments: [], catalog_version: 2 }),
      actor.subjectId,
      'legal-api',
      expect.any(Object),
    );
    expect(legal.query).toHaveBeenCalledWith(
      expect.not.stringContaining('system_role_assignments'),
      expect.any(Array),
    );
    const signContextToken = jest.fn().mockResolvedValue('signed');
    const query = jest.fn().mockResolvedValue([
      {
        membership_id: row().membership_id,
        context_version: 1,
        expires_at: null,
      },
    ]);
    await new ConsoleAuthorizationService(
      { query } as never,
      { signContextToken } as never,
    ).resolve(actor, organization);
    expect(signContextToken).toHaveBeenCalledWith(
      expect.objectContaining({ global_roles: [], permissions: [] }),
      actor.subjectId,
      'console-api',
      expect.any(Object),
    );
  });

  it.each([
    { rows: [row(1)] },
    { rows: [row(2, 'billing.webhook_viewer')] },
    {
      rows: [
        row(1),
        {
          ...row(2, 'billing.webhook_viewer'),
          assignment_id: '55555555-5555-4555-8555-555555555555',
        },
      ],
    },
  ])(
    'signs only the catalog version needed by effective assignments: %j',
    async ({ rows }) => {
      const { service, signContextToken } = setup(rows);
      await service.resolve(actor, organization, 'billing-api', 'billing');
      expect(signContextToken).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_version: 1,
          catalog_version: Math.max(
            ...rows.map((grant) => grant.catalog_version),
          ),
        }),
        actor.subjectId,
        'billing-api',
        expect.any(Object),
      );
      expect(signContextToken.mock.calls[0]?.[0].assignments).toMatchObject(
        rows.map((grant) => ({
          assignment_id: grant.assignment_id,
          role_code: grant.role_code,
          scope: { type: 'all_customers' },
        })),
      );
    },
  );

  it.each(['billing', 'legal'] as const)(
    'rejects unsupported %s catalogs',
    async (product) => {
      process.env.HEMIA_AUTHORIZATION_MODE = 'roles';
      const { service, signContextToken } = setup([row(99)]);
      await expect(
        service.resolve(actor, organization, `${product}-api`, product),
      ).rejects.toMatchObject({ code: 'ACCESS_CONTRACT_VERSION_MISMATCH' });
      expect(signContextToken).not.toHaveBeenCalled();
    },
  );

  it('does not retain authenticated Billing authority after changing its override', async () => {
    const { service, query, signContextToken } = setup();
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = 'authenticated';
    await service.resolve(actor, organization, 'billing-api', 'billing');
    expect(signContextToken.mock.calls.at(-1)?.[0]).toMatchObject({
      contract_version: 1,
      catalog_version: 1,
      assignments: [],
    });
    process.env.HEMIA_BILLING_AUTHORIZATION_MODE = 'roles';
    query.mockResolvedValue([]);
    const count = signContextToken.mock.calls.length;
    await expect(
      service.resolve(actor, organization, 'billing-api', 'billing'),
    ).rejects.toMatchObject({ status: 403 });
    expect(signContextToken).toHaveBeenCalledTimes(count);
    query.mockResolvedValue([row(2, 'billing.webhook_viewer')]);
    await service.resolve(actor, organization, 'billing-api', 'billing');
    expect(signContextToken.mock.calls.at(-1)?.[0]).toMatchObject({
      catalog_version: 2,
    });
  });
});
