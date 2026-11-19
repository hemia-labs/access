import { SystemAuthorizationService } from '../../../../../apps/api/src/modules/access-context/authorization/system-authorization.service';
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
  organization_ids: [] as string[],
  resource_ids: [] as string[],
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

describe('Effective system assignments and catalog compatibility', () => {
  it.each(['billing', 'legal'] as const)(
    'denies %s discovery and signing without an effective assignment',
    async (product) => {
      const { service, query, signContextToken } = setup([]);
      expect(await service.organizations(actor, product)).toEqual([]);
      await expect(
        service.resolve(actor, organization, `${product}-api`, product),
      ).rejects.toMatchObject({ status: 403 });
      expect(signContextToken).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM system_role_assignments'),
        expect.any(Array),
      );
    },
  );

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
      const { service, signContextToken } = setup([row(99)]);
      await expect(
        service.resolve(actor, organization, `${product}-api`, product),
      ).rejects.toMatchObject({ code: 'ACCESS_CONTRACT_VERSION_MISMATCH' });
      expect(signContextToken).not.toHaveBeenCalled();
    },
  );

  it.each(['billing', 'legal'] as const)(
    'does not reuse revoked %s authority on discovery or signing',
    async (product) => {
      const { service, query, signContextToken } = setup([
        row(2, `${product}.viewer`),
      ]);
      await service.resolve(actor, organization, `${product}-api`, product);
      query.mockResolvedValue([]);
      expect(await service.organizations(actor, product)).toEqual([]);
      await expect(
        service.resolve(actor, organization, `${product}-api`, product),
      ).rejects.toMatchObject({ status: 403 });
      expect(signContextToken).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the explicit organization targets of a Billing viewer', async () => {
    const targets = ['55555555-5555-4555-8555-555555555555'];
    const grant = {
      ...row(),
      scope_type: 'organizations',
      organization_ids: targets,
    };
    const { service, signContextToken } = setup([grant]);
    await service.resolve(actor, organization);
    expect(signContextToken.mock.calls[0]?.[0].assignments).toEqual([
      expect.objectContaining({
        role_code: 'billing.viewer',
        scope: { type: 'organizations', organization_ids: targets },
      }),
    ]);
  });

  it.each(['billing', 'legal'] as const)(
    'keeps service accounts outside human %s assignment resolution',
    async (product) => {
      const { service, query, signContextToken } = setup();
      const machine = { ...actor, identityType: 'service_account' as const };
      await expect(
        service.organizations(machine, product),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.resolve(machine, organization, `${product}-api`, product),
      ).rejects.toMatchObject({ status: 403 });
      expect(query).not.toHaveBeenCalled();
      expect(signContextToken).not.toHaveBeenCalled();
    },
  );
});
