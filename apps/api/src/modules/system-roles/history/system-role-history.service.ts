import { LegalTargetValidationClient } from '../legal-target-validation.client';
import {
  CreateLegalSystemRoleDto,
  CreateLegalSystemRoleDelegationDto,
  ReplaceLegalSystemRoleDto,
  ReplaceLegalSystemRoleDelegationDto,
} from '../dtos/legal-system-role-change.dto';
import type {
  SystemResourceScope,
  SystemConsumerScope,
} from '../authorization/system-resource-scope';
import { assertBillingAssignmentBudget } from '../authorization/billing-authorization-limits';
import { AccessContextCacheService } from '../../access-context/cache/access-context-cache.service';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AccessActor } from '../../../common/auth/access-actor.type';
import { requirePlatformAdministrator } from '../../../common/auth/platform-administration';
import { AccessError } from '../../../common/errors/access-error';
import { AuditService } from '../../audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';
import {
  CreateSystemRoleDto,
  CreateSystemRoleDelegationDto,
  RevokeSystemRoleDto,
  ReplaceSystemRoleDto,
  ReplaceSystemRoleDelegationDto,
} from '../dtos/system-role-change.dto';

type Replacement = Omit<ReplaceSystemRoleDelegationDto, 'scopeType'> & {
  scopeType: SystemResourceScope;
  consumerScopeType: SystemConsumerScope;
  resourceIds: string[];
  scopeProfile: 'billing_v1' | 'legal_v1';
};
type Creation = Replacement & { membershipId: string };
type Kind = 'assignment' | 'delegation';
type Row = {
  id: string;
  membership_id: string;
  grantee_membership_id: string;
  recipient_organization_id: string;
  role_id: string;
  scope_type: string;
  consumer_scope_type: SystemConsumerScope;
  valid_from: Date;
  expires_at: Date | null;
  status: string;
  version: number;
  sealed: boolean;
  delegation_id: string | null;
  replaces_assignment_id: string | null;
  replaces_delegation_id: string | null;
  created_by_identity_id: string;
  revoked_by_identity_id: string | null;
  can_grant: boolean;
  can_revoke: boolean;
};
type Member = {
  id: string;
  organization_id: string;
  identity_reference_id: string;
  issuer: string;
  subject_id: string;
  status: string;
  expires_at: Date | null;
  organization_status: string;
  organization_type: string;
  identity_status: string;
  identity_type: string;
};

@Injectable()
export class SystemRoleHistoryService {
  constructor(
    private readonly database: DataSource,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cache: AccessContextCacheService,
    @Optional() private readonly legalTargets?: LegalTargetValidationClient,
  ) {}
  createAssignment(actor: AccessActor, body: unknown) {
    return this.create('assignment', actor, prepare(body, 'assignment', true));
  }
  createDelegation(actor: AccessActor, body: unknown) {
    return this.create('delegation', actor, prepare(body, 'delegation', true));
  }

