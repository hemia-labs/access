import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { AccessError } from '../../../common/errors/access-error';
import { AccessJwksService } from '../jwks/access-jwks.service';

type AuthorityRow = {
  membership_id: string;
  context_version: number;
  membership_expires_at: Date | null;
  role_expires_at: Date | null;
  permission_expires_at: Date | null;
  product_expires_at: Date | null;
};

@Injectable()
export class ConsoleAuthorizationService {
  constructor(
    private readonly database: DataSource,
    private readonly jwks: AccessJwksService,
  ) {}

  async resolve(
    actor: AccessActor,
    organizationId: string,
    audience = 'console-api',
  ) {
    if (audience !== 'console-api')
      throw new AccessError(
        'ACCESS_INVALID_AUDIENCE',
        'Console requires audience console-api',
        HttpStatus.BAD_REQUEST,
      );
    if (actor.identityType === 'service_account') throw this.forbidden();

    // One fresh database snapshot; neither login context nor cached grants apply.
    const rows: AuthorityRow[] = await this.database.query(
      `SELECT m.id AS membership_id, m.context_version,
        m.expires_at AS membership_expires_at, mr.expires_at AS role_expires_at,
        pmr.expires_at AS permission_expires_at, op.expires_at AS product_expires_at
      FROM organization_memberships m
      JOIN identity_references i ON i.id = m.identity_reference_id
      JOIN organizations o ON o.id = m.organization_id
      JOIN membership_roles mr ON mr.membership_id = m.id
      JOIN roles r ON r.id = mr.role_id
      JOIN membership_roles pmr ON pmr.membership_id = m.id
      JOIN roles pr ON pr.id = pmr.role_id
      JOIN role_permissions rp ON rp.role_id = pr.id
      JOIN permissions p ON p.id = rp.permission_id
      JOIN organization_products op ON op.organization_id = o.id
      JOIN products product ON product.id = op.product_id
      WHERE o.id = $1 AND i.id = $2 AND i.issuer = $3 AND i.subject_id = $4
        AND i.status = 'active' AND i.identity_type IN ('workforce_user', 'customer_user')
        AND o.status = 'active' AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND r.code = 'platform_super_admin' AND r.scope = 'platform'
        AND r.organization_id IS NULL AND r.status = 'active'
        AND (mr.expires_at IS NULL OR mr.expires_at > now())
        AND pr.status = 'active' AND (pr.organization_id IS NULL OR pr.organization_id = o.id)
        AND (pmr.expires_at IS NULL OR pmr.expires_at > now())
        AND p.code = '*' AND p.scope = 'platform' AND p.status = 'active'
        AND product.code = 'console' AND product.status = 'active' AND op.status = 'enabled'
        AND (op.expires_at IS NULL OR op.expires_at > now())
      LIMIT 1`,
      [
        organizationId,
        actor.identityReferenceId,
        actor.issuer,
        actor.subjectId,
      ],
    );
    const authority = rows[0];
    if (!authority) throw this.forbidden();

    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + 300,
      ...[
        authority.membership_expires_at,
        authority.role_expires_at,
        authority.permission_expires_at,
        authority.product_expires_at,
      ]
        .filter((date): date is Date => date !== null)
        .map((date) => Math.floor(date.getTime() / 1000)),
    );
    if (exp <= now) throw this.forbidden();
    const contextToken = await this.jwks.signContextToken(
      {
        identity_issuer: actor.issuer,
        identity_reference_id: actor.identityReferenceId,
        organization_id: organizationId,
        organization_status: 'active',
        membership_id: authority.membership_id,
        membership_status: 'active',
        product_code: 'console',
        product_status: 'enabled',
        contract_version: 1,
        context_version: authority.context_version,
        global_roles: ['platform_super_admin'],
        permissions: ['*'],
        jti: randomUUID(),
        nbf: now,
      },
      actor.subjectId,
      audience,
      { issuedAt: now, expiresAt: exp, type: 'hemia-context+jwt' },
    );
    return { authorized: true, context_token: contextToken };
  }

  private forbidden() {
    return new AccessError(
      'ACCESS_FORBIDDEN',
      'Active Console platform superadministrator authority required',
      HttpStatus.FORBIDDEN,
    );
  }
}
