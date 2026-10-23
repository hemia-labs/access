import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditEvent } from '../modules/audit/entities/audit-event.entity';
import { OutboxEvent } from '../modules/outbox/entities/outbox-event.entity';

const profiles = {
  billing: [
    ['billing.catalog_manager', 'catalog_global', 'not_applicable'],
    ['billing.operator', 'all_customers', 'not_applicable'],
    ['billing.invoice_operator', 'all_customers', 'not_applicable'],
    ['billing.integration_operator', 'all_customers', 'not_applicable'],
    ['billing.auditor', 'all_customers', 'not_applicable'],
  ],
  legal: [
    ['legal.editor', 'legal_global', 'not_applicable'],
    ['legal.publisher', 'legal_global', 'not_applicable'],
    ['legal.catalog_manager', 'legal_global', 'not_applicable'],
    ['legal.auditor', 'legal_global', 'all_organizations'],
    ['legal.notification_operator', 'legal_global', 'all_organizations'],
  ],
} as const;

/** Manual CLI only. Never register this function in a Nest module or HTTP route. */
export async function bootstrapSystemRoles(
  productCode: keyof typeof profiles,
  db: DataSource,
  input: {
    identity: { issuer: string; subject: string; email: string };
    membershipId: string;
    reason: string;
    executor: { username: string; hostname: string; uid: number };
    apply: boolean;
  },
) {
  if (!Object.hasOwn(profiles, productCode))
    throw new Error('Unsupported bootstrap product');
  const grants: readonly (readonly [string, string, string])[] =
    profiles[productCode];
  if (
    !input.reason.trim() ||
    input.reason.length > 1000 ||
    !input.identity.subject ||
    !input.identity.email
  )
    throw new Error('Identity and a reason of 1..1000 characters are required');
  return db.transaction(async (manager) => {
    await manager.query("SET LOCAL lock_timeout='5s'");
    await manager.query("SET LOCAL statement_timeout='15s'");
    // One-time maintenance operation: exclude concurrent authority and grant writes.
    await manager.query(`LOCK TABLE identity_references, organizations, organization_memberships,
      membership_roles, roles, products, organization_products, system_roles,
      system_role_scopes, system_role_assignments IN SHARE ROW EXCLUSIVE MODE`);
    const [product] = await manager.query<{ id: string }[]>(
      "SELECT id FROM products WHERE code=$1 AND status='active'",
      [productCode],
    );
    if (!product) throw new Error(`Active ${productCode} product is required`);
    const previous = await manager.getRepository(AuditEvent).findOneBy({
      action: 'system_role.bootstrap',
      resourceType: 'product',
      resourceId: product.id,
    });
    if (previous) {
      const receipt = previous.afterSnapshot!;
      if (
        receipt.membershipId !== input.membershipId ||
        receipt.subject !== input.identity.subject ||
        receipt.issuer !== input.identity.issuer
      )
        throw new Error(
          `${productCode} bootstrap was already consumed for another recipient`,
        );
      return { applied: false, replayed: true, receipt };
    }
    const administrators = await manager.query<
      { id: string }[]
    >(`SELECT DISTINCT i.id FROM identity_references i
      JOIN organization_memberships m ON m.identity_reference_id=i.id JOIN organizations o ON o.id=m.organization_id
      JOIN membership_roles mr ON mr.membership_id=m.id JOIN roles r ON r.id=mr.role_id
      WHERE i.status='active' AND i.identity_type<>'service_account' AND m.status='active'
      AND (m.expires_at IS NULL OR m.expires_at>now()) AND o.status='active' AND o.type='internal'
      AND r.code='platform_super_admin' AND r.scope='platform' AND r.organization_id IS NULL AND r.status='active'
      AND (mr.expires_at IS NULL OR mr.expires_at>now())`);
    const [member] = await manager.query<
      {
        id: string;
        identity_reference_id: string;
        organization_id: string;
        subject_id: string;
        issuer: string;
      }[]
    >(
      `SELECT m.id,m.identity_reference_id,m.organization_id,i.subject_id,i.issuer
      FROM organization_memberships m JOIN identity_references i ON i.id=m.identity_reference_id
      JOIN organizations o ON o.id=m.organization_id JOIN organization_products op ON op.organization_id=o.id
      WHERE m.id=$1 AND i.issuer=$2 AND i.subject_id=$3 AND lower(i.email_snapshot)=lower($4)
      AND i.status='active' AND i.identity_type<>'service_account' AND m.status='active'
      AND (m.expires_at IS NULL OR m.expires_at>now()) AND o.type='internal' AND o.status='active'
      AND op.product_id=$5 AND op.status='enabled' AND (op.expires_at IS NULL OR op.expires_at>now())`,
      [
        input.membershipId,
        input.identity.issuer,
        input.identity.subject,
        input.identity.email,
        product.id,
      ],
    );
    if (
      !member ||
      administrators.length !== 1 ||
      administrators[0].id !== member.identity_reference_id
    )
      throw new Error(
        `Recipient must be the sole active platform administrator with an eligible ${productCode} membership`,
      );
    const [history] = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM system_role_assignments a
      JOIN organization_memberships m ON m.id=a.membership_id JOIN system_roles r ON r.id=a.role_id
      WHERE m.identity_reference_id=$1 AND r.product_id=$2) AS exists`,
      [member.identity_reference_id, product.id],
    );
    if (history.exists)
      throw new Error(
        `Recipient already has ${productCode} assignment history; use normal administration`,
      );
    const roles = await manager.query<
      {
        id: string;
        code: string;
        scope_type: string;
        consumer_scope_type: string;
      }[]
    >(
      `SELECT r.id,r.code,s.scope_type,s.consumer_scope_type FROM system_roles r
      JOIN system_role_scopes s ON s.role_id=r.id WHERE r.product_id=$1 AND r.status='active' AND r.sealed
      AND r.scope_profile=$2 AND r.contract_version=1 AND r.catalog_version=1`,
      [product.id, productCode + '_v1'],
    );
    const selected = grants.map(([code, scope, consumerScope]) => {
      const role = roles.find(
        (r: {
          code: string;
          scope_type: string;
          consumer_scope_type: string;
        }) =>
          r.code === code &&
          r.scope_type === scope &&
          r.consumer_scope_type === consumerScope,
      );
      if (!role)
        throw new Error(
          'Published ' + productCode + ' catalog is incomplete: ' + code,
        );
      return {
        roleId: role.id,
        role: code,
        scope,
        consumerScope,
        expiresAt: null,
      };
    });
    const preview = {
      product: productCode,
      membershipId: member.id,
      issuer: input.identity.issuer,
      subject: input.identity.subject,
      email: input.identity.email,
      grants: selected,
    };
    if (!input.apply) return { applied: false, replayed: false, preview };
    const assignments = [] as {
      id: string;
      role: string;
      scope: string;
      consumerScope: string;
    }[];
    for (const grant of selected) {
      const id = randomUUID();
      await manager.query(
        `INSERT INTO system_role_assignments
        (id,membership_id,role_id,scope_type,consumer_scope_type,valid_from,created_by_identity_id,idempotency_key)
        VALUES($1,$2,$3,$4,$7,now(),$5,$6)`,
        [
          id,
          member.id,
          grant.roleId,
          grant.scope,
          member.identity_reference_id,
          randomUUID(),
          grant.consumerScope,
        ],
      );
      assignments.push({
        id,
        role: grant.role,
        scope: grant.scope,
        consumerScope: grant.consumerScope,
      });
    }
    const [updated] = await manager.query<
      [{ context_version: number }[], number]
    >(
      `UPDATE organization_memberships SET context_version=context_version+1,
      version=version+1 WHERE id=$1 RETURNING context_version`,
      [member.id],
    );
    const receipt = {
      ...preview,
      assignments,
      contextVersion: updated[0].context_version,
    };
    const auditId = randomUUID();
    await manager.getRepository(AuditEvent).insert({
      id: auditId,
      organizationId: member.organization_id,
      actorType: 'bootstrap',
      actorSubjectId: input.executor.username,
      action: 'system_role.bootstrap',
      resourceType: 'product',
      resourceId: product.id,
      afterSnapshot: receipt,
      metadata: {
        executor: input.executor,
        reason: input.reason,
        procedure: productCode + '-bootstrap-v1',
        identityVerified: true,
        createdBySemantics:
          'recipient explicitly initializes own roles; manual bootstrap exception',
      },
    });
    await manager.getRepository(OutboxEvent).insert({
      eventType: 'access.membership.context_invalidated.v1',
      aggregateType: 'membership',
      aggregateId: member.id,
      status: 'pending',
      payload: {
        type: 'access.membership.context_invalidated.v1',
        source: 'urn:hemia:service:hemia-access',
        occurred_at: new Date().toISOString(),
        correlation_id: auditId,
        actor: { type: 'system', subject_id: productCode + '-bootstrap-v1' },
        data: {
          organization_id: member.organization_id,
          membership_id: member.id,
          identity_reference_id: member.identity_reference_id,
          identity_issuer: member.issuer,
          subject_id: member.subject_id,
          context_version: updated[0].context_version,
          reason: 'system_role_authorization_changed',
          bootstrap_audit_id: auditId,
        },
      },
    });
    return { applied: true, replayed: false, receipt };
  });
}
