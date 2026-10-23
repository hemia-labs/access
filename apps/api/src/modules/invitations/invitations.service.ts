import { protectInternalOrganization } from '../../common/auth/platform-administration';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AccessActor } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { AccessContextCacheService } from '../access-context/cache/access-context-cache.service';
import { AuditService } from '../audit/audit.service';
import { IdentityReferencesService } from '../identity-references/identity-references.service';
import { Membership } from '../memberships/entities/membership.entity';
import { OutboxService } from '../outbox/outbox.service';
import { MembershipRole } from '../roles/entities/membership-role.entity';
import { Role } from '../roles/entities/role.entity';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './dtos/invitation.dto';
import { Invitation } from './entities/invitation.entity';

@Injectable()
export class InvitationsService {
  // ponytail: single-process fallback, Redis rate limiting when shared limits matter.
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    private readonly identities: IdentityReferencesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly contextCache: AccessContextCacheService,
  ) {}

  findAll(organizationId: string) {
    return this.invitations.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const invitation = await this.invitations.findOneBy({ id });
    if (!invitation) throw this.notFound('Invitation not found');
    return invitation;
  }

  async create(
    actor: AccessActor,
    organizationId: string,
    dto: CreateInvitationDto,
  ) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    const expiresAt = new Date(
      Date.now() + (dto.expires_in_hours ?? 72) * 3600_000,
    );

    const invitation = await this.dataSource.transaction(async (manager) => {
      const organization = await protectInternalOrganization(
        manager,
        actor,
        organizationId,
      );
      await this.requireInvitationRoles(
        manager,
        organizationId,
        dto.role_codes ?? ['organization_member'],
      );
      if (!organization) throw this.notFound('Organization not found');
      const saved = await manager.getRepository(Invitation).save(
        manager.getRepository(Invitation).create({
          organizationId,
          emailNormalized: this.normalize(dto.email),
          identityIssuerHint: dto.identity_issuer_hint ?? null,
          productCode: dto.product_code ?? null,
          roleCodes: dto.role_codes ?? ['organization_member'],
          tokenHash,
          expiresAt,
          createdByIdentityId: actor.identityReferenceId,
        }),
      );
      await this.audit.record(manager, {
        organizationId,
        actor,
        action: 'invitation.create',
        resourceType: 'invitation',
        resourceId: saved.id,
        after: this.safe(saved),
      });
      await this.outbox.record(manager, {
        type: 'access.invitation.created.v1',
        aggregateType: 'invitation',
        aggregateId: saved.id,
        actor,
        data: { organization_id: organizationId, invitation_id: saved.id },
      });
      return saved;
    });

    return { ...this.safe(invitation), token };
  }

  async accept(actor: AccessActor, dto: AcceptInvitationDto) {
    this.rateLimit(`accept:${actor.identityReferenceId}`);
    const tokenHash = this.hash(dto.token);
    const invitation = await this.invitations.findOneBy({ tokenHash });
    if (!invitation || !this.same(tokenHash, invitation.tokenHash)) {
      throw new AccessError(
        'ACCESS_INVITATION_INVALID',
        'Invitation is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Invitation);
      const locked = await repository.findOneBy({ id: invitation.id });
      if (!locked) throw this.notFound('Invitation not found');
      if (locked.status !== 'pending') {
        throw new AccessError(
          'ACCESS_INVITATION_INVALID',
          'Invitation is not pending',
          HttpStatus.CONFLICT,
        );
      }
      if (locked.expiresAt <= new Date()) {
        locked.status = 'expired';
        await repository.save(locked);
        throw new AccessError(
          'ACCESS_INVITATION_EXPIRED',
          'Invitation expired',
          HttpStatus.BAD_REQUEST,
        );
      }

      const organization = await protectInternalOrganization(
        manager,
        {
          identityReferenceId: locked.createdByIdentityId,
          identityType: 'workforce_user',
        },
        locked.organizationId,
      );
      if (organization.status !== 'active')
        throw new AccessError(
          'ACCESS_FORBIDDEN',
          'Organization is not active',
          HttpStatus.FORBIDDEN,
        );
      await this.requireInvitationRoles(
        manager,
        locked.organizationId,
        locked.roleCodes,
      );
      const identity = await this.identities.findOrCreateFromClaims({
        issuer: actor.issuer,
        subjectId: actor.subjectId,
        identityType: actor.identityType,
        email: null,
        displayName: null,
        avatarUrl: null,
      });
      if (
        identity.emailSnapshot &&
        this.normalize(identity.emailSnapshot) !== locked.emailNormalized
      ) {
        throw new AccessError(
          'ACCESS_INVITATION_EMAIL_MISMATCH',
          'Invitation email does not match identity',
          HttpStatus.FORBIDDEN,
        );
      }

      const membershipRepository = manager.getRepository(Membership);
      let membership = await membershipRepository.findOneBy({
        organizationId: locked.organizationId,
        identityReferenceId: identity.id,
      });
      membership ??= membershipRepository.create({
        organizationId: locked.organizationId,
        identityReferenceId: identity.id,
        membershipType: 'member',
        createdByIdentityId: locked.createdByIdentityId,
      });
      membership.status = 'active';
      membership.joinedAt ??= new Date();
      membership.updatedByIdentityId = actor.identityReferenceId;
      membership.contextVersion = (membership.contextVersion ?? 0) + 1;
      membership = await membershipRepository.save(membership);

      for (const code of locked.roleCodes) {
        const role = await manager.getRepository(Role).findOne({
          where: [
            { code, organizationId: locked.organizationId },
            { code, organizationId: IsNull() },
          ],
        });
        if (role) {
          await manager.getRepository(MembershipRole).upsert(
            {
              membershipId: membership.id,
              roleId: role.id,
              assignedByIdentityId: actor.identityReferenceId,
            },
            ['membershipId', 'roleId'],
          );
        }
      }

      locked.status = 'accepted';
      locked.acceptedAt = new Date();
      locked.acceptedByIdentityId = identity.id;
      await repository.save(locked);
      await this.audit.record(manager, {
        organizationId: locked.organizationId,
        actor,
        action: 'invitation.accept',
        resourceType: 'invitation',
        resourceId: locked.id,
        after: this.safe(locked),
      });
      await this.outbox.record(manager, {
        type: 'access.invitation.accepted.v1',
        aggregateType: 'invitation',
        aggregateId: locked.id,
        actor,
        data: {
          organization_id: locked.organizationId,
          invitation_id: locked.id,
          membership_id: membership.id,
        },
      });
      await this.contextCache.del(this.contextCache.key(identity.id));
      return { accepted: true, membership_id: membership.id };
    });
  }

  async revoke(actor: AccessActor, id: string) {
    return this.updateStatus(actor, id, 'revoked');
  }

  async resend(actor: AccessActor, id: string) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    const invitation = await this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(Invitation).findOneBy({ id });
      if (!item) throw this.notFound('Invitation not found');
      await protectInternalOrganization(manager, actor, item.organizationId);
      if (item.status !== 'pending') {
        throw new AccessError(
          'ACCESS_INVITATION_INVALID',
          'Invitation is not pending',
          HttpStatus.CONFLICT,
        );
      }
      item.tokenHash = tokenHash;
      item.expiresAt = new Date(Date.now() + 72 * 3600_000);
      const saved = await manager.getRepository(Invitation).save(item);
      await this.outbox.record(manager, {
        type: 'access.invitation.created.v1',
        aggregateType: 'invitation',
        aggregateId: saved.id,
        actor,
        data: {
          organization_id: saved.organizationId,
          invitation_id: saved.id,
          resent: true,
        },
      });
      return saved;
    });
    return { ...this.safe(invitation), token };
  }

  private async updateStatus(
    actor: AccessActor,
    id: string,
    status: 'revoked',
  ) {
    const invitation = await this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(Invitation).findOneBy({ id });
      if (!item) throw this.notFound('Invitation not found');
      await protectInternalOrganization(manager, actor, item.organizationId);
      item.status = status;
      item.revokedAt = new Date();
      const saved = await manager.getRepository(Invitation).save(item);
      await this.audit.record(manager, {
        organizationId: saved.organizationId,
        actor,
        action: `invitation.${status}`,
        resourceType: 'invitation',
        resourceId: saved.id,
        after: this.safe(saved),
      });
      await this.outbox.record(manager, {
        type: `access.invitation.${status}.v1`,
        aggregateType: 'invitation',
        aggregateId: saved.id,
        actor,
        data: {
          organization_id: saved.organizationId,
          invitation_id: saved.id,
        },
      });
      return saved;
    });
    return invitation;
  }

  private async requireInvitationRoles(
    manager: import('typeorm').EntityManager,
    organizationId: string,
    codes: string[],
  ) {
    for (const code of codes) {
      const role = await manager.getRepository(Role).findOne({
        where: [
          { code, organizationId },
          { code, organizationId: IsNull() },
        ],
      });
      if (!role || role.scope !== 'organization' || role.status !== 'active')
        throw new AccessError(
          'ACCESS_FORBIDDEN',
          'Invitations can only grant active organizational roles',
          HttpStatus.FORBIDDEN,
        );
    }
  }

  private rateLimit(key: string) {
    const now = Date.now();
    const item = this.attempts.get(key);
    if (!item || item.resetAt < now) {
      this.attempts.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    item.count += 1;
    if (item.count > 10) {
      throw new AccessError(
        'ACCESS_RATE_LIMITED',
        'Too many invitation attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private same(a: string, b: string) {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  private normalize(email: string) {
    return email.trim().toLowerCase();
  }

  private safe(invitation: Invitation) {
    const { tokenHash: _tokenHash, ...safe } = invitation;
    void _tokenHash;
    return safe as unknown as Record<string, unknown>;
  }

  private notFound(message: string) {
    return new AccessError('ACCESS_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}
