import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
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
  ) {}

  async create(actor: AccessActor, dto: CreateOrganizationDto) {
    try {
      return await this.dataSource.transaction(async (manager) => {
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
          data: { organization_id: organization.id, status: organization.status },
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

  findAll(input: FindAllInput) {
    const take = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const where = {
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
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Organization);
        const organization = await repository.findOneBy({ id });
        if (!organization) {
          throw new AccessError(
            'ACCESS_ORGANIZATION_NOT_FOUND',
            'Organization not found',
            HttpStatus.NOT_FOUND,
          );
        }
        const before = { ...organization };
        Object.assign(organization, {
          ...dto,
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
          before: before as unknown as Record<string, unknown>,
          after: saved as unknown as Record<string, unknown>,
        });
        await this.outbox.record(manager, {
          type: 'access.organization.updated.v1',
          aggregateType: 'organization',
          aggregateId: saved.id,
          actor,
          data: { organization_id: saved.id, status: saved.status },
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
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Organization);
      const organization = await repository.findOneBy({ id });
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
        before: before as unknown as Record<string, unknown>,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: `access.organization.${verb}.v1`,
        aggregateType: 'organization',
        aggregateId: saved.id,
        actor,
        data: { organization_id: saved.id, status: saved.status },
      });
      return saved;
    });
  }

  async archive(actor: AccessActor, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Organization);
      const organization = await repository.findOneBy({ id });
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
        before: before as unknown as Record<string, unknown>,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: 'access.organization.archived.v1',
        aggregateType: 'organization',
        aggregateId: saved.id,
        actor,
        data: { organization_id: saved.id, status: saved.status },
      });
      return saved;
    });
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
