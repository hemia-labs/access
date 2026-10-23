import { EntityManager } from 'typeorm';
import { AccessError } from '../../../common/errors/access-error';

export const BILLING_MAX_ASSIGNMENTS = 64;
export const BILLING_MAX_TARGET_REFERENCES = 1000;

// Reserve capacity for active, unexpired grants, including future grants and
// temporarily ineffective authority. Reactivation must not exceed read limits.
// Caller must lock the identity and use a SERIALIZABLE transaction.
export async function assertBillingAssignmentBudget(
  manager: EntityManager,
  identityId: string,
  roleId: string,
  replacedId: string | null,
  expiresAt: string | null,
  targetCount: number,
) {
  const [budget] = await manager.query<
    Array<{
      product_code: string;
      assignments: number;
      targets: number;
    }>
  >(
    `
    WITH retained AS (
      SELECT a.id FROM system_role_assignments a
      JOIN organization_memberships m ON m.id = a.membership_id
      JOIN system_roles r ON r.id = a.role_id
      WHERE m.identity_reference_id = $1
        AND r.product_id = (SELECT product_id FROM system_roles WHERE id = $2)
        AND ($3::uuid IS NULL OR a.id <> $3)
        AND a.status = 'active' AND (a.expires_at IS NULL OR a.expires_at > now())
    ), proposed AS (
      SELECT CASE WHEN $4::timestamptz IS NULL OR $4::timestamptz > now() THEN 1 ELSE 0 END AS n
    )
    SELECT (SELECT p.code FROM products p JOIN system_roles r ON r.product_id = p.id WHERE r.id = $2) AS product_code,
      ((SELECT count(*) FROM retained) + proposed.n)::int AS assignments,
      ((SELECT count(*) FROM system_role_assignment_targets t JOIN retained a ON a.id = t.assignment_id) + proposed.n * $5::int)::int AS targets
    FROM proposed
  `,
    [identityId, roleId, replacedId, expiresAt, targetCount],
  );
  if (
    ['billing', 'legal'].includes(budget.product_code) &&
    (budget.assignments > BILLING_MAX_ASSIGNMENTS ||
      budget.targets > BILLING_MAX_TARGET_REFERENCES)
  ) {
    throw new AccessError(
      'ACCESS_CONTEXT_TOO_LARGE',
      `${budget.product_code} assignment budget exceeded: ${budget.assignments}/${BILLING_MAX_ASSIGNMENTS} assignments, ${budget.targets}/${BILLING_MAX_TARGET_REFERENCES} target references`,
      409,
    );
  }
}
