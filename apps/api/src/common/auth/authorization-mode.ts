import { isUUID } from 'class-validator';
import { HttpStatus } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AccessActor } from './access-actor.type';
import { AccessError } from '../errors/access-error';

export function authorizationMode(
  productCode?: 'billing' | 'legal',
): 'roles' | 'authenticated' {
  const variable =
    productCode === 'billing' && process.env.HEMIA_BILLING_AUTHORIZATION_MODE
      ? 'HEMIA_BILLING_AUTHORIZATION_MODE'
      : 'HEMIA_AUTHORIZATION_MODE';
  const mode = process.env[variable] || 'roles';
  if (mode !== 'roles' && mode !== 'authenticated')
    throw new Error(`Invalid ${variable}`);
  return mode;
}

export function authenticatedActions(
  actor: Pick<AccessActor, 'identityType'>,
  productCode?: 'billing' | 'legal',
): boolean {
  return (
    actor.identityType !== 'service_account' &&
    authorizationMode(productCode) === 'authenticated'
  );
}

export async function requireOrganizationAccess(
  database: Pick<DataSource | EntityManager, 'query'>,
  actor: Pick<AccessActor, 'identityReferenceId'>,
  organizationId: string,
): Promise<void> {
  if (!isUUID(organizationId))
    throw new AccessError(
      'ACCESS_INVALID_REQUEST',
      'Invalid organization identifier',
      HttpStatus.BAD_REQUEST,
    );
  const rows = await database.query<Array<{ id: string }>>(
    `
    SELECT o.id FROM organizations o
    JOIN identity_references i ON i.id=$1 AND i.status='active' AND i.identity_type<>'service_account'
    WHERE o.id=$2 AND (
      o.created_by_identity_id=i.id OR EXISTS (
        SELECT 1 FROM organization_memberships m WHERE m.organization_id=o.id
          AND m.identity_reference_id=i.id AND m.status='active'
          AND (m.expires_at IS NULL OR m.expires_at>now())
      )
    )`,
    [actor.identityReferenceId, organizationId],
  );
  if (!rows.length)
    throw new AccessError(
      'ACCESS_FORBIDDEN',
      'Active organization access required',
      HttpStatus.FORBIDDEN,
    );
}
