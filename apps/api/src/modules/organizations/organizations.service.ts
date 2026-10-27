import {
  readableOrganizationIds,
  requireReadableOrganization,
} from '../../common/auth/readable-organizations';
import {
  protectInternalOrganization,
  requirePlatformAdministrator,
} from '../../common/auth/platform-administration';
import { invalidateAuthorization } from '../access-context/authorization/invalidate-authorization';
import { AccessContextCacheService } from '../access-context/cache/access-context-cache.service';
import { SetOrganizationTypeDto } from './dtos/set-organization-type.dto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, Repository, In } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { UpdateOrganizationDto } from './dtos/update-organization.dto';
import {
  Organization,
  OrganizationStatus,
  OrganizationType,
} from './entities/organization.entity';

type FindAllInput = {
  status?: OrganizationStatus;
  type?: OrganizationType;
  search?: string;
  limit?: string;
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Organization)
    private readonly repository: Repository<Organization>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  async create(actor: AccessActor, dto: CreateOrganizationDto) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        if (dto.type === 'internal')
          await requirePlatformAdministrator(manager, actor);
        const repository = manager.getRepository(Organization);
        const organization = await repository.save(
          repository.create({
            code: dto.code,
            slug: dto.slug,
            name: dto.name,
            legalName: dto.legalName ?? null,
            type: dto.type,
            status: dto.status ?? 'pending',
            countryCode: dto.countryCode ?? null,
            timezone: dto.timezone ?? null,
            metadata: dto.metadata ?? {},
            createdByIdentityId: actor.identityReferenceId,
            updatedByIdentityId: actor.identityReferenceId,
          }),
        );
        await this.audit.record(manager, {
          organizationId: organization.id,
          actor,
          action: 'organization.create',
          resourceType: 'organization',
          resourceId: organization.id,
          after: organization as unknown as Record<string, unknown>,
        });
        await this.outbox.record(manager, {
          type: 'access.organization.created.v1',
          aggregateType: 'organization',
          aggregateId: organization.id,
          actor,
          subject: `organizations/${organization.id}`,
          data: {
            organization_id: organization.id,
            organization_name: organization.name,
            status: organization.status,
          },
        });
        return organization;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new AccessError(
          'ACCESS_CONFLICT',
          'Organization code or active slug already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findAll(input: FindAllInput, actor: AccessActor) {
    const ids = await readableOrganizationIds(
      this.dataSource,
      actor,
      'organization.read',
    );
    if (ids?.length === 0) return [];

    const take = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const where = {
      ...(ids === null ? {} : { id: In(ids) }),
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.search ? { name: ILike(`%${input.search}%`) } : {}),
    };

    return this.repository.find({
      where,
      order: { createdAt: 'DESC' },
      take,
    });
  }

  async findOneVisible(id: string, actor: AccessActor) {
    requireReadableOrganization(
      await readableOrganizationIds(
        this.dataSource,
        actor,
        'organization.read',
      ),
      id,
    );
    return this.findOne(id);
  }

  async findOne(id: string) {
    const organization = await this.repository.findOne({ where: { id } });
    if (!organization) {
      throw new AccessError(
        'ACCESS_ORGANIZATION_NOT_FOUND',
        'Organization not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return organization;
  }

  async update(actor: AccessActor, id: string, dto: UpdateOrganizationDto) {
    if (Object.prototype.hasOwnProperty.call(dto, 'type')) {
      throw new AccessError(
        'ACCESS_FORBIDDEN',
        'Use the platform classification endpoint to change type',
        HttpStatus.FORBIDDEN,
      );
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Organization);
        const organization = await protectInternalOrganization(
          manager,
          actor,
          id,
        );
        if (!organization) {
          throw new AccessError(
            'ACCESS_ORGANIZATION_NOT_FOUND',
            'Organization not found',
            HttpStatus.NOT_FOUND,
          );
        }
        const before = { ...organization };
        Object.assign(organization, {
          code: dto.code ?? organization.code,
          slug: dto.slug ?? organization.slug,
          name: dto.name ?? organization.name,
          legalName: dto.legalName ?? organization.legalName,
          countryCode: dto.countryCode ?? organization.countryCode,
          timezone: dto.timezone ?? organization.timezone,
          metadata: dto.metadata ?? organization.metadata,
          updatedByIdentityId: actor.identityReferenceId,
          version: organization.version + 1,
        });
        const saved = await repository.save(organization);
        await this.audit.record(manager, {
          organizationId: saved.id,
          actor,
          action: 'organization.update',
          resourceType: 'organization',
          resourceId: saved.id,
          before: before,
          after: saved as unknown as Record<string, unknown>,
        });
        await this.outbox.record(manager, {
          type: 'access.organization.updated.v1',
          aggregateType: 'organization',
          aggregateId: saved.id,
          actor,
          subject: `organizations/${saved.id}`,
          data: {
            organization_id: saved.id,
            organization_name: saved.name,
            status: saved.status,
          },
        });
        return saved;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new AccessError(
          'ACCESS_CONFLICT',
          'Organization code or active slug already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async setStatus(actor: AccessActor, id: string, status: OrganizationStatus) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Organization);
      const organization = await protectInternalOrganization(
        manager,
        actor,
        id,
      );
      if (!organization) {
        throw new AccessError(
          'ACCESS_ORGANIZATION_NOT_FOUND',
          'Organization not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const before = { ...organization };
      organization.status = status;
      organization.updatedByIdentityId = actor.identityReferenceId;
      organization.version += 1;
      const saved = await repository.save(organization);
      const verb = status === 'active' ? 'activated' : status;
      await this.audit.record(manager, {
        organizationId: saved.id,
        actor,
        action: `organization.${status === 'active' ? 'activate' : status}`,
        resourceType: 'organization',
        resourceId: saved.id,
        before: before,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: `access.organization.${verb}.v1`,
        aggregateType: 'organization',
        aggregateId: saved.id,
        actor,
        subject: `organizations/${saved.id}`,
        data: {
          organization_id: saved.id,
          organization_name: saved.name,
          status: saved.status,
        },
      });
      const identities = await this.invalidateEligibility(manager, actor, id);
      return { organization: saved, identities };
    });
    await Promise.all(
      result.identities.map((id) =>
        this.contextCache.del(this.contextCache.key(id)),
      ),
    );
    return result.organization;
  }

  async archive(actor: AccessActor, id: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Organization);
      const organization = await protectInternalOrganization(
        manager,
        actor,
        id,
      );
      if (!organization) {
        throw new AccessError(
          'ACCESS_ORGANIZATION_NOT_FOUND',
          'Organization not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const before = { ...organization };
      organization.status = 'archived';
      organization.archivedAt = new Date();
      organization.updatedByIdentityId = actor.identityReferenceId;
      organization.version += 1;
      const saved = await repository.save(organization);
      await this.audit.record(manager, {
        organizationId: saved.id,
        actor,
        action: 'organization.archive',
        resourceType: 'organization',
        resourceId: saved.id,
        before: before,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: 'access.organization.archived.v1',
        aggregateType: 'organization',
        aggregateId: saved.id,
        actor,
        subject: `organizations/${saved.id}`,
        data: {
          organization_id: saved.id,
          organization_name: saved.name,
          status: saved.status,
        },
      });
      const identities = await this.invalidateEligibility(manager, actor, id);
      return { organization: saved, identities };
    });
    await Promise.all(
      result.identities.map((id) =>
        this.contextCache.del(this.contextCache.key(id)),
      ),
    );
    return result.organization;
  }

  async setType(actor: AccessActor, id: string, dto: SetOrganizationTypeDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      await requirePlatformAdministrator(manager, actor);
      const repository = manager.getRepository(Organization);
      const organization = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!organization)
        throw new AccessError(
          'ACCESS_ORGANIZATION_NOT_FOUND',
          'Organization not found',
          HttpStatus.NOT_FOUND,
        );
      if (organization.version !== dto.version)
        throw new AccessError(
          'ACCESS_CONFLICT',
          'Organization version conflict',
          HttpStatus.CONFLICT,
        );
      if (organization.type === dto.type)
        return { organization, identities: [] as string[] };
      const before = { ...organization };
      organization.type = dto.type;
      organization.version += 1;
      organization.updatedByIdentityId = actor.identityReferenceId;
      const saved = await repository.save(organization);
      const identities = await this.invalidateEligibility(manager, actor, id);
      await this.audit.record(manager, {
        organizationId: id,
        actor,
        action: 'organization.classification.change',
        resourceType: 'organization',
        resourceId: id,
        before: before,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: 'access.organization.eligibility_changed.v1',
        aggregateType: 'organization',
        aggregateId: id,
        actor,
        data: {
          organization_id: id,
          previous_type: before.type,
          type: saved.type,
          eligible_internal: saved.type === 'internal',
          organization_version: saved.version,
        },
      });
      return { organization: saved, identities };
    });
    // Durable invalidation events were committed above. Never delete before commit.
    await Promise.all(
      result.identities.map((id) =>
        this.contextCache.del(this.contextCache.key(id)),
      ),
    );
    return result.organization;
  }

  private async invalidateEligibility(
    manager: EntityManager,
    actor: AccessActor,
    organizationId: string,
  ) {
    const rows = await invalidateAuthorization(manager, this.outbox, actor, {
      organizationId,
    });
    return [...new Set(rows.map((row) => row.identity_reference_id))];
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
