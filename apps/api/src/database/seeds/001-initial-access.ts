import { DataSource, IsNull } from 'typeorm';
import { IdentityReference } from '../../modules/identity-references/entities/identity-reference.entity';
import { Membership } from '../../modules/memberships/entities/membership.entity';
import { Organization } from '../../modules/organizations/entities/organization.entity';
import { Permission } from '../../modules/roles/entities/permission.entity';
import { MembershipRole } from '../../modules/roles/entities/membership-role.entity';
import { RolePermission } from '../../modules/roles/entities/role-permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { OrganizationProduct } from '../../modules/products/entities/organization-product.entity';
import { Product } from '../../modules/products/entities/product.entity';

const organizationPermissions = [
  'organization.read',
  'organization.update',
  'organization.archive',
  'membership.read',
  'membership.invite',
  'membership.suspend',
  'membership.revoke',
  'role.read',
  'role.assign',
  'role.revoke',
  'product_access.read',
  'product_access.enable',
  'product_access.suspend',
  'product_access.disable',
  'audit.read',
];
const permissions = ['*', ...organizationPermissions];

const roles = [
  ['platform_super_admin', 'platform'],
  ['platform_support', 'platform'],
  ['platform_auditor', 'platform'],
  ['organization_owner', 'organization'],
  ['organization_admin', 'organization'],
  ['organization_member', 'organization'],
  ['engineering', 'organization'],
  ['support', 'organization'],
  ['finance', 'organization'],
  ['legal', 'organization'],
] as const;

const matrix: Record<string, string[]> = {
  platform_super_admin: ['*'],
  platform_support: [
    'organization.read',
    'membership.read',
    'membership.invite',
    'membership.suspend',
    'role.read',
    'product_access.read',
    'product_access.suspend',
    'audit.read',
  ],
  platform_auditor: [
    'organization.read',
    'membership.read',
    'role.read',
    'product_access.read',
    'audit.read',
  ],
  organization_owner: [...organizationPermissions],
  organization_admin: [
    'organization.read',
    'organization.update',
    'membership.read',
    'membership.invite',
    'membership.suspend',
    'membership.revoke',
    'role.read',
    'role.assign',
    'role.revoke',
    'product_access.read',
    'audit.read',
  ],
  organization_member: [
    'organization.read',
    'membership.read',
    'product_access.read',
  ],
  engineering: ['organization.read', 'membership.read', 'product_access.read'],
  support: ['organization.read', 'membership.read', 'product_access.read'],
  finance: ['organization.read', 'membership.read', 'product_access.read'],
  legal: ['organization.read', 'membership.read', 'product_access.read'],
};

const products = [
  ['access', 'Hemia Access', 'internal', 'none'],
  ['billing', 'Hemia Billing', 'internal', 'none'],
  ['console', 'Hemia Console', 'internal', 'none'],
  ['docs', 'Hemia Docs', 'internal', 'event_driven'],
  ['horus', 'Horus', 'internal', 'event_driven'],
  ['helpdesk', 'Hemia Helpdesk', 'internal', 'event_driven'],
  ['cdn', 'Hemia CDN', 'internal', 'event_driven'],
  ['legal', 'Hemia Legal', 'internal', 'none'],
  ['loop', 'Hemia Loop', 'customer', 'event_driven'],
  ['automate', 'Hemia Automate', 'internal', 'event_driven'],
  ['agents', 'Hemia Agents', 'mixed', 'event_driven'],
] as const;

