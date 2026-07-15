import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { AccessContextCacheService } from '../access-context/access-context-cache.service';
import { AuditService } from '../audit/audit.service';
import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OutboxService } from '../outbox/outbox.service';
import { CreateProductDto, EnableProductDto, ProductInstanceDto, UpdateProductDto } from './dtos/product.dto';
import { OrganizationProduct, OrganizationProductStatus } from './entities/organization-product.entity';
import { OrganizationProductInstance } from './entities/organization-product-instance.entity';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(OrganizationProduct)
    private readonly organizationProducts: Repository<OrganizationProduct>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  findAll() {
    return this.products.find({ order: { code: 'ASC' } });
  }

  async findOne(code: string) {
    const product = await this.products.findOneBy({ code });
    if (!product) throw this.notFound('Product not found');
    return product;
  }

  create(dto: CreateProductDto) {
    return this.products.save(
      this.products.create({
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        audience: dto.audience ?? 'internal',
        provisioningMode: dto.provisioning_mode ?? 'none',
        metadata: dto.metadata ?? {},
        status: 'active',
      }),
    );
  }

  async update(code: string, dto: UpdateProductDto) {
    const product = await this.findOne(code);
    product.name = dto.name ?? product.name;
    product.description = dto.description ?? product.description;
    product.audience = dto.audience ?? product.audience;
    product.provisioningMode = dto.provisioning_mode ?? product.provisioningMode;
    product.status = dto.status ?? product.status;
    product.metadata = dto.metadata ?? product.metadata;
    return this.products.save(product);
  }

  findOrganizationProducts(organizationId: string) {
    return this.organizationProducts.find({
      where: { organizationId },
      relations: { product: true },
      order: { createdAt: 'DESC' },
    });
  }

  enable(actor: AccessActor, organizationId: string, productCode: string, dto: EnableProductDto) {
    return this.setProductAccess(actor, organizationId, productCode, 'enable', dto);
  }

  suspend(actor: AccessActor, organizationId: string, productCode: string) {
    return this.setProductAccess(actor, organizationId, productCode, 'suspended', {});
  }

  activate(actor: AccessActor, organizationId: string, productCode: string) {
    return this.setProductAccess(actor, organizationId, productCode, 'enabled', {});
  }

  disable(actor: AccessActor, organizationId: string, productCode: string) {
    return this.setProductAccess(actor, organizationId, productCode, 'disabled', {});
  }

  async recordInstance(actor: AccessActor, dto: ProductInstanceDto) {
    return this.dataSource.transaction(async (manager) => {
      const organizationProduct = await manager
        .getRepository(OrganizationProduct)
        .createQueryBuilder('organizationProduct')
        .innerJoinAndSelect('organizationProduct.product', 'product')
        .where('organizationProduct.organization_id = :organizationId', {
          organizationId: dto.organization_id,
        })
        .andWhere('product.code = :productCode', { productCode: dto.product_code })
        .getOne();
      if (!organizationProduct) throw this.notFound('Organization product not found');

      const instanceRepository = manager.getRepository(OrganizationProductInstance);
      let instance = await instanceRepository.findOneBy({
        organizationProductId: organizationProduct.id,
      });
      instance ??= instanceRepository.create({
        organizationProductId: organizationProduct.id,
      });
      instance.externalTenantId = dto.external_tenant_id ?? instance.externalTenantId ?? null;
      instance.status = dto.status;
      instance.metadata = dto.metadata ?? {};
      instance.lastVerifiedAt = new Date();
      if (dto.status === 'ready') instance.provisionedAt ??= new Date();
      const savedInstance = await instanceRepository.save(instance);

      organizationProduct.status = dto.status === 'ready' ? 'enabled' : 'failed';
      organizationProduct.enabledAt =
        dto.status === 'ready' ? new Date() : organizationProduct.enabledAt;
      organizationProduct.updatedByIdentityId = actor.identityReferenceId;
      organizationProduct.version += 1;
      const savedProduct = await manager
        .getRepository(OrganizationProduct)
        .save(organizationProduct);

      await this.audit.record(manager, {
        organizationId: dto.organization_id,
        actor,
        action: `organization_product.${dto.status}`,
        resourceType: 'organization_product',
        resourceId: savedProduct.id,
        after: savedProduct as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: `access.organization_product.${dto.status === 'ready' ? 'enabled' : 'failed'}.v1`,
        aggregateType: 'organization_product',
        aggregateId: savedProduct.id,
        actor,
        data: {
          organization_id: dto.organization_id,
          product_code: dto.product_code,
          external_tenant_id: savedInstance.externalTenantId,
          status: savedProduct.status,
        },
      });
      await this.invalidateOrganizationMembers(manager, dto.organization_id);
      return savedInstance;
    });
  }

  private async setProductAccess(
    actor: AccessActor,
    organizationId: string,
    productCode: string,
    action: 'enable' | OrganizationProductStatus,
    dto: EnableProductDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const organization = await manager.getRepository(Organization).findOneBy({ id: organizationId });
      if (!organization) throw this.notFound('Organization not found');
      const product = await manager.getRepository(Product).findOneBy({ code: productCode });
      if (!product || product.status !== 'active') throw this.notFound('Product not found');

      const repository = manager.getRepository(OrganizationProduct);
      let organizationProduct = await repository.findOneBy({
        organizationId,
        productId: product.id,
      });
      organizationProduct ??= repository.create({
        organizationId,
        productId: product.id,
        createdByIdentityId: actor.identityReferenceId,
      });

      const before = { ...organizationProduct };
      if (action === 'enable') {
        organizationProduct.status =
          product.provisioningMode === 'none' ? 'enabled' : 'provisioning';
        organizationProduct.source = dto.source ?? 'manual';
        organizationProduct.entitlementReference =
          dto.entitlement_reference ?? organizationProduct.entitlementReference ?? null;
        organizationProduct.configuration = dto.configuration ?? organizationProduct.configuration ?? {};
        if (organizationProduct.status === 'enabled') organizationProduct.enabledAt = new Date();
      } else {
        organizationProduct.status = action;
        if (action === 'enabled') organizationProduct.enabledAt = new Date();
        if (action === 'suspended') organizationProduct.suspendedAt = new Date();
        if (action === 'disabled') organizationProduct.disabledAt = new Date();
      }
      organizationProduct.updatedByIdentityId = actor.identityReferenceId;
      organizationProduct.version = (organizationProduct.version ?? 0) + 1;
      const saved = await repository.save(organizationProduct);

      const verb = action === 'enable' ? (saved.status === 'enabled' ? 'enabled' : 'provisioning') : action;
      await this.audit.record(manager, {
        organizationId,
        actor,
        action: `organization_product.${verb}`,
        resourceType: 'organization_product',
        resourceId: saved.id,
        before: before as Record<string, unknown>,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type:
          action === 'enable'
            ? 'access.organization_product.enable_requested.v1'
            : `access.organization_product.${verb}.v1`,
        aggregateType: 'organization_product',
        aggregateId: saved.id,
        actor,
        data: { organization_id: organizationId, product_code: productCode, status: saved.status },
      });
      await this.invalidateOrganizationMembers(manager, organizationId);
      return saved;
    });
  }

  private async invalidateOrganizationMembers(manager: import('typeorm').EntityManager, organizationId: string) {
    const memberships = await manager.getRepository(Membership).find({
      where: { organizationId, status: 'active' },
      select: { identityReferenceId: true },
    });
    await Promise.all(
      memberships.map((membership) =>
        this.contextCache.del(this.contextCache.key(membership.identityReferenceId)),
      ),
    );
  }

  private notFound(message: string) {
    return new AccessError('ACCESS_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}
