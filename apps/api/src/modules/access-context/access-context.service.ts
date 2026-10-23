import type { LegalConsumerContextDto } from './dtos/legal-consumer-context.dto';
import { SystemAuthorizationService } from './authorization/system-authorization.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { Membership } from '../memberships/entities/membership.entity';
import { MembershipRole } from '../roles/entities/membership-role.entity';
import { Permission } from '../roles/entities/permission.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { Role } from '../roles/entities/role.entity';
import { AccessContextCacheService } from './cache/access-context-cache.service';
import { AccessJwksService } from './jwks/access-jwks.service';
import { ConsoleAuthorizationService } from './authorization/console-authorization.service';

type ContextRow = {
  organization_id: string;
  organization_code: string;
  organization_name: string;
  organization_status: string;
  membership_id: string;
  membership_status: string;
  context_version: number;
  role_code: string | null;
  permission_code: string | null;
  product_code: string | null;
  product_status: string | null;
  provisioning_status: string | null;
  external_tenant_id: string | null;
};

type OrganizationContext = {
  organization_id: string;
  organization_code: string;
  organization_name: string;
  organization_status: string;
  membership_id: string;
  membership_status: string;
  context_version: number;
  roles: string[];
  permissions: string[];
  product?: {
    code: string;
    status: string;
    provisioning_status: string | null;
    external_tenant_id: string | null;
  };
};

type AccessContext = {
  identity: {
    issuer: string;
    subject_id: string;
    type: AccessActor['identityType'];
    identity_reference_id: string;
  };
  organizations: OrganizationContext[];
};

@Injectable()
export class AccessContextService {
  constructor(
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    private readonly cache: AccessContextCacheService,
    private readonly jwks: AccessJwksService,
    private readonly config: ConfigService,
    private readonly systemAuthorization: SystemAuthorizationService,
    private readonly consoleAuthorization: ConsoleAuthorizationService,
  ) {}

  me(actor: AccessActor) {
    return this.identity(actor);
  }

  async organizations(actor: AccessActor) {
    return (await this.context(actor)).organizations;
  }

  async context(actor: AccessActor, productCode?: string) {
    if (productCode === 'billing' || productCode === 'legal')
      return {
        identity: this.identity(actor),
        organizations: await this.systemAuthorization.organizations(
          actor,
          productCode,
        ),
      };
    const key = this.cache.key(actor.identityReferenceId);
    const cached = productCode
      ? null
      : await this.cache.get<AccessContext>(key);
    if (cached) return cached;

    const context = {
      identity: this.identity(actor),
      organizations: this.group(
        await this.rows(actor.identityReferenceId, productCode),
      ),
    };
    if (!productCode) await this.cache.set(key, context);
    return context;
  }

  async resolve(
    actor: AccessActor,
    organizationId: string,
    audience?: string,
    productCode?: string,
  ) {
    if (productCode === 'console')
      return this.consoleAuthorization.resolve(actor, organizationId, audience);
    if (productCode === 'billing' || productCode === 'legal')
      return this.systemAuthorization.resolve(
        actor,
        organizationId,
        audience,
        productCode,
      );
    const organization = await this.findOrganization(
      actor,
      organizationId,
      productCode,
    );
    const aud =
      audience ??
      this.config.get<string>('access.expectedAudience', 'access-api');
    const contextToken = await this.jwks.signContextToken(
      {
        identity_reference_id: actor.identityReferenceId,
        organization_id: organization.organization_id,
        membership_id: organization.membership_id,
        global_roles: organization.roles,
        permissions: organization.permissions,
        context_version: organization.context_version,
        product: organization.product ?? null,
      },
      actor.subjectId,
      aud,
    );

    return {
      authorized: true,
      organization_id: organization.organization_id,
      membership_id: organization.membership_id,
      roles: organization.roles,
      permissions: organization.permissions,
      context_version: organization.context_version,
      product: organization.product ?? null,
      context_token: contextToken,
    };
  }

