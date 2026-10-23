import { EntityManager } from 'typeorm';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { OutboxService } from '../../outbox/outbox.service';

// The caller saves the source membership (including version) before calling.
// Call after changing authority, in the same transaction. Include historical
// dependencies conservatively: reactivation or extending validity can restore access.
export async function invalidateAuthorization(
  manager: EntityManager,
  outbox: OutboxService,
  actor: AccessActor,
  source: { membershipId: string } | { organizationId: string },
) {
  const membershipId = 'membershipId' in source ? source.membershipId : null;
  const organizationId =
    'organizationId' in source ? source.organizationId : null;
  const [rows] = await manager.query<
    [
      Array<{
        id: string;
        organization_id: string;
        identity_reference_id: string;
        context_version: number;
        issuer: string;
        subject_id: string;
      }>,
      number,
    ]
  >(
    `
    WITH sources AS (
      SELECT id FROM organization_memberships
      WHERE id = $1::uuid OR organization_id = $2::uuid
    ), affected AS (
      SELECT id FROM sources
      UNION
      SELECT a.membership_id FROM system_role_assignments a
      JOIN system_role_delegations d ON d.id = a.delegation_id
      JOIN sources s ON s.id = d.grantee_membership_id
    )
    UPDATE organization_memberships m
    SET context_version = m.context_version + 1,
        version = m.version + CASE WHEN m.id = $1::uuid THEN 0 ELSE 1 END
    FROM identity_references i
    WHERE m.identity_reference_id = i.id AND m.id IN (SELECT id FROM affected)
    RETURNING m.id, m.organization_id, m.identity_reference_id,
              m.context_version, i.issuer, i.subject_id
  `,
    [membershipId, organizationId],
  );
  await outbox.recordMany(
    manager,
    rows.map((row) => ({
      type: 'access.membership.context_invalidated.v1',
      aggregateType: 'membership',
      aggregateId: row.id,
      actor,
      data: {
        organization_id: row.organization_id,
        membership_id: row.id,
        identity_reference_id: row.identity_reference_id,
        context_version: row.context_version,
        identity_issuer: row.issuer,
        subject_id: row.subject_id,
        reason: membershipId
          ? 'membership_eligibility_changed'
          : 'organization_eligibility_changed',
      },
    })),
  );
  return rows;
}
