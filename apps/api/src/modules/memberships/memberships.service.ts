import { invalidateAuthorization } from '../access-context/authorization/invalidate-authorization';
import {
  protectInternalOrganization,
  protectRoleAssignment,
} from '../../common/auth/platform-administration';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { AccessContextCacheService } from '../access-context/cache/access-context-cache.service';
import { AuditService } from '../audit/audit.service';
import { IdentityReferencesService } from '../identity-references/identity-references.service';
import { IdentityReference } from '../identity-references/entities/identity-reference.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OutboxService } from '../outbox/outbox.service';
import { MembershipRole } from '../roles/entities/membership-role.entity';
import { Role } from '../roles/entities/role.entity';
import { CreateMembershipDto } from './dtos/create-membership.dto';
import { UpdateMembershipDto } from './dtos/update-membership.dto';
import { Membership, MembershipStatus } from './entities/membership.entity';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Membership)
    private readonly repository: Repository<Membership>,
    private readonly identityReferences: IdentityReferencesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  findAll(organizationId: string) {
    return this.repository.find({
      where: { organizationId },
      relations: { identityReference: true },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    actor: AccessActor,
    organizationId: string,
    dto: CreateMembershipDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await protectInternalOrganization(manager, actor, organizationId);
      const identity = await this.identityReferences.findOrCreateFromClaims({
        issuer: dto.identity.issuer,
        subjectId: dto.identity.subject_id,
        identityType: dto.identity.issuer.includes('accounts.')
          ? 'customer_user'
          : 'workforce_user',
        email: dto.identity.email ?? null,
        displayName: dto.identity.name ?? null,
        avatarUrl: null,
      });

      const membershipRepository = manager.getRepository(Membership);
      const membership = await membershipRepository
        .save(
          membershipRepository.create({
            organizationId,
            identityReferenceId: identity.id,
            membershipType: dto.membership_type ?? 'member',
            status: 'pending',
            metadata: dto.metadata ?? {},
            createdByIdentityId: actor.identityReferenceId,
            updatedByIdentityId: actor.identityReferenceId,
          }),
        )
        .catch((error) => {
          if (this.isUniqueViolation(error)) {
            throw new AccessError(
              'ACCESS_CONFLICT',
              'Membership already exists for this organization and identity',
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        });

      for (const code of dto.role_codes ?? []) {
        const role = await manager.getRepository(Role).findOne({
          where: [
            { code, organizationId: IsNull() },
            { code, organizationId },
          ],
        });
        if (role) {
          await protectRoleAssignment(manager, actor, organizationId, role);
          await manager.getRepository(MembershipRole).save(
            manager.getRepository(MembershipRole).create({
              membershipId: membership.id,
              roleId: role.id,
              assignedByIdentityId: actor.identityReferenceId,
            }),
          );
        }
      }

      await this.audit.record(manager, {
        organizationId,
        actor,
        action: 'membership.create',
        resourceType: 'membership',
        resourceId: membership.id,
        after: membership as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: 'access.membership.created.v1',
        aggregateType: 'membership',
        aggregateId: membership.id,
        actor,
        data: {
          organization_id: organizationId,
          membership_id: membership.id,
          context_version: membership.contextVersion,
        },
      });

      return membership;
    });
  }

  async findOne(organizationId: string, id: string) {
    const membership = await this.repository.findOne({
      where: { id, organizationId },
      relations: { identityReference: true },
    });
    if (!membership) throw this.notFound('Membership not found');
    return membership;
  }

  async update(
    actor: AccessActor,
    organizationId: string,
    id: string,
    dto: UpdateMembershipDto,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      await protectInternalOrganization(manager, actor, organizationId);
      const repository = manager.getRepository(Membership);
      const membership = await repository.findOne({
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw this.notFound('Membership not found');
      if (dto.version && dto.version !== membership.version) {
        throw new AccessError(
          'ACCESS_CONFLICT',
          'Membership version conflict',
          HttpStatus.CONFLICT,
        );
      }
      const before = { ...membership };
      membership.membershipType =
        dto.membership_type ?? membership.membershipType;
      membership.metadata = dto.metadata ?? membership.metadata;
      if (dto.expires_at !== undefined) {
        membership.expiresAt =
          dto.expires_at === null ? null : new Date(dto.expires_at);
      }
      const expiryChanged =
        (before.expiresAt?.getTime() ?? null) !==
        (membership.expiresAt?.getTime() ?? null);
      membership.updatedByIdentityId = actor.identityReferenceId;
      membership.version += 1;
      const saved = await repository.save(membership);
      const invalidated = expiryChanged
        ? await invalidateAuthorization(manager, this.outbox, actor, {
            membershipId: id,
          })
        : [];
      saved.contextVersion =
        invalidated.find((row) => row.id === id)?.context_version ??
        saved.contextVersion;
      await this.audit.record(manager, {
        organizationId,
        actor,
        action: 'membership.update',
        resourceType: 'membership',
        resourceId: saved.id,
        before: before,
        after: saved as unknown as Record<string, unknown>,
      });
      return {
        saved,
        identities: [
          ...new Set([
            saved.identityReferenceId,
            ...invalidated.map((row) => row.identity_reference_id),
          ]),
        ],
      };
    });
    await Promise.all(
      result.identities.map((identityId) =>
        this.contextCache.del(this.contextCache.key(identityId)),
      ),
    );
    return result.saved;
  }

  async setStatus(
    actor: AccessActor,
    organizationId: string,
    id: string,
    status: MembershipStatus,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      await protectInternalOrganization(manager, actor, organizationId);
      const membership = await manager.getRepository(Membership).findOne({
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw this.notFound('Membership not found');
      if (status === 'active') {
        const organization = await manager
          .getRepository(Organization)
          .findOneBy({ id: organizationId });
        if (organization?.status !== 'active') {
          throw new AccessError(
            'ACCESS_CONFLICT',
            'Membership can only be activated in an active organization',
            HttpStatus.CONFLICT,
          );
        }
      }
      const before = { ...membership };
      this.applyStatus(membership, status);
      membership.updatedByIdentityId = actor.identityReferenceId;
      membership.version += 1;
      const saved = await manager.getRepository(Membership).save(membership);
      const invalidated = await invalidateAuthorization(
        manager,
        this.outbox,
        actor,
        { membershipId: id },
      );
      saved.contextVersion = invalidated.find(
        (row) => row.id === id,
      )!.context_version;
      const action = `membership.${status === 'active' ? 'activate' : status}`;
      const eventType = `access.membership.${status === 'active' ? 'activated' : status}.v1`;
      const eventData = await this.membershipEventData(manager, saved, actor);
      await this.audit.record(manager, {
        organizationId,
        actor,
        action,
        resourceType: 'membership',
        resourceId: saved.id,
        before: before,
        after: saved as unknown as Record<string, unknown>,
      });
      await this.outbox.record(manager, {
        type: eventType,
        aggregateType: 'membership',
        aggregateId: saved.id,
        actor,
        subject: `organizations/${organizationId}/memberships/${saved.id}`,
        data: eventData,
      });
      return {
        saved,
        identities: [
          ...new Set([
            saved.identityReferenceId,
            ...invalidated.map((row) => row.identity_reference_id),
          ]),
        ],
      };
    });
    await Promise.all(
      result.identities.map((identityId) =>
        this.contextCache.del(this.contextCache.key(identityId)),
      ),
    );
    return result.saved;
  }

  private applyStatus(membership: Membership, status: MembershipStatus) {
    membership.status = status;
    if (status === 'active') membership.joinedAt ??= new Date();
    if (status === 'suspended') membership.suspendedAt = new Date();
    if (status === 'revoked') membership.revokedAt = new Date();
  }

  private async membershipEventData(
    manager: import('typeorm').EntityManager,
    membership: Membership,
    actor: AccessActor,
  ) {
    const identity = await manager
      .getRepository(IdentityReference)
      .findOneBy({ id: membership.identityReferenceId });
    const roleRepository = manager.getRepository(MembershipRole);
    const assignments =
      typeof roleRepository.find === 'function'
        ? await roleRepository.find({
            where: { membershipId: membership.id },
            relations: { role: true },
          })
        : [];

    return {
      organization_id: membership.organizationId,
      membership_id: membership.id,
      identity_issuer: identity?.issuer ?? actor.issuer,
      subject_id: identity?.subjectId ?? actor.subjectId,
      membership_status:
        membership.status === 'pending' || membership.status === 'expired'
          ? 'active'
          : membership.status,
      role_codes: assignments
        .map((assignment) => assignment.role?.code)
        .filter((code): code is string => Boolean(code)),
      context_version: membership.contextVersion,
    };
  }

  private notFound(message: string) {
    return new AccessError(
      'ACCESS_MEMBERSHIP_NOT_FOUND',
      message,
      HttpStatus.NOT_FOUND,
    );
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
