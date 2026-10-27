import { authenticatedActions } from './authorization-mode';
import { HttpStatus } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AccessActor } from './access-actor.type';
import { AccessError } from '../errors/access-error';

const matches = (code: string, permission: string) =>
  code === '*' ||
  code === permission ||
  (code.endsWith('.*') && permission.startsWith(code.slice(0, -1)));

// null means a platform permission or an explicitly scoped service can read across organizations.
export async function readableOrganizationIds(
  dataSource: DataSource,
  actor: AccessActor,
  permission: string,
): Promise<string[] | null> {
  if (actor.identityType === 'service_account') {
    if (actor.scopes?.some((code) => matches(code, permission))) return null;
    throw new AccessError(
      'ACCESS_FORBIDDEN',
      'Insufficient permission',
      HttpStatus.FORBIDDEN,
    );
  }
  if (authenticatedActions(actor)) {
    const memberships = await dataSource.query<
      Array<{ organization_id: string }>
    >(
      `
      SELECT o.id AS organization_id FROM organizations o
      JOIN identity_references i ON i.id=$1 AND i.status='active' AND i.identity_type<>'service_account'
      WHERE (o.created_by_identity_id=i.id OR EXISTS (
        SELECT 1 FROM organization_memberships m WHERE m.organization_id=o.id AND m.identity_reference_id=i.id
          AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
      ))`,
      [actor.identityReferenceId],
    );
    return memberships.map((row) => row.organization_id);
  }
  const rows = await dataSource.query<
    Array<{
      organization_id: string;
      permission_code: string;
      role_scope: string;
    }>
  >(
    `
    SELECT membership.organization_id, permission.code AS permission_code, role.scope AS role_scope
    FROM organization_memberships membership
    JOIN organizations organization ON organization.id = membership.organization_id
    JOIN membership_roles membership_role ON membership_role.membership_id = membership.id
    JOIN roles role ON role.id = membership_role.role_id
    JOIN role_permissions role_permission ON role_permission.role_id = role.id
    JOIN permissions permission ON permission.id = role_permission.permission_id
    WHERE membership.identity_reference_id = $1
      AND membership.status = 'active' AND organization.status = 'active'
      AND (membership.expires_at IS NULL OR membership.expires_at > now())
      AND role.status = 'active' AND permission.status = 'active'
      AND (role.organization_id IS NULL OR role.organization_id = membership.organization_id)
      AND (membership_role.expires_at IS NULL OR membership_role.expires_at > now())
  `,
    [actor.identityReferenceId],
  );
  const allowed = rows.filter((row) =>
    matches(row.permission_code, permission),
  );
  if (allowed.some((row) => row.role_scope === 'platform')) return null;
  return [...new Set(allowed.map((row) => row.organization_id))];
}

export function requireReadableOrganization(
  ids: string[] | null,
  organizationId: string,
): void {
  if (ids !== null && !ids.includes(organizationId)) {
    throw new AccessError(
      'ACCESS_FORBIDDEN',
      'Insufficient permission for organization',
      HttpStatus.FORBIDDEN,
    );
  }
}