export async function seedInitialAccess(dataSource: DataSource) {
  await dataSource.transaction(async (manager) => {
    const permissionRepository = manager.getRepository(Permission);
    const roleRepository = manager.getRepository(Role);

    for (const code of permissions) {
      await permissionRepository
        .createQueryBuilder()
        .insert()
        .values({
          code,
          name: code,
          description: code,
          scope: code.startsWith('organization.') ? 'organization' : 'platform',
          status: 'active',
        })
        .orIgnore()
        .execute();
    }

    const newRoles = new Set<string>();
    for (const [code, scope] of roles) {
      const inserted = await roleRepository
        .createQueryBuilder()
        .insert()
        .values({
          code,
          name: code,
          description: code,
          scope,
          status: 'active',
          isSystem: true,
          organizationId: null,
        })
        .orIgnore()
        .returning('id')
        .execute();
      if (Array.isArray(inserted.raw) && inserted.raw.length)
        newRoles.add(code);
    }

    for (const [roleCode, permissionCodes] of Object.entries(matrix)) {
      if (!newRoles.has(roleCode)) continue;
      const role = await roleRepository.findOneByOrFail({
        code: roleCode,
        organizationId: IsNull(),
      });
      for (const permissionCode of permissionCodes) {
        const permission = await permissionRepository.findOneByOrFail({
          code: permissionCode,
        });
        await manager
          .getRepository(RolePermission)
          .createQueryBuilder()
          .insert()
          .values({ roleId: role.id, permissionId: permission.id })
          .orIgnore()
          .execute();
      }
    }

    const productRepository = manager.getRepository(Product);
    for (const [code, name, audience, provisioningMode] of products) {
      await productRepository
        .createQueryBuilder()
        .insert()
        .values({
          code,
          name,
          audience,
          provisioningMode,
          status: 'active',
          metadata: {},
        })
        .orIgnore()
        .execute();
    }

    const organizationRepository = manager.getRepository(Organization);
    // Existing organizations keep their bootstrap grants and removed relations untouched.
    if (await organizationRepository.existsBy({ code: 'hemia' })) return;

    const adminIssuer =
      process.env.SEED_ADMIN_ISSUER ?? 'http://localhost:4000';
    const adminSubject = process.env.SEED_ADMIN_SUBJECT_ID ?? 'seed-admin';
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@hemia.mx';
    const identityRepository = manager.getRepository(IdentityReference);
    await identityRepository
      .createQueryBuilder()
      .insert()
      .values({
        issuer: adminIssuer,
        subjectId: adminSubject,
        identityType: 'workforce_user',
        emailSnapshot: adminEmail,
        displayNameSnapshot: 'Hemia Admin',
        avatarUrlSnapshot: null,
        status: 'active',
        lastSyncedAt: new Date(),
      })
      .orIgnore()
      .execute();
    const adminIdentity = await identityRepository.findOneByOrFail({
      issuer: adminIssuer,
      subjectId: adminSubject,
    });

    await organizationRepository.insert({
      code: 'hemia',
      slug: 'hemia',
      name: 'Hemia',
      legalName: null,
      type: 'internal',
      status: 'active',
      countryCode: 'MX',
      timezone: 'America/Mexico_City',
      metadata: {},
      createdByIdentityId: adminIdentity.id,
      updatedByIdentityId: adminIdentity.id,
    });
    const hemia = await organizationRepository.findOneByOrFail({
      code: 'hemia',
    });

    await manager.getRepository(Membership).insert({
      organizationId: hemia.id,
      identityReferenceId: adminIdentity.id,
      status: 'active',
      membershipType: 'owner',
      joinedAt: new Date(),
      metadata: {},
      createdByIdentityId: adminIdentity.id,
      updatedByIdentityId: adminIdentity.id,
    });
    const membership = await manager.getRepository(Membership).findOneByOrFail({
      organizationId: hemia.id,
      identityReferenceId: adminIdentity.id,
    });

    for (const code of ['platform_super_admin', 'organization_owner']) {
      const role = await roleRepository.findOneByOrFail({
        code,
        organizationId: IsNull(),
      });
      await manager.getRepository(MembershipRole).insert({
        membershipId: membership.id,
        roleId: role.id,
        assignedByIdentityId: adminIdentity.id,
      });
    }

    for (const [code] of products) {
      const product = await productRepository.findOneByOrFail({ code });
      await manager.getRepository(OrganizationProduct).insert({
        organizationId: hemia.id,
        productId: product.id,
        status: 'enabled',
        source: 'internal',
        configuration: {},
        enabledAt: new Date(),
        createdByIdentityId: adminIdentity.id,
        updatedByIdentityId: adminIdentity.id,
      });
    }
  });
}
