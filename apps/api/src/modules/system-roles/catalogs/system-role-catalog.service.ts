import { legalRoleCatalog, legalRoleCatalogV2 } from './legal-role-catalog';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { requirePlatformAdministrator } from '../../../common/auth/platform-administration';
import { AccessError } from '../../../common/errors/access-error';
import { AuditService } from '../../audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';
import { billingRoleCatalog } from './billing-role-catalog';

type Catalog = {
  product_code: string;
  scope_profile: string;
  contract_version: number;
  catalog_version: number;
  roles: ReadonlyArray<{
    code: string;
    name: string;
    allowed_scopes: ReadonlyArray<{
      scope_type: string;
      consumer_scope_type: string;
    }>;
  }>;
};
type StoredRole = {
  id: string;
  code: string;
  name: string;
  contract_version: number;
  scope_profile: string;
  scopes: string[];
  status: string;
  sealed: boolean;
};
const billingCatalog: Catalog = {
  ...billingRoleCatalog,
  scope_profile: 'billing_v1',
  roles: billingRoleCatalog.roles.map((role) => ({
    ...role,
    allowed_scopes: role.allowed_scopes.map((scope_type: string) => ({
      scope_type,
      consumer_scope_type: 'not_applicable',
    })),
  })),
};
const availableCatalogs: Catalog[] = [
  billingCatalog,
  legalRoleCatalog,
  legalRoleCatalogV2,
];

function matches(catalog: Catalog, roles: StoredRole[]): boolean {
  return (
    roles.length === catalog.roles.length &&
    catalog.roles.every((expected) => {
      const row = roles.find((role) => role.code === expected.code);
      return (
        row?.name === expected.name &&
        row.scope_profile === catalog.scope_profile &&
        row.contract_version === catalog.contract_version &&
        row.status === 'active' &&
        row.sealed &&
        JSON.stringify(row.scopes) ===
          JSON.stringify(
            expected.allowed_scopes
              .map(
                (scope) => scope.scope_type + ':' + scope.consumer_scope_type,
              )
              .sort(),
          )
      );
    })
  );
}

@Injectable()
export class SystemRoleCatalogService {
  constructor(
    private readonly database: DataSource,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  registerBilling(actor: AccessActor, body: unknown) {
    return this.register(actor, body, billingCatalog);
  }
  registerLegal(actor: AccessActor, body: unknown) {
    return this.register(actor, body, legalRoleCatalog);
  }
  registerLegalV2(actor: AccessActor, body: unknown) {
    return this.register(actor, body, legalRoleCatalogV2);
  }
  list(actor: AccessActor) {
    return this.database.transaction(async (manager) => {
      await requirePlatformAdministrator(manager, actor);
      const products = await manager.query<
        Array<{ id: string; code: string; name: string; status: string }>
      >('SELECT id,code,name,status FROM products WHERE code=ANY($1::text[])', [
        [...new Set(availableCatalogs.map((catalog) => catalog.product_code))],
      ]);
      const output: Array<{
        productCode: string;
        name: string;
        version: number;
        contractVersion: number;
        publicationStatus: string;
        roles: Array<{
          code: string;
          name: string;
          allowedScopes: Array<{ resource: string; consumer: string }>;
        }>;
      }> = [];
      for (const catalog of availableCatalogs) {
        const product = products.find(
          (row) => row.code === catalog.product_code,
        );
        const stored = product
          ? await this.storedRoles(manager, product.id, catalog.catalog_version)
          : [];
        const publicationStatus =
          !product || product.status !== 'active'
            ? 'unavailable'
            : stored.length
              ? matches(catalog, stored)
                ? 'published'
                : 'conflict'
              : 'pending';
        output.push({
          productCode: catalog.product_code,
          name: product?.name || catalog.product_code,
          version: catalog.catalog_version,
          contractVersion: catalog.contract_version,
          publicationStatus,
          roles: catalog.roles.map((role) => ({
            code: role.code,
            name: role.name,
            allowedScopes: role.allowed_scopes.map((scope) => ({
              resource: scope.scope_type,
              consumer: scope.consumer_scope_type,
            })),
          })),
        });
      }
      return output;
    });
  }
  private storedRoles(
    manager: EntityManager,
    productId: string,
    version: number,
  ): Promise<StoredRole[]> {
    return manager.query(
      `SELECT r.*, ARRAY(SELECT scope_type || ':' || consumer_scope_type FROM system_role_scopes WHERE role_id=r.id ORDER BY scope_type,consumer_scope_type) AS scopes FROM system_roles r WHERE product_id=$1 AND catalog_version=$2`,
      [productId, version],
    );
  }
  private register(actor: AccessActor, body: unknown, catalog: Catalog) {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new AccessError(
        'ACCESS_INVALID_REQUEST',
        'Catalog is an immutable publication artifact; body must be empty',
        400,
      );
    return this.database.transaction(async (manager) => {
      await requirePlatformAdministrator(manager, actor);
      const [product] = await manager.query<Array<{ id: string }>>(
        "SELECT id FROM products WHERE code=$1 AND status='active' FOR UPDATE",
        [catalog.product_code],
      );
      if (!product)
        throw new AccessError(
          'ACCESS_NOT_FOUND',
          'Active product required',
          404,
        );
      const roles = await this.storedRoles(
        manager,
        product.id,
        catalog.catalog_version,
      );
      if (roles.length) {
        if (!matches(catalog, roles))
          throw new AccessError(
            'ACCESS_CONFLICT',
            'Stored catalog differs from the versioned publication artifact',
            409,
          );
        return {
          catalogVersion: catalog.catalog_version,
          roles: catalog.roles.map((expected) => {
            const row = roles.find((role) => role.code === expected.code)!;
            return { id: row.id, code: row.code };
          }),
          replayed: true,
        };
      }
      const created: Array<{ id: string; code: string }> = [];
      for (const role of catalog.roles) {
        const [row] = await manager.query<Array<{ id: string; code: string }>>(
          'INSERT INTO system_roles(product_id,code,name,contract_version,catalog_version,scope_profile) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,code',
          [
            product.id,
            role.code,
            role.name,
            catalog.contract_version,
            catalog.catalog_version,
            catalog.scope_profile,
          ],
        );
        await manager.query(
          'INSERT INTO system_role_scopes(role_id,scope_type,consumer_scope_type,scope_profile) SELECT $1,s,c,$4 FROM unnest($2::text[],$3::text[]) x(s,c)',
          [
            row.id,
            role.allowed_scopes.map((s) => s.scope_type),
            role.allowed_scopes.map((s) => s.consumer_scope_type),
            catalog.scope_profile,
          ],
        );
        created.push(row);
      }
      await this.audit.record(manager, {
        actor,
        action: 'system_role_catalog.register',
        resourceType: 'product',
        resourceId: product.id,
        after: { catalog_version: catalog.catalog_version, roles: created },
      });
      await this.outbox.record(manager, {
        actor,
        type: 'access.system_role_catalog.registered.v1',
        aggregateType: 'product',
        aggregateId: product.id,
        data: {
          product_code: catalog.product_code,
          catalog_version: catalog.catalog_version,
          roles: created,
        },
      });
      return {
        catalogVersion: catalog.catalog_version,
        roles: created,
        replayed: false,
      };
    });
  }
}
