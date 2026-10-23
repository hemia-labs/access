import { Injectable } from '@nestjs/common';
import { PermanentError, type EventEnvelope } from '@hemia/event-bus';
import { DataSource } from 'typeorm';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { AccessContextCacheService } from '../../access-context/cache/access-context-cache.service';
import { AuditService } from '../../audit/audit.service';
import { Membership } from '../../memberships/entities/membership.entity';
import { OrganizationProduct } from '../../products/entities/organization-product.entity';
import { OrganizationProductInstance } from '../../products/entities/organization-product-instance.entity';
import { OutboxService } from '../../outbox/outbox.service';
import { AccessEventInbox } from '../entities/access-event-inbox.entity';
import {
  LegalProvisioningResult,
  validateLegalProvisioningResult,
} from './access-event.contracts';

@Injectable()
export class AccessProvisioningEventsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  async consume(event: EventEnvelope<LegalProvisioningResult>) {
    const data = validateLegalProvisioningResult(event.type, event.data);
    if (data.product_code !== 'legal') return;

    await this.dataSource.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(AccessEventInbox)
        .values({
          eventId: event.id,
          eventType: event.type,
          correlationId: event.correlationId,
        })
        .orIgnore()
        .execute();
      if (!inserted.identifiers.length) return;

      const organizationProduct = await manager
        .getRepository(OrganizationProduct)
        .createQueryBuilder('organizationProduct')
        .innerJoinAndSelect('organizationProduct.product', 'product')
        .innerJoinAndSelect('organizationProduct.organization', 'organization')
        .where('organizationProduct.organization_id = :organizationId', {
          organizationId: data.organization_id,
        })
        .andWhere('product.code = :productCode', { productCode: 'legal' })
        .getOne();
      if (!organizationProduct) {
        throw new PermanentError('Legal organization product not found');
      }

      const success = data.provisioning_status === 'ready';
      const instanceRepository = manager.getRepository(
        OrganizationProductInstance,
      );
      let instance = await instanceRepository.findOneBy({
        organizationProductId: organizationProduct.id,
      });
      instance ??= instanceRepository.create({
        organizationProductId: organizationProduct.id,
      });
      instance.externalTenantId =
        data.external_tenant_id ?? instance.externalTenantId ?? null;
      instance.status = success ? 'ready' : 'failed';
      instance.lastVerifiedAt = new Date();
      if (success) instance.provisionedAt ??= new Date();
      instance.metadata = {
        ...instance.metadata,
        tenant_status: data.tenant_status ?? null,
        tenant_version: data.tenant_version ?? null,
        ...(success
          ? {}
          : {
              failure_code: data.failure_code ?? null,
              failure_reason: data.failure_reason?.slice(0, 1000) ?? null,
            }),
      };
      const savedInstance = await instanceRepository.save(instance);

      const before = { ...organizationProduct };
      organizationProduct.status = success ? 'enabled' : 'failed';
      if (success) organizationProduct.enabledAt ??= new Date();
      organizationProduct.version = (organizationProduct.version ?? 0) + 1;
      const savedProduct = await manager
        .getRepository(OrganizationProduct)
        .save(organizationProduct);

      const actor = this.serviceActor(savedProduct.updatedByIdentityId);
      await this.audit.record(manager, {
        organizationId: data.organization_id,
        actor,
        action: `organization_product.${success ? 'enabled' : 'failed'}`,
        resourceType: 'organization_product',
        resourceId: savedProduct.id,
        before,
        after: savedProduct as unknown as Record<string, unknown>,
        correlationId: event.correlationId,
        metadata: {
          source_event_id: event.id,
          source_event_type: event.type,
        },
      });
      await this.outbox.record(manager, {
        type: `access.organization_product.${success ? 'enabled' : 'failed'}.v1`,
        aggregateType: 'organization_product',
        aggregateId: savedProduct.id,
        actor,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
        subject:
          event.subject ??
          `organizations/${data.organization_id}/products/${data.product_code}`,
        data: {
          organization_id: data.organization_id,
          product_code: data.product_code,
          organization_name: organizationProduct.organization.name,
          status: savedProduct.status,
          provisioning_status: success ? 'ready' : 'failed',
          external_tenant_id: savedInstance.externalTenantId,
        },
      });

      const memberships = await manager.getRepository(Membership).find({
        where: { organizationId: data.organization_id, status: 'active' },
        select: { identityReferenceId: true },
      });
      await Promise.all(
        memberships.map((membership) =>
          this.contextCache.del(
            this.contextCache.key(membership.identityReferenceId),
          ),
        ),
      );
    });
  }

  private serviceActor(identityReferenceId: string): AccessActor {
    return {
      identityReferenceId,
      issuer: 'urn:hemia:service:hemia-legal',
      subjectId: 'hemia-legal',
      identityType: 'service_account',
    };
  }
}
