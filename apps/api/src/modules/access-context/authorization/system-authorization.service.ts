import { authenticatedActions } from '../../../common/auth/authorization-mode';
import {
  BILLING_MAX_ASSIGNMENTS,
  BILLING_MAX_TARGET_REFERENCES,
} from '../../system-roles/authorization/billing-authorization-limits';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { AccessError } from '../../../common/errors/access-error';
import { AccessJwksService } from '../jwks/access-jwks.service';

type GrantRow = {
  organization_id: string;
  organization_code: string;
  organization_name: string;
  membership_id: string;
  context_version: number;
  assignment_id: string;
  assignment_version: number;
  role_code: string;
  scope_type: string;
  organization_ids: string[];
  resource_ids: string[];
  consumer_scope_type: string;
  external_tenant_id: string | null;
  provisioning_status: string | null;
  valid_from: Date;
  expires_at: Date | null;
  authority_expires_at: Date | null;
  contract_version: number;
  catalog_version: number;
};

@Injectable()
export class SystemAuthorizationService {
  constructor(
    private readonly database: DataSource,
    private readonly jwks: AccessJwksService,
  ) {}

  async organizations(
    actor: AccessActor,
    productCode: 'billing' | 'legal' = 'billing',
  ) {
    const rows = authenticatedActions(actor)
      ? await this.membershipAuthorities(actor, undefined, productCode)
      : await this.rows(actor, undefined, productCode);
    return [
      ...new Map(
        rows.map((row) => [
          row.organization_id,
          {
            organization_id: row.organization_id,
            organization_code: row.organization_code,
            organization_name: row.organization_name,
            organization_status: 'active',
            membership_id: row.membership_id,
            membership_status: 'active',
            context_version: row.context_version,
            roles: [],
            permissions: [],
            product: {
              code: productCode,
              status: 'enabled',
              provisioning_status:
                productCode === 'legal' ? row.provisioning_status : null,
              external_tenant_id:
                productCode === 'legal' ? row.external_tenant_id : null,
            },
          },
        ]),
      ).values(),
    ];
  }