  async legalOrganizations(
    actor: AccessActor,
    organizationIds: string[],
    active = false,
  ) {
    const legalServiceClientId = this.config.get<string>(
      'access.legalServiceClientId',
    );
    if (
      actor.identityType !== 'service_account' ||
      !legalServiceClientId ||
      actor.subjectId !== legalServiceClientId ||
      !actor.scopes?.includes('legal.consumer_context.read')
    )
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Authorized Legal service client required',
        HttpStatus.FORBIDDEN,
      );
    const rows: { organization_id: string }[] = await this.memberships.query(
      `SELECT o.id AS organization_id FROM organizations o WHERE o.id=ANY($1::uuid[]) AND ($2::boolean=false OR (o.status='active' AND EXISTS(SELECT 1 FROM organization_products op JOIN products p ON p.id=op.product_id WHERE op.organization_id=o.id AND p.code='legal' AND p.status='active' AND op.status='enabled' AND (op.expires_at IS NULL OR op.expires_at>now()))))`,
      [organizationIds, active],
    );
    return {
      valid: rows.length === organizationIds.length,
      organization_ids: rows.map((row) => row.organization_id),
    };
  }

  async legalConsumerContext(
    actor: AccessActor,
    input: LegalConsumerContextDto,
  ) {
    const legalServiceClientId = this.config.get<string>(
      'access.legalServiceClientId',
    );
    if (
      actor.identityType !== 'service_account' ||
      !legalServiceClientId ||
      actor.subjectId !== legalServiceClientId ||
      !actor.scopes?.includes('legal.consumer_context.read')
    )
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Authorized Legal service client required',
        HttpStatus.FORBIDDEN,
      );
    const rows: {
      organization_id: string;
      membership_id: string;
      context_version: number;
      roles: string[];
    }[] = await this.memberships.query(
      `
      SELECT o.id AS organization_id, m.id AS membership_id, m.context_version,
        ARRAY(SELECT r.code FROM membership_roles mr JOIN roles r ON r.id=mr.role_id
          WHERE mr.membership_id=m.id AND r.status='active' AND (mr.expires_at IS NULL OR mr.expires_at>now()) ORDER BY r.code) AS roles
      FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
      JOIN identity_references i ON i.id=m.identity_reference_id
      JOIN organization_products op ON op.organization_id=o.id
      JOIN products p ON p.id=op.product_id AND p.code='legal' AND p.status='active'
      WHERE o.id=$1 AND i.issuer=$2 AND i.subject_id=$3 AND i.status='active'
        AND i.identity_type IN ('workforce_user','customer_user') AND o.status='active'
        AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
        AND op.status='enabled' AND (op.expires_at IS NULL OR op.expires_at>now())`,
      [input.organization_id, input.identity_issuer, input.subject_id],
    );
    if (rows.length !== 1)
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Active consumer membership and product access required',
        HttpStatus.FORBIDDEN,
      );
    return {
      ...rows[0],
      identity_issuer: input.identity_issuer,
      subject_id: input.subject_id,
    };
  }

  async check(actor: AccessActor, organizationId: string, permission: string) {
    const organization = await this.findOrganization(actor, organizationId);
    return {
      allowed: organization.permissions.some((candidate) =>
        this.matchesPermission(candidate, permission),
      ),
    };
  }

  async invalidate(identityReferenceId: string) {
    await this.cache.del(this.cache.key(identityReferenceId));
  }

  private identity(actor: AccessActor) {
    return {
      issuer: actor.issuer,
      subject_id: actor.subjectId,
      type: actor.identityType,
      identity_reference_id: actor.identityReferenceId,
    };
  }

  private matchesPermission(candidate: string, permission: string) {
    return (
      candidate === '*' ||
      candidate === permission ||
      (candidate.endsWith('.*') &&
        permission.startsWith(candidate.slice(0, -1)))
    );
  }

  private async findOrganization(
    actor: AccessActor,
    organizationId: string,
    productCode?: string,
  ) {
    const organization = (
      await this.context(actor, productCode)
    ).organizations.find((item) => item.organization_id === organizationId);
    if (!organization) {
      throw new AccessError(
        'ACCESS_CONTEXT_NOT_FOUND',
        'Active access context was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization;
  }

  private rows(identityReferenceId: string, productCode?: string) {
    const query = this.memberships
      .createQueryBuilder('membership')
      .innerJoin(
        'organizations',
        'organization',
        'organization.id = membership.organization_id AND organization.status = :active',
      )
      .leftJoin(
        MembershipRole,
        'membership_role',
        'membership_role.membership_id = membership.id AND (membership_role.expires_at IS NULL OR membership_role.expires_at > now())',
      )
      .leftJoin(
        Role,
        'role',
        'role.id = membership_role.role_id AND role.status = :active',
      )
      .leftJoin(
        RolePermission,
        'role_permission',
        'role_permission.role_id = role.id',
      )
      .leftJoin(
        Permission,
        'permission',
        'permission.id = role_permission.permission_id AND permission.status = :active',
      )
      .leftJoin(
        'organization_products',
        'organization_product',
        'organization_product.organization_id = organization.id AND organization_product.status = :enabled',
      )
      .leftJoin(
        'products',
        'product',
        'product.id = organization_product.product_id AND product.status = :active AND product.code = :requestedProductCode',
      )
      .leftJoin(
        'organization_product_instances',
        'product_instance',
        'product_instance.organization_product_id = organization_product.id',
      )
      .select([
        'organization.id as organization_id',
        'organization.code as organization_code',
        'organization.name as organization_name',
        'organization.status as organization_status',
        'membership.id as membership_id',
        'membership.status as membership_status',
        'membership.context_version as context_version',
        'role.code as role_code',
        'permission.code as permission_code',
        'product.code as product_code',
        'organization_product.status as product_status',
        'product_instance.status as provisioning_status',
        'product_instance.external_tenant_id as external_tenant_id',
      ])
      .where('membership.identity_reference_id = :identityReferenceId', {
        identityReferenceId,
      })
      .andWhere('membership.status = :active', { active: 'active' })
      .setParameter('enabled', 'enabled')
      .setParameter('requestedProductCode', productCode ?? '')
      .orderBy('organization.name', 'ASC');
    if (productCode) {
      query.andWhere('product.code = :productCode', { productCode });
    }
    return query.getRawMany<ContextRow>();
  }

  private group(rows: ContextRow[]) {
    const organizations = new Map<string, OrganizationContext>();
    for (const row of rows) {
      let organization = organizations.get(row.organization_id);
      if (!organization) {
        organization = {
          organization_id: row.organization_id,
          organization_code: row.organization_code,
          organization_name: row.organization_name,
          organization_status: row.organization_status,
          membership_id: row.membership_id,
          membership_status: row.membership_status,
          context_version: Number(row.context_version),
          roles: [],
          permissions: [],
        };
        organizations.set(row.organization_id, organization);
      }
      if (row.role_code && !organization.roles.includes(row.role_code)) {
        organization.roles.push(row.role_code);
      }
      if (
        row.permission_code &&
        !organization.permissions.includes(row.permission_code)
      ) {
        organization.permissions.push(row.permission_code);
      }
      if (row.product_code) {
        organization.product = {
          code: row.product_code,
          status: row.product_status ?? 'enabled',
          provisioning_status: row.provisioning_status,
          external_tenant_id: row.external_tenant_id,
        };
      }
    }
    return [...organizations.values()];
  }
}