  private async create(kind: Kind, actor: AccessActor, body: Creation) {
    if (actor.identityType === 'service_account') deny();
    const { membershipId, ...fields } = body;
    const input = Object.assign(
      kind === 'assignment'
        ? new ReplaceSystemRoleDto()
        : new ReplaceSystemRoleDelegationDto(),
      fields,
      { expectedVersion: 1 },
    ) as Replacement;
    validateReplacement(input);
    await this.validateReferences(actor, kind, input, membershipId);
    let identityId: string | undefined;
    try {
      const result = await this.database.transaction(
        'SERIALIZABLE',
        async (manager) => {
          const member = await this.member(manager, membershipId);
          identityId = member.identity_reference_id;
          const source = {
            id: randomUUID(),
            membership_id: membershipId,
            grantee_membership_id: membershipId,
            role_id: input.roleId,
            scope_type: input.scopeType,
            consumer_scope_type: input.consumerScopeType,
          } as Row;
          await this.authorize(
            manager,
            actor,
            kind,
            source,
            member,
            requestedTargets(input),
            input,
            input.authorityDelegationId,
            true,
          );
          const [existing] = await manager.query<Row[]>(
            `SELECT * FROM system_role_${kind}s WHERE created_by_identity_id=$1 AND idempotency_key=$2`,
            [actor.identityReferenceId, input.idempotencyKey],
          );
          if (existing) {
            const actualTargets = await targets(manager, kind, existing.id);
            const delegation = input as ReplaceSystemRoleDelegationDto;
            if (
              existing[`replaces_${kind}_id`] !== null ||
              existing[
                kind === 'assignment'
                  ? 'membership_id'
                  : 'grantee_membership_id'
              ] !== membershipId ||
              existing.role_id !== input.roleId ||
              existing.scope_type !== input.scopeType ||
              existing.consumer_scope_type !== input.consumerScopeType ||
              +new Date(existing.valid_from) !== +new Date(input.validFrom) ||
              (existing.expires_at === null
                ? input.expiresAt !== null
                : input.expiresAt === null ||
                  +new Date(existing.expires_at) !==
                    +new Date(input.expiresAt)) ||
              JSON.stringify(actualTargets.sort()) !==
                JSON.stringify(requestedTargets(input).sort()) ||
              (kind === 'assignment'
                ? existing.delegation_id !==
                  (input.authorityDelegationId ?? null)
                : existing.recipient_organization_id !==
                    delegation.recipientOrganizationId ||
                  existing.can_grant !== delegation.canGrant ||
                  existing.can_revoke !== delegation.canRevoke)
            )
              conflict('Idempotency key belongs to another request');
            return {
              id: existing.id,
              version: existing.version,
              replayed: true,
            };
          }
          await this.validateNew(manager, kind, source, member, input, actor);
          const created = await this.insertReplacement(
            manager,
            kind,
            source,
            actor,
            input,
            true,
          );
          await this.invalidate(manager, actor, [membershipId]);
          await this.audit.record(manager, {
            organizationId: member.organization_id,
            actor,
            action: `system_role_${kind}.create`,
            resourceType: `system_role_${kind}`,
            resourceId: created.id,
            after: { ...created, targets: requestedTargets(input) },
          });
          return { id: created.id, version: created.version, replayed: false };
        },
      );
      if (identityId) await this.cache.del(this.cache.key(identityId));
      return result;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23505', '40001', '40P01'].includes(String(error.code))
      )
        conflict('Concurrent change; retry with the same idempotency key');
      throw error;
    }
  }

  replaceAssignment(actor: AccessActor, id: string, body: unknown) {
    return this.change(
      'assignment',
      actor,
      id,
      prepare(body, 'assignment', false),
    );
  }
  replaceDelegation(actor: AccessActor, id: string, body: unknown) {
    return this.change(
      'delegation',
      actor,
      id,
      prepare(body, 'delegation', false),
    );
  }
  revokeAssignment(actor: AccessActor, id: string, body: unknown) {
    return this.change(
      'assignment',
      actor,
      id,
      parse(RevokeSystemRoleDto, body),
    );
  }
  revokeDelegation(actor: AccessActor, id: string, body: unknown) {
    return this.change(
      'delegation',
      actor,
      id,
      parse(RevokeSystemRoleDto, body),
    );
  }

  private async change(
    kind: Kind,
    actor: AccessActor,
    id: string,
    input: RevokeSystemRoleDto,
  ) {
    if (actor.identityType === 'service_account') deny();
    const replacement =
      input instanceof ReplaceSystemRoleDto ? (input as Replacement) : null;
    if (replacement) {
      validateReplacement(replacement);
      await this.validateReferences(actor, kind, replacement, undefined, id);
    }
    const invalidated = new Set<string>();
    try {
      const result = await this.database.transaction(
        'SERIALIZABLE',
        async (manager) => {
          const [old] = await manager.query<Row[]>(
            `SELECT * FROM system_role_${kind}s WHERE id = $1 FOR UPDATE`,
            [id],
          );
          if (!old)
            throw new AccessError(
              'ACCESS_NOT_FOUND',
              'Concession not found',
              HttpStatus.NOT_FOUND,
            );
          const memberId =
            kind === 'assignment'
              ? old.membership_id
              : old.grantee_membership_id;
          const member = await this.member(manager, memberId);
          const previousTargets = await targets(manager, kind, id);
          await this.authorize(
            manager,
            actor,
            kind,
            old,
            member,
            previousTargets,
            replacement,
            input.authorityDelegationId,
          );
          invalidated.add(member.identity_reference_id);
          if (kind === 'delegation') {
            const identities: Array<{ identity_reference_id: string }> =
              await manager.query(
                'SELECT DISTINCT m.identity_reference_id FROM organization_memberships m JOIN system_role_assignments a ON a.membership_id = m.id WHERE a.delegation_id = $1',
                [old.id],
              );
            for (const identity of identities)
              invalidated.add(identity.identity_reference_id);
          }

          if (replacement) {
            const [existing] = await manager.query<Row[]>(
              `SELECT * FROM system_role_${kind}s WHERE created_by_identity_id = $1 AND idempotency_key = $2`,
              [actor.identityReferenceId, replacement.idempotencyKey],
            );
            if (existing) {
              const replayTargets = await targets(manager, kind, existing.id);
              if (
                !sameReplacement(
                  kind,
                  existing,
                  old,
                  replacement,
                  replayTargets,
                  actor.identityReferenceId,
                )
              )
                conflict('Idempotency key belongs to another request');
              return {
                id: existing.id,
                version: existing.version,
                replayed: true,
              };
            }
          } else if (
            old.status === 'revoked' &&
            old.version === input.expectedVersion + 1 &&
            old.revoked_by_identity_id === actor.identityReferenceId
          ) {
            return { id: old.id, version: old.version, replayed: true };
          }
          if (
            !old.sealed ||
            old.status !== 'active' ||
            old.version !== input.expectedVersion
          )
            conflict('Concession changed; reload its version');
          if (replacement)
            await this.validateNew(
              manager,
              kind,
              old,
              member,
              replacement,
              actor,
            );

          const [[revoked]] = await manager.query<[Row[], number]>(
            `UPDATE system_role_${kind}s SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by_identity_id = $2, version = version + 1 WHERE id = $1 AND version = $3 AND status = 'active' RETURNING *`,
            [id, actor.identityReferenceId, input.expectedVersion],
          );
          if (!revoked) conflict('Concession changed');
          let created: Row | null = null;
          if (replacement)
            created = await this.insertReplacement(
              manager,
              kind,
              old,
              actor,
              replacement,
            );
          const affected: Array<{ id: string }> =
            kind === 'assignment'
              ? [{ id: memberId }]
              : await manager.query(
                  `SELECT $1::uuid AS id UNION SELECT membership_id AS id FROM system_role_assignments WHERE delegation_id = $2`,
                  [memberId, old.id],
                );
          await this.invalidate(
            manager,
            actor,
            affected.map((row) => row.id),
          );
          await this.audit.record(manager, {
            organizationId: member.organization_id,
            actor,
            action: `system_role_${kind}.${replacement ? 'replace' : 'revoke'}`,
            resourceType: `system_role_${kind}`,
            resourceId: old.id,
            before: { ...old, targets: previousTargets },
            after: {
              revoked,
              replacement: created
                ? { ...created, targets: requestedTargets(replacement!) }
                : null,
            },
          });
          return {
            id: created?.id ?? revoked.id,
            version: created?.version ?? revoked.version,
            replayed: false,
          };
        },
      );
      await Promise.all(
        [...invalidated].map((id) => this.cache.del(this.cache.key(id))),
      );
      return result;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23505', '40001', '40P01'].includes(String(error.code))
      )
        conflict('Concurrent change; retry with the same idempotency key');
      throw error;
    }
  }

  private async authorize(
    manager: EntityManager,
    actor: AccessActor,
    kind: Kind,
    old: Row,
    member: Member,
    oldTargets: string[],
    replacement: Replacement | null,
    authorityId?: string,
    creation = false,
  ) {
    if (kind === 'delegation' || !authorityId) {
      if (kind === 'delegation' && authorityId) deny();
      await requirePlatformAdministrator(manager, actor);
      return;
    }
    const [authority] = await manager.query<Row[]>(
      'SELECT * FROM system_role_delegations WHERE id = $1 FOR SHARE',
      [authorityId],
    );
    if (
      !authority ||
      !authority.sealed ||
      !effective(authority) ||
      (!creation && !authority.can_revoke)
    )
      deny();
    const administrator = await this.member(
      manager,
      authority.grantee_membership_id,
    );
    requireEligible(administrator);
    if (
      administrator.identity_reference_id !== actor.identityReferenceId ||
      member.identity_reference_id === actor.identityReferenceId ||
      authority.recipient_organization_id !== member.organization_id
    )
      deny();
    const allowed = await targets(manager, 'delegation', authority.id);
    if (
      old.role_id !== authority.role_id ||
      !coversGrant(
        authority,
        allowed,
        old.scope_type,
        old.consumer_scope_type,
        oldTargets,
      )
    )
      deny();
    if (
      replacement &&
      (!authority.can_grant ||
        replacement.roleId !== authority.role_id ||
        !coversGrant(
          authority,
          allowed,
          replacement.scopeType,
          replacement.consumerScopeType,
          requestedTargets(replacement),
        ) ||
        new Date(replacement.validFrom) < new Date(authority.valid_from) ||
        (authority.expires_at !== null &&
          (replacement.expiresAt === null ||
            new Date(replacement.expiresAt) > new Date(authority.expires_at))))
    )
      deny();
  }

  private async validateNew(
    manager: EntityManager,
    kind: Kind,
    old: Row,
    member: Member,
    input: Replacement,
    actor: AccessActor,
  ) {
    requireEligible(member);
    if (member.identity_reference_id === actor.identityReferenceId) deny();
    const roles: Array<{ id: string }> = await manager.query(
      `SELECT r.id FROM system_roles r JOIN system_roles previous ON previous.id = $1 JOIN products p ON p.id = r.product_id JOIN system_role_scopes s ON s.role_id = r.id AND s.scope_type = $3 AND s.consumer_scope_type = $4 WHERE r.id = $2 AND r.product_id = previous.product_id AND r.scope_profile = $5 AND r.status = 'active' AND r.sealed AND p.status = 'active' FOR SHARE OF r, previous, p, s`,
      [
        old.role_id,
        input.roleId,
        input.scopeType,
        input.consumerScopeType,
        input.scopeProfile,
      ],
    );
    if (!roles.length) deny();
    if (input.organizationIds.length) {
      const found: unknown[] = await manager.query(
        'SELECT id FROM organizations WHERE id = ANY($1::uuid[]) FOR SHARE',
        [input.organizationIds],
      );
      if (found.length !== input.organizationIds.length)
        invalid('Unknown target organization');
    }
    if (kind === 'delegation') {
      const delegation = input as ReplaceSystemRoleDelegationDto;
      if (!delegation.canGrant && !delegation.canRevoke)
        invalid('Delegation requires grant or revoke authority');
      const recipients: unknown[] = await manager.query(
        "SELECT id FROM organizations WHERE id = $1 AND type = 'internal' AND status = 'active' FOR SHARE",
        [delegation.recipientOrganizationId],
      );
      if (!recipients.length) deny();
    }
    if (kind === 'assignment') {
      await assertBillingAssignmentBudget(
        manager,
        member.identity_reference_id,
        input.roleId,
        old.id,
        input.expiresAt,
        input.organizationIds.length + input.resourceIds.length,
      );
    }
    // Locking the identity coordinates grants across all its memberships.
    const duplicates: unknown[] = await manager.query(
      `SELECT c.id FROM system_role_${kind}s c WHERE c.id <> $1 AND c.${kind === 'assignment' ? 'membership_id' : 'grantee_membership_id'} = $2 AND c.role_id = $3 AND c.scope_type = $4 AND c.consumer_scope_type = $8 AND c.valid_from = $5 AND c.expires_at IS NOT DISTINCT FROM $6::timestamptz AND c.status = 'active' AND ARRAY(SELECT t.target_type || ':' || t.target_id::text FROM system_role_${kind}_targets t WHERE t.${kind}_id = c.id ORDER BY t.target_type || ':' || t.target_id::text) = $7::text[] ${kind === 'delegation' ? 'AND c.recipient_organization_id = $9 AND c.can_grant = $10 AND c.can_revoke = $11' : ''}`,
      [
        old.id,
        member.id,
        input.roleId,
        input.scopeType,
        input.validFrom,
        input.expiresAt,
        requestedTargets(input).sort(),
        input.consumerScopeType,
        ...(kind === 'delegation'
          ? [
              (input as ReplaceSystemRoleDelegationDto).recipientOrganizationId,
              (input as ReplaceSystemRoleDelegationDto).canGrant,
              (input as ReplaceSystemRoleDelegationDto).canRevoke,
            ]
          : []),
      ],
    );
    if (duplicates.length)
      conflict('Equivalent active concession already exists');
  }

  private async validateReferences(
    actor: AccessActor,
    kind: Kind,
    input: Replacement,
    membershipId?: string,
    previousId?: string,
  ) {
    if (input.scopeProfile !== 'legal_v1') return;
    // Check authority before consulting another product. Release locks before network;
    // the mutation transaction repeats every authority/catalog check afterward.
    await this.database.transaction('SERIALIZABLE', async (manager) => {
      const old = previousId
        ? (
            await manager.query<Row[]>(
              `SELECT * FROM system_role_${kind}s WHERE id=$1`,
              [previousId],
            )
          )[0]
        : undefined;
      if (previousId && !old) deny();
      const member = await this.member(
        manager,
        membershipId ??
          (kind === 'assignment'
            ? old!.membership_id
            : old!.grantee_membership_id),
      );
      const source =
        old ??
        ({
          role_id: input.roleId,
          scope_type: input.scopeType,
          consumer_scope_type: input.consumerScopeType,
        } as Row);
      await this.authorize(
        manager,
        actor,
        kind,
        source,
        member,
        old ? await targets(manager, kind, old.id) : requestedTargets(input),
        input,
        input.authorityDelegationId,
        !old,
      );
      requireEligible(member);
      if (member.identity_reference_id === actor.identityReferenceId) deny();
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT r.id FROM system_roles r JOIN products p ON p.id=r.product_id JOIN system_role_scopes s ON s.role_id=r.id WHERE r.id=$1 AND p.code='legal' AND p.status='active' AND r.scope_profile='legal_v1' AND r.status='active' AND r.sealed AND s.scope_type=$2 AND s.consumer_scope_type=$3`,
        [input.roleId, input.scopeType, input.consumerScopeType],
      );
      if (!rows.length) deny();
    });
    if (input.resourceIds.length) {
      if (!this.legalTargets)
        throw new AccessError(
          'ACCESS_LEGAL_VALIDATION_UNAVAILABLE',
          'Legal validation not configured',
          503,
        );
      await this.legalTargets.validate(
        input.scopeType === 'issuers' ? 'legal_issuer' : 'legal_application',
        input.resourceIds,
      );
    }
  }

  private async member(manager: EntityManager, id: string): Promise<Member> {
    const [member] = await manager.query<Member[]>(
      `SELECT m.*, o.status AS organization_status, o.type AS organization_type, i.status AS identity_status, i.identity_type, i.issuer, i.subject_id FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id JOIN identity_references i ON i.id = m.identity_reference_id WHERE m.id = $1 FOR UPDATE OF m, i FOR SHARE OF o`,
      [id],
    );
    if (!member) deny();
    return member;
  }

  private async insertReplacement(
    manager: EntityManager,
    kind: Kind,
    old: Row,
    actor: AccessActor,
    input: Replacement,
    creation = false,
  ) {
    const rowId = randomUUID();
    const shared = [
      rowId,
      kind === 'assignment' ? old.membership_id : old.grantee_membership_id,
      input.roleId,
      input.scopeType,
      input.validFrom,
      input.expiresAt,
      actor.identityReferenceId,
      input.idempotencyKey,
      creation ? null : old.id,
      input.consumerScopeType,
    ];
    const extraColumns =
      kind === 'assignment'
        ? 'delegation_id'
        : 'recipient_organization_id, can_grant, can_revoke';
    const extraValues = kind === 'assignment' ? '$11' : '$11, $12, $13';
    const delegation = input as ReplaceSystemRoleDelegationDto;
    const extra =
      kind === 'assignment'
        ? [input.authorityDelegationId ?? null]
        : [
            delegation.recipientOrganizationId,
            delegation.canGrant,
            delegation.canRevoke,
          ];
    const [created] = await manager.query<Row[]>(
      `INSERT INTO system_role_${kind}s (id, ${kind === 'assignment' ? 'membership_id' : 'grantee_membership_id'}, role_id, scope_type, valid_from, expires_at, created_by_identity_id, idempotency_key, replaces_${kind}_id, consumer_scope_type, ${extraColumns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${extraValues}) RETURNING *`,
      [...shared, ...extra],
    );
    const all = requestedTargets(input);
    if (all.length)
      await manager.query(
        `INSERT INTO system_role_${kind}_targets (${kind}_id, scope_type, consumer_scope_type, target_type, organization_id, resource_id)
       SELECT $1,$2,$3,split_part(t,':',1),CASE WHEN split_part(t,':',1)='organization' THEN split_part(t,':',2)::uuid END,CASE WHEN split_part(t,':',1)<>'organization' THEN split_part(t,':',2)::uuid END FROM unnest($4::text[]) x(t)`,
        [rowId, input.scopeType, input.consumerScopeType, all],
      );
    return created;
  }

  private async invalidate(
    manager: EntityManager,
    actor: AccessActor,
    membershipIds: string[],
  ) {
    type InvalidatedMember = {
      id: string;
      organization_id: string;
      identity_reference_id: string;
      context_version: number;
      issuer: string;
      subject_id: string;
    };
    const [rows] = await manager.query<[InvalidatedMember[], number]>(
      `UPDATE organization_memberships m SET context_version = context_version + 1, version = version + 1 FROM identity_references i WHERE m.identity_reference_id = i.id AND m.id = ANY($1::uuid[]) RETURNING m.id, m.organization_id, m.identity_reference_id, m.context_version, i.issuer, i.subject_id`,
      [membershipIds],
    );
    await this.outbox.recordMany(
      manager,
      rows.map((row) => ({
        type: 'access.membership.context_invalidated.v1',
        aggregateType: 'membership',
        aggregateId: row.id,
        actor,
        data: {
          organization_id: row.organization_id,
          membership_id: row.id,
          identity_reference_id: row.identity_reference_id,
          identity_issuer: row.issuer,
          subject_id: row.subject_id,
          context_version: row.context_version,
          reason: 'system_role_authorization_changed',
        },
      })),
    );
  }
}

async function targets(
  manager: EntityManager,
  kind: Kind,
  id: string,
): Promise<string[]> {
  const rows: Array<{ target: string }> = await manager.query(
    `SELECT target_type || ':' || target_id::text AS target FROM system_role_${kind}_targets WHERE ${kind}_id = $1 ORDER BY target`,
    [id],
  );
  return rows.map((row) => row.target);
}
function parse<T extends object>(type: new () => T, body: unknown): T {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    invalid('Invalid request');
  const value = plainToInstance(type, body);
  if (
    validateSync(value, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    invalid('Invalid or unknown request fields');
  return value;
}
function validateReplacement(value: Replacement) {
  if (
    value.scopeProfile === 'billing_v1' &&
    (value.scopeType === 'organizations') !== value.organizationIds.length > 0
  )
    invalid('Targets must match scope');
  if (
    !/(Z|[+-]00:00)$/.test(value.validFrom) ||
    (value.expiresAt !== null &&
      (!/(Z|[+-]00:00)$/.test(value.expiresAt) ||
        new Date(value.expiresAt) <= new Date(value.validFrom)))
  )
    invalid('Use UTC dates and a valid interval');
}
function effective(value: {
  status: string;
  valid_from: Date;
  expires_at: Date | null;
}) {
  const now = Date.now();
  return (
    value.status === 'active' &&
    +new Date(value.valid_from) <= now &&
    (value.expires_at === null || +new Date(value.expires_at) > now)
  );
}
function requireEligible(member: Member) {
  if (
    member.status !== 'active' ||
    member.organization_status !== 'active' ||
    member.organization_type !== 'internal' ||
    member.identity_status !== 'active' ||
    member.identity_type === 'service_account' ||
    (member.expires_at && +new Date(member.expires_at) <= Date.now())
  )
    deny();
}
export function covers(
  authorityScope: string,
  allowed: string[],
  requestedScope: string,
  requested: string[],
) {
  return authorityScope === 'catalog_global'
    ? requestedScope === 'catalog_global'
    : authorityScope === 'all_customers'
      ? requestedScope === 'all_customers' || requestedScope === 'organizations'
      : requestedScope === 'organizations' &&
        requested.every((id) => allowed.includes(id));
}
function sameReplacement(
  kind: Kind,
  row: Row,
  old: Row,
  input: Replacement,
  actualTargets: string[],
  actorId: string,
) {
  return (
    row[`replaces_${kind}_id`] === old.id &&
    old.version === input.expectedVersion + 1 &&
    old.revoked_by_identity_id === actorId &&
    row.role_id === input.roleId &&
    row.scope_type === input.scopeType &&
    row.consumer_scope_type === input.consumerScopeType &&
    +new Date(row.valid_from) === +new Date(input.validFrom) &&
    (row.expires_at === null
      ? input.expiresAt === null
      : input.expiresAt !== null &&
        +new Date(row.expires_at) === +new Date(input.expiresAt)) &&
    JSON.stringify([...actualTargets].sort()) ===
      JSON.stringify(requestedTargets(input).sort()) &&
    (kind === 'assignment'
      ? row.delegation_id === (input.authorityDelegationId ?? null)
      : row.recipient_organization_id ===
          (input as ReplaceSystemRoleDelegationDto).recipientOrganizationId &&
        row.can_grant === (input as ReplaceSystemRoleDelegationDto).canGrant &&
        row.can_revoke === (input as ReplaceSystemRoleDelegationDto).canRevoke)
  );
}
function deny(): never {
  throw new AccessError(
    'ACCESS_FORBIDDEN',
    'Insufficient current authority',
    HttpStatus.FORBIDDEN,
  );
}
function conflict(message: string): never {
  throw new AccessError('ACCESS_CONFLICT', message, HttpStatus.CONFLICT);
}
function invalid(message: string): never {
  throw new AccessError(
    'ACCESS_INVALID_REQUEST',
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function requestedTargets(input: Replacement): string[] {
  return [
    ...input.organizationIds.map((id) => 'organization:' + id),
    ...input.resourceIds.map(
      (id) =>
        (input.scopeType === 'issuers'
          ? 'legal_issuer:'
          : 'legal_application:') + id,
    ),
  ];
}
function coversGrant(
  authority: Row,
  allowed: string[],
  scope: string,
  consumer: string,
  requested: string[],
) {
  if (
    ['legal_global', 'issuers', 'applications'].includes(authority.scope_type)
  )
    return (
      authority.scope_type !== 'legal_global' &&
      authority.scope_type === scope &&
      authority.consumer_scope_type !== 'all_organizations' &&
      authority.consumer_scope_type === consumer &&
      requested.every((id) => allowed.includes(id))
    );
  return (
    consumer === 'not_applicable' &&
    authority.consumer_scope_type === 'not_applicable' &&
    covers(authority.scope_type, allowed, scope, requested)
  );
}
function prepare(body: unknown, kind: Kind, creation: true): Creation;
function prepare(body: unknown, kind: Kind, creation: false): Replacement;
function prepare(
  body: unknown,
  kind: Kind,
  creation: boolean,
): Replacement | Creation {
  const legal =
    !!body &&
    typeof body === 'object' &&
    'scopeType' in body &&
    ['legal_global', 'issuers', 'applications'].includes(
      String(body.scopeType),
    );
  const dto = legal
    ? creation
      ? kind === 'assignment'
        ? CreateLegalSystemRoleDto
        : CreateLegalSystemRoleDelegationDto
      : kind === 'assignment'
        ? ReplaceLegalSystemRoleDto
        : ReplaceLegalSystemRoleDelegationDto
    : creation
      ? kind === 'assignment'
        ? CreateSystemRoleDto
        : CreateSystemRoleDelegationDto
      : kind === 'assignment'
        ? ReplaceSystemRoleDto
        : ReplaceSystemRoleDelegationDto;
  const parsed = parse(dto as new () => object, body);
  return Object.assign(
    new ReplaceSystemRoleDto(),
    parsed,
    legal
      ? { scopeProfile: 'legal_v1' }
      : {
          scopeProfile: 'billing_v1',
          consumerScopeType: 'not_applicable',
          resourceIds: [],
        },
  ) as unknown as Replacement | Creation;
}