  async resolve(
    actor: AccessActor,
    organizationId: string,
    audience?: string,
    productCode: 'billing' | 'legal' = 'billing',
  ) {
    if (audience && audience !== `${productCode}-api`)
      throw new AccessError(
        'ACCESS_INVALID_AUDIENCE',
        'Invalid system audience',
        400,
      );
    if (authenticatedActions(actor))
      return this.resolveAuthenticated(actor, organizationId, productCode);
    const rows = await this.rows(actor, organizationId, productCode);
    if (!rows.length)
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'No effective system assignment',
        403,
      );
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + 300,
      ...rows.flatMap((row) =>
        [row.expires_at, row.authority_expires_at]
          .filter((date): date is Date => date !== null)
          .map((date) => Math.floor(+new Date(date) / 1000)),
      ),
    );
    if (exp <= now)
      throw new AccessError('ACCESS_FORBIDDEN', 'Authorization expired', 403);
    const claims = {
      identity_issuer: actor.issuer,
      identity_reference_id: actor.identityReferenceId,
      organization_id: organizationId,
      membership_id: rows[0].membership_id,
      product_code: productCode,
      contract_version: 1,
      catalog_version:
        productCode === 'legal'
          ? Math.max(...rows.map((row) => row.catalog_version))
          : 1,
      context_version: rows[0].context_version,
      jti: randomUUID(),
      nbf: now,
      assignments: rows.map((row) => ({
        assignment_id: row.assignment_id,
        assignment_version: row.assignment_version,
        role_code: row.role_code,
        ...(productCode === 'billing'
          ? {
              scope:
                row.scope_type === 'organizations'
                  ? {
                      type: row.scope_type,
                      organization_ids: row.organization_ids,
                    }
                  : { type: row.scope_type },
            }
          : {
              resource_scope: { type: row.scope_type, ids: row.resource_ids },
              consumer_scope: {
                type: row.consumer_scope_type,
                organization_ids: row.organization_ids,
              },
            }),
        valid_from: Math.floor(+new Date(row.valid_from) / 1000),
        expires_at:
          row.expires_at === null
            ? null
            : Math.floor(+new Date(row.expires_at) / 1000),
      })),
    };
    if (Buffer.byteLength(JSON.stringify(claims)) > 131072)
      throw new AccessError(
        'ACCESS_CONTEXT_TOO_LARGE',
        'Authorization exceeds context limit',
        409,
      );
    return {
      authorized: true,
      context_token: await this.jwks.signContextToken(
        claims,
        actor.subjectId,
        `${productCode}-api`,
        { expiresAt: exp, issuedAt: now, type: 'hemia-context+jwt' },
      ),
    };
  }

  private async membershipAuthorities(
    actor: AccessActor,
    organizationId: string | undefined,
    productCode: 'billing' | 'legal',
  ) {
    if (actor.identityType === 'service_account')
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Human membership required',
        403,
      );
    return this.database.query<
      Array<{
        organization_id: string;
        organization_code: string;
        organization_name: string;
        membership_id: string;
        context_version: number;
        authority_expires_at: Date | null;
        external_tenant_id: string | null;
        provisioning_status: string | null;
      }>
    >(
      `
      SELECT o.id AS organization_id, o.code AS organization_code, o.name AS organization_name,
        m.id AS membership_id, m.context_version, LEAST(m.expires_at, op.expires_at) AS authority_expires_at,
        (SELECT external_tenant_id FROM organization_product_instances WHERE organization_product_id=op.id LIMIT 1) AS external_tenant_id,
        (SELECT status FROM organization_product_instances WHERE organization_product_id=op.id LIMIT 1) AS provisioning_status
      FROM organization_memberships m JOIN identity_references i ON i.id=m.identity_reference_id
      JOIN organizations o ON o.id=m.organization_id
      JOIN organization_products op ON op.organization_id=o.id JOIN products p ON p.id=op.product_id
      WHERE i.id=$1 AND i.issuer=$2 AND i.subject_id=$3 AND i.status='active' AND i.identity_type<>'service_account'
        AND ($4::uuid IS NULL OR o.id=$4) AND o.type='internal' AND o.status='active'
        AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
        AND p.code=$5 AND p.status='active' AND op.status='enabled' AND (op.expires_at IS NULL OR op.expires_at>now())
      ORDER BY o.id`,
      [
        actor.identityReferenceId,
        actor.issuer,
        actor.subjectId,
        organizationId ?? null,
        productCode,
      ],
    );
  }

  private async resolveAuthenticated(
    actor: AccessActor,
    organizationId: string,
    productCode: 'billing' | 'legal',
  ) {
    const [membership] = await this.membershipAuthorities(
      actor,
      organizationId,
      productCode,
    );
    if (!membership)
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Active membership and enabled product required',
        403,
      );
    const now = Math.floor(Date.now() / 1000);
    const expiresAt =
      membership.authority_expires_at === null
        ? now + 300
        : Math.min(
            now + 300,
            Math.floor(+new Date(membership.authority_expires_at) / 1000),
          );
    if (expiresAt <= now)
      throw new AccessError('ACCESS_FORBIDDEN', 'Authorization expired', 403);
    return {
      authorized: true,
      context_token: await this.jwks.signContextToken(
        {
          identity_issuer: actor.issuer,
          identity_reference_id: actor.identityReferenceId,
          organization_id: organizationId,
          membership_id: membership.membership_id,
          product_code: productCode,
          contract_version: 1,
          catalog_version: productCode === 'legal' ? 2 : 1,
          context_version: Number(membership.context_version),
          jti: randomUUID(),
          nbf: now,
          assignments: [],
        },
        actor.subjectId,
        `${productCode}-api`,
        { expiresAt, issuedAt: now, type: 'hemia-context+jwt' },
      ),
    };
  }

  private async rows(
    actor: AccessActor,
    organizationId?: string,
    productCode: 'billing' | 'legal' = 'billing',
  ) {
    if (actor.identityType === 'service_account')
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Human membership required',
        403,
      );
    // One uncached SQL snapshot validates both the recipient and the complete delegation chain.
    const rows = await this.database.query<GrantRow[]>(
      `
      SELECT o.id AS organization_id, o.code AS organization_code, o.name AS organization_name,
        m.id AS membership_id, m.context_version, a.id AS assignment_id, a.version AS assignment_version,
        r.code AS role_code, r.contract_version, r.catalog_version, a.scope_type, a.consumer_scope_type, a.valid_from, a.expires_at,
        LEAST(m.expires_at, op.expires_at, d.expires_at, dm.expires_at) AS authority_expires_at,
        ARRAY(SELECT t.organization_id::text FROM system_role_assignment_targets t WHERE t.assignment_id=a.id AND t.target_type='organization' ORDER BY t.organization_id) AS organization_ids,
        ARRAY(SELECT t.resource_id::text FROM system_role_assignment_targets t WHERE t.assignment_id=a.id AND t.target_type IN ('legal_issuer','legal_application') ORDER BY t.resource_id) AS resource_ids,
        (SELECT external_tenant_id FROM organization_product_instances WHERE organization_product_id=op.id LIMIT 1) AS external_tenant_id,
        (SELECT status FROM organization_product_instances WHERE organization_product_id=op.id LIMIT 1) AS provisioning_status
      FROM system_role_assignments a
      JOIN organization_memberships m ON m.id=a.membership_id
      JOIN identity_references i ON i.id=m.identity_reference_id
      JOIN organizations o ON o.id=m.organization_id
      JOIN system_roles r ON r.id=a.role_id
      JOIN system_role_scopes rs ON rs.role_id=r.id AND rs.scope_type=a.scope_type AND rs.consumer_scope_type=a.consumer_scope_type
      JOIN products p ON p.id=r.product_id
      JOIN organization_products op ON op.organization_id=o.id AND op.product_id=p.id
      LEFT JOIN system_role_delegations d ON d.id=a.delegation_id
      LEFT JOIN organization_memberships dm ON dm.id=d.grantee_membership_id
      LEFT JOIN organizations doo ON doo.id=dm.organization_id
      LEFT JOIN identity_references di ON di.id=dm.identity_reference_id
      WHERE i.id=$1 AND i.issuer=$2 AND i.subject_id=$3 AND i.status='active' AND i.identity_type<>'service_account'
        AND ($4::uuid IS NULL OR o.id=$4) AND o.type='internal' AND o.status='active'
        AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
        AND p.code=$5 AND p.status='active' AND op.status='enabled' AND (op.expires_at IS NULL OR op.expires_at>now())
        AND r.scope_profile=$5 || '_v1' AND r.status='active' AND r.sealed AND a.sealed AND a.status='active'
        AND a.valid_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
        AND (a.scope_type<>'organizations' OR EXISTS(SELECT 1 FROM system_role_assignment_targets t WHERE t.assignment_id=a.id))
        AND (a.delegation_id IS NULL OR (
          d.sealed AND d.status='active' AND d.can_grant AND d.role_id=a.role_id AND d.recipient_organization_id=o.id
          AND d.valid_from<=now() AND (d.expires_at IS NULL OR d.expires_at>now())
          AND dm.status='active' AND (dm.expires_at IS NULL OR dm.expires_at>now())
          AND doo.type='internal' AND doo.status='active' AND di.status='active' AND di.identity_type<>'service_account'
          AND di.id<>i.id AND a.created_by_identity_id=di.id AND a.valid_from>=d.valid_from AND (d.expires_at IS NULL OR a.expires_at<=d.expires_at)
          AND (
            ($5='billing' AND a.consumer_scope_type='not_applicable' AND d.consumer_scope_type='not_applicable' AND
              ((d.scope_type='catalog_global' AND a.scope_type='catalog_global') OR (d.scope_type='all_customers' AND a.scope_type IN ('all_customers','organizations')) OR
               (d.scope_type='organizations' AND a.scope_type='organizations' AND NOT EXISTS(SELECT 1 FROM system_role_assignment_targets t WHERE t.assignment_id=a.id AND NOT EXISTS(SELECT 1 FROM system_role_delegation_targets dt WHERE dt.delegation_id=d.id AND dt.target_type=t.target_type AND dt.target_id=t.target_id)))))
            OR ($5='legal' AND d.scope_type IN ('issuers','applications') AND d.scope_type=a.scope_type AND d.consumer_scope_type IN ('not_applicable','organizations') AND d.consumer_scope_type=a.consumer_scope_type AND
              NOT EXISTS(SELECT 1 FROM system_role_assignment_targets t WHERE t.assignment_id=a.id AND NOT EXISTS(SELECT 1 FROM system_role_delegation_targets dt WHERE dt.delegation_id=d.id AND dt.target_type=t.target_type AND dt.target_id=t.target_id)))
          )))
      ORDER BY o.id,a.id LIMIT ${BILLING_MAX_ASSIGNMENTS + 1}`,
      [
        actor.identityReferenceId,
        actor.issuer,
        actor.subjectId,
        organizationId ?? null,
        productCode,
      ],
    );
    if (
      rows.length > BILLING_MAX_ASSIGNMENTS ||
      rows.reduce(
        (n, row) => n + row.organization_ids.length + row.resource_ids.length,
        0,
      ) > BILLING_MAX_TARGET_REFERENCES
    )
      throw new AccessError(
        'ACCESS_CONTEXT_TOO_LARGE',
        'Authorization exceeds context limit',
        409,
      );
    if (
      rows.some(
        (row) =>
          row.contract_version !== 1 ||
          !(productCode === 'legal' ? [1, 2] : [1]).includes(
            row.catalog_version,
          ),
      )
    )
      throw new AccessError(
        'ACCESS_CONTRACT_VERSION_MISMATCH',
        'Unsupported system catalog',
        409,
      );
    return rows;
  }
}
