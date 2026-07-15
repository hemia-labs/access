import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { AccessContextCacheService } from '../access-context/access-context-cache.service';
import { AuditService } from '../audit/audit.service';
import { Membership } from '../memberships/entities/membership.entity';
import { OutboxService } from '../outbox/outbox.service';
import { AssignRoleDto } from './dtos/assign-role.dto';
import { CreateRoleDto } from './dtos/create-role.dto';
import { UpdateRoleDto } from './dtos/update-role.dto';
import { MembershipRole } from './entities/membership-role.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';

@Injectable()
export class RolesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  findGlobalRoles() {
    return this.roles.find({
      where: { organizationId: IsNull() },
      order: { code: 'ASC' },
    });
  }

  findPermissions() {
    return this.permissions.find({ order: { code: 'ASC' } });
  }

  createOrganizationRole(organizationId: string, dto: CreateRoleDto) {
    return this.roles.save(
      this.roles.create({
        organizationId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        scope: dto.scope ?? 'organization',
        status: 'active',
        isSystem: false,
      }),
    );
  }

  findOrganizationRoles(organizationId: string) {
    return this.roles.find({
      where: [{ organizationId }, { organizationId: IsNull(), scope: 'organization' }],
      order: { code: 'ASC' },
    });
  }

  async updateOrganizationRole(
    organizationId: string,
    roleId: string,
    dto: UpdateRoleDto,
  ) {
    const role = await this.findMutableOrganizationRole(organizationId, roleId);
    role.name = dto.name ?? role.name;
    role.description = dto.description ?? role.description;
    role.status = dto.status ?? role.status;
    return this.roles.save(role);
  }

  async removeOrganizationRole(organizationId: string, roleId: string) {
    const role = await this.findMutableOrganizationRole(organizationId, roleId);
    await this.roles.delete(role.id);
    return { deleted: true };
  }

  async assignMembershipRole(
    actor: AccessActor,
    organizationId: string,
    membershipId: string,
    dto: AssignRoleDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const membership = await manager
        .getRepository(Membership)
        .findOneBy({ id: membershipId, organizationId });
      if (!membership) throw this.notFound('Membership not found');

      const role = await this.findRoleForAssignment(
        manager.getRepository(Role),
        organizationId,
        dto,
      );

      await manager.getRepository(MembershipRole).save(
        manager.getRepository(MembershipRole).create({
          membershipId,
          roleId: role.id,
          assignedByIdentityId: actor.identityReferenceId,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      );

      membership.version += 1;
      membership.contextVersion += 1;
      membership.updatedByIdentityId = actor.identityReferenceId;
      await manager.getRepository(Membership).save(membership);

      await this.audit.record(manager, {
        organizationId,
        actor,
        action: 'role.assign',
        resourceType: 'membership_role',
        resourceId: `${membershipId}:${role.id}`,
        after: { membershipId, roleId: role.id, roleCode: role.code },
      });
      await this.outbox.record(manager, {
        type: 'access.membership.role_assigned.v1',
        aggregateType: 'membership',
        aggregateId: membershipId,
        actor,
        data: {
          organization_id: organizationId,
          membership_id: membershipId,
          role_id: role.id,
          role_code: role.code,
          context_version: membership.contextVersion,
        },
      });
      await this.contextCache.del(this.contextCache.key(membership.identityReferenceId));

      return manager.getRepository(MembershipRole).findOneByOrFail({
        membershipId,
        roleId: role.id,
      });
    });
  }

  async revokeMembershipRole(
    actor: AccessActor,
    organizationId: string,
    membershipId: string,
    roleId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const membership = await manager
        .getRepository(Membership)
        .findOneBy({ id: membershipId, organizationId });
      if (!membership) throw this.notFound('Membership not found');
      const membershipRole = await manager
        .getRepository(MembershipRole)
        .findOneBy({ membershipId, roleId });
      if (!membershipRole) throw this.notFound('Membership role not found');

      await manager.getRepository(MembershipRole).delete({ membershipId, roleId });
      membership.version += 1;
      membership.contextVersion += 1;
      membership.updatedByIdentityId = actor.identityReferenceId;
      await manager.getRepository(Membership).save(membership);

      await this.audit.record(manager, {
        organizationId,
        actor,
        action: 'role.revoke',
        resourceType: 'membership_role',
        resourceId: `${membershipId}:${roleId}`,
        before: { membershipId, roleId },
      });
      await this.outbox.record(manager, {
        type: 'access.membership.role_revoked.v1',
        aggregateType: 'membership',
        aggregateId: membershipId,
        actor,
        data: {
          organization_id: organizationId,
          membership_id: membershipId,
          role_id: roleId,
          context_version: membership.contextVersion,
        },
      });
      await this.contextCache.del(this.contextCache.key(membership.identityReferenceId));

      return { deleted: true };
    });
  }

  private async findMutableOrganizationRole(organizationId: string, roleId: string) {
    const role = await this.roles.findOneBy({ id: roleId, organizationId });
    if (!role) throw this.notFound('Role not found');
    if (role.isSystem) {
      throw new AccessError(
        'ACCESS_CONFLICT',
        'System roles cannot be modified or deleted',
        HttpStatus.CONFLICT,
      );
    }
    return role;
  }

  private async findRoleForAssignment(
    repository: Repository<Role>,
    organizationId: string,
    dto: AssignRoleDto,
  ) {
    const role = dto.roleId
      ? await repository.findOneBy({ id: dto.roleId })
      : await repository.findOne({
          where: [
            { code: dto.roleCode, organizationId },
            { code: dto.roleCode, organizationId: IsNull() },
          ],
        });
    if (!role) throw this.notFound('Role not found');
    return role;
  }

  private notFound(message: string) {
    return new AccessError(message.includes('Role') ? 'ACCESS_ROLE_NOT_FOUND' : 'ACCESS_MEMBERSHIP_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}
