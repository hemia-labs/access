import { IsNull } from 'typeorm';
import { AppDataSource } from '../../../data-source';
import { IdentityReference } from '../../modules/identity-references/entities/identity-reference.entity';
import { Membership } from '../../modules/memberships/entities/membership.entity';
import { Organization } from '../../modules/organizations/entities/organization.entity';
import { Permission } from '../../modules/roles/entities/permission.entity';
import { MembershipRole } from '../../modules/roles/entities/membership-role.entity';
import { RolePermission } from '../../modules/roles/entities/role-permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { OrganizationProduct } from '../../modules/products/entities/organization-product.entity';
import { Product } from '../../modules/products/entities/product.entity';

const permissions = [
  '*',
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
  'policy.read',
  'policy.manage',
  'audit.read',
];

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
    'policy.read',
    'audit.read',
  ],
  platform_auditor: [
    'organization.read',
    'membership.read',
    'role.read',
    'product_access.read',
    'policy.read',
    'audit.read',
  ],
  organization_owner: permissions,
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
    'policy.read',
    'policy.manage',
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
  ['billing', 'Hemia Billing', 'internal', 'event_driven'],
  ['console', 'Hemia Console', 'internal', 'none'],
  ['docs', 'Hemia Docs', 'internal', 'event_driven'],
  ['horus', 'Horus', 'internal', 'event_driven'],
  ['helpdesk', 'Hemia Helpdesk', 'internal', 'event_driven'],
  ['cdn', 'Hemia CDN', 'internal', 'event_driven'],
  ['legal', 'Hemia Legal', 'internal', 'event_driven'],
  ['loop', 'Hemia Loop', 'customer', 'event_driven'],
  ['automate', 'Hemia Automate', 'internal', 'event_driven'],
  ['agents', 'Hemia Agents', 'mixed', 'event_driven'],
] as const;

async function run() {
  const dataSource = await AppDataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      const permissionRepository = manager.getRepository(Permission);
      const roleRepository = manager.getRepository(Role);

      for (const code of permissions) {
        await permissionRepository.upsert(
          {
            code,
            name: code,
            description: code,
            scope: code.startsWith('organization.') ? 'organization' : 'platform',
            status: 'active',
          },
          ['code'],
        );
      }

      for (const [code, scope] of roles) {
        const existing = await roleRepository.findOneBy({
          code,
          organizationId: IsNull(),
        });
        if (existing) {
          await roleRepository.save({
            ...existing,
            name: code,
            description: code,
            scope,
            status: 'active',
            isSystem: true,
          });
        } else {
          await roleRepository.save(
            roleRepository.create({
              code,
              name: code,
              description: code,
              scope,
              status: 'active',
              isSystem: true,
              organizationId: null,
            }),
          );
        }
      }

      for (const [roleCode, permissionCodes] of Object.entries(matrix)) {
        const role = await roleRepository.findOneByOrFail({
          code: roleCode,
          organizationId: IsNull(),
        });
        for (const permissionCode of permissionCodes) {
          const permission = await permissionRepository.findOneByOrFail({
            code: permissionCode,
          });
          await manager.getRepository(RolePermission).upsert(
            { roleId: role.id, permissionId: permission.id },
            ['roleId', 'permissionId'],
          );
        }
      }

      const adminIssuer =
        process.env.SEED_ADMIN_ISSUER ?? 'http://localhost:4000';
      const adminSubject = process.env.SEED_ADMIN_SUBJECT_ID ?? 'seed-admin';
      const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@hemia.mx';
      const identityRepository = manager.getRepository(IdentityReference);
      await identityRepository.upsert(
        {
          issuer: adminIssuer,
          subjectId: adminSubject,
          identityType: 'workforce_user',
          emailSnapshot: adminEmail,
          displayNameSnapshot: 'Hemia Admin',
          avatarUrlSnapshot: null,
          status: 'active',
          lastSyncedAt: new Date(),
        },
        ['issuer', 'subjectId'],
      );
      const adminIdentity = await identityRepository.findOneByOrFail({
        issuer: adminIssuer,
        subjectId: adminSubject,
      });

      const organizationRepository = manager.getRepository(Organization);
      await organizationRepository.upsert(
        {
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
        },
        ['code'],
      );
      const hemia = await organizationRepository.findOneByOrFail({
        code: 'hemia',
      });

      await manager.getRepository(Membership).upsert(
        {
          organizationId: hemia.id,
          identityReferenceId: adminIdentity.id,
          status: 'active',
          membershipType: 'owner',
          joinedAt: new Date(),
          metadata: {},
          createdByIdentityId: adminIdentity.id,
          updatedByIdentityId: adminIdentity.id,
        },
        ['organizationId', 'identityReferenceId'],
      );
      const membership = await manager.getRepository(Membership).findOneByOrFail({
        organizationId: hemia.id,
        identityReferenceId: adminIdentity.id,
      });

      for (const code of ['platform_super_admin', 'organization_owner']) {
        const role = await roleRepository.findOneByOrFail({
          code,
          organizationId: IsNull(),
        });
        await manager.getRepository(MembershipRole).upsert(
          {
            membershipId: membership.id,
            roleId: role.id,
            assignedByIdentityId: adminIdentity.id,
          },
          ['membershipId', 'roleId'],
        );
      }

      const productRepository = manager.getRepository(Product);
      for (const [code, name, audience, provisioningMode] of products) {
        await productRepository.upsert(
          {
            code,
            name,
            audience,
            provisioningMode,
            status: 'active',
            metadata: {},
          },
          ['code'],
        );
        const product = await productRepository.findOneByOrFail({ code });
        await manager.getRepository(OrganizationProduct).upsert(
          {
            organizationId: hemia.id,
            productId: product.id,
            status: 'enabled',
            source: 'internal',
            configuration: {},
            enabledAt: new Date(),
            createdByIdentityId: adminIdentity.id,
            updatedByIdentityId: adminIdentity.id,
          },
          ['organizationId', 'productId'],
        );
      }
    });
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
