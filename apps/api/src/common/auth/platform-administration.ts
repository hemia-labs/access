import {
  authenticatedActions,
  requireOrganizationAccess,
} from './authorization-mode';
import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccessActor } from './access-actor.type';
import { AccessError } from '../errors/access-error';
import { Organization } from '../../modules/organizations/entities/organization.entity';
import { Role } from '../../modules/roles/entities/role.entity';

export async function requirePlatformAdministrator(
  manager: EntityManager,
  actor: Pick<AccessActor, 'identityReferenceId' | 'identityType'>,
) {
  if (actor.identityType === 'service_account') throw forbidden();
  if (authenticatedActions(actor)) {
    const eligible = await manager.query<Array<{ id: string }>>(
      `
      SELECT m.id FROM organization_memberships m
      JOIN organizations o ON o.id=m.organization_id
      JOIN identity_references i ON i.id=m.identity_reference_id
      WHERE i.id=$1 AND i.status='active' AND i.identity_type<>'service_account'
        AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
        AND o.type='internal' AND o.status='active'
      FOR SHARE OF m,o,i`,
      [actor.identityReferenceId],
    );
    if (!eligible.length) throw forbidden();
    return;
  }

  const rows: unknown[] = await manager.query(
    `SELECT m.id
    FROM organization_memberships m
    JOIN identity_references i ON i.id = m.identity_reference_id
    JOIN organizations o ON o.id = m.organization_id
    JOIN membership_roles mr ON mr.membership_id = m.id
    JOIN roles r ON r.id = mr.role_id
    WHERE m.identity_reference_id = $1 AND i.status = 'active' AND i.identity_type <> 'service_account' AND m.status = 'active'
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND o.status = 'active' AND o.type = 'internal'
      AND r.code = 'platform_super_admin' AND r.scope = 'platform'
      AND r.organization_id IS NULL AND r.status = 'active'
      AND (mr.expires_at IS NULL OR mr.expires_at > now())
    FOR SHARE OF m, o, mr, r, i`,
    [actor.identityReferenceId],
  );
  if (!rows.length) throw forbidden();
}

// Hold the organization lock until commit, including for customer organizations:
// classification cannot change between the eligibility check and the write.
export async function protectInternalOrganization(
  manager: EntityManager,
  actor: Pick<AccessActor, 'identityReferenceId' | 'identityType'>,
  organizationId: string,
) {
  if (authenticatedActions(actor))
    await requireOrganizationAccess(manager, actor, organizationId);
  const organization = await manager.getRepository(Organization).findOne({
    where: { id: organizationId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!organization)
    throw new AccessError(
      'ACCESS_ORGANIZATION_NOT_FOUND',
      'Organization not found',
      HttpStatus.NOT_FOUND,
    );
  if (organization.type === 'internal')
    await requirePlatformAdministrator(manager, actor);
  return organization;
}

export async function protectRoleAssignment(
  manager: EntityManager,
  actor: AccessActor,
  organizationId: string,
  role: Role,
) {
  if (
    role.status !== 'active' ||
    (role.organizationId !== null && role.organizationId !== organizationId)
  )
    throw forbidden();
  if (role.scope === 'platform')
    await requirePlatformAdministrator(manager, actor);
}

function forbidden() {
  return new AccessError(
    'ACCESS_FORBIDDEN',
    'Active platform administrator authority is required',
    HttpStatus.FORBIDDEN,
  );
}
