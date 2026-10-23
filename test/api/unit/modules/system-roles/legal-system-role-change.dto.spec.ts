import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  CreateLegalSystemRoleDto,
  ReplaceLegalSystemRoleDto,
  CreateLegalSystemRoleDelegationDto,
} from '../../../../../apps/api/src/modules/system-roles/dtos/legal-system-role-change.dto';
import { CreateSystemRoleDto } from '../../../../../apps/api/src/modules/system-roles/dtos/system-role-change.dto';
const base = () => ({
  membershipId: randomUUID(),
  roleId: randomUUID(),
  idempotencyKey: randomUUID(),
  scopeType: 'applications',
  consumerScopeType: 'organizations',
  resourceIds: [randomUUID()],
  organizationIds: [randomUUID()],
  validFrom: '2026-01-01T00:00:00Z',
  expiresAt: null,
});
const errors = (
  body: object,
  cls: new () => object = CreateLegalSystemRoleDto,
) =>
  validateSync(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('Legal grant DTO contract', () => {
  it.each(['legal_global', 'issuers', 'applications'])(
    'accepts explicit consumer dimensions for %s',
    (scopeType) => {
      for (const consumerScopeType of [
        'not_applicable',
        'all_organizations',
        'organizations',
      ]) {
        const value = {
          ...base(),
          scopeType,
          consumerScopeType,
          resourceIds: scopeType === 'legal_global' ? [] : [randomUUID()],
          organizationIds:
            consumerScopeType === 'organizations' ? [randomUUID()] : [],
        };
        expect(errors(value)).toEqual([]);
      }
    },
  );
  it.each([
    { resourceIds: [] },
    { organizationIds: [] },
    { scopeType: 'legal_global' },
    { consumerScopeType: 'not_applicable' },
    { consumerScopeType: 'all_organizations' },
    { scopeType: 'organizations' },
    { consumerScopeType: undefined },
    { expiresAt: undefined },
    { expiresAt: '2025-01-01T00:00:00Z' },
    { validFrom: '2026-01-01T00:00:00-06:00' },
    { scopeProfile: 'legal_v1' },
    { sealed: true },
  ])('rejects mismatched or internal fields (%#)', (patch) =>
    expect(errors({ ...base(), ...patch }).length).toBeGreaterThan(0),
  );
  it('normalizes and rejects duplicate IDs; counts references across both dimensions', () => {
    const id = randomUUID();
    expect(
      errors({ ...base(), resourceIds: [id, id.toUpperCase()] }).length,
    ).toBeGreaterThan(0);
    const value = {
      ...base(),
      resourceIds: Array.from({ length: 600 }, () => randomUUID()),
      organizationIds: Array.from({ length: 400 }, () => randomUUID()),
    };
    expect(errors(value)).toEqual([]);
    value.organizationIds.push(randomUUID());
    expect(errors(value).length).toBeGreaterThan(0);
  });
  it('replacement requires version and rejects a recipient override', () => {
    const value: Partial<ReturnType<typeof base>> = base();
    delete value.membershipId;
    expect(
      validateSync(
        plainToInstance(ReplaceLegalSystemRoleDto, {
          ...value,
          expectedVersion: 1,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toEqual([]);
    expect(
      validateSync(plainToInstance(ReplaceLegalSystemRoleDto, value)).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(ReplaceLegalSystemRoleDto, {
          ...base(),
          expectedVersion: 1,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ).length,
    ).toBeGreaterThan(0);
  });
  it('delegation requires explicit sets, a capability and no subdelegation', () => {
    const value = {
      ...base(),
      recipientOrganizationId: randomUUID(),
      canGrant: true,
      canRevoke: false,
    };
    const check = (body: object) =>
      validateSync(plainToInstance(CreateLegalSystemRoleDelegationDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    expect(check(value)).toEqual([]);
    for (const patch of [
      { scopeType: 'legal_global', resourceIds: [] },
      { consumerScopeType: 'all_organizations', organizationIds: [] },
      { canGrant: false },
      { authorityDelegationId: randomUUID() },
    ])
      expect(check({ ...value, ...patch }).length).toBeGreaterThan(0);
  });
  it('Billing DTOs still reject Legal requests rather than silently dropping dimensions', () => {
    expect(errors(base(), CreateSystemRoleDto).length).toBeGreaterThan(0);
  });
});
