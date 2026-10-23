import { Index } from 'typeorm';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Check,
  Unique,
  ForeignKey,
} from 'typeorm';
import type {
  SystemResourceScope,
  SystemConsumerScope,
} from '../authorization/system-resource-scope';

/** Expanded metadata; requires the coordinated Legal scope migration before deployment. */
@ForeignKey('organization_memberships', ['granteeMembershipId'], ['id'])
@ForeignKey('organizations', ['recipientOrganizationId'], ['id'])
@ForeignKey('identity_references', ['createdByIdentityId'], ['id'])
@ForeignKey('identity_references', ['revokedByIdentityId'], ['id'])
@ForeignKey(
  'system_role_scopes',
  ['roleId', 'scopeType', 'consumerScopeType'],
  ['roleId', 'scopeType', 'consumerScopeType'],
)
@Unique(['id', 'scopeType', 'consumerScopeType'])
@Check('expires_at IS NULL OR expires_at > valid_from')
@Check('version > 0')
@Check(
  "(status = 'active' AND revoked_at IS NULL AND revoked_by_identity_id IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_identity_id IS NOT NULL)",
)
@Check('revoked_at IS NULL OR revoked_at >= created_at')
@Check('can_grant OR can_revoke')
@Index('ix_system_delegations_grantee_status', [
  'granteeMembershipId',
  'status',
])
@Index('ix_system_delegations_recipient', ['recipientOrganizationId'])
@ForeignKey('system_role_delegations', ['replacesDelegationId'], ['id'])
@Unique(['replacesDelegationId'])
@Check('replaces_delegation_id IS NULL OR replaces_delegation_id <> id')
@Unique(['createdByIdentityId', 'idempotencyKey'])
@Entity('system_role_delegations')
export class SystemRoleDelegation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'replaces_delegation_id', type: 'uuid', nullable: true })
  replacesDelegationId: string | null;

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey: string;

  /** Closed by PostgreSQL at the end of the creation transaction. Never exposed in DTOs. */
  @Column({ type: 'boolean', default: false })
  sealed: boolean;

  @Column({ name: 'grantee_membership_id', type: 'uuid' })
  granteeMembershipId: string;

  @Column({ name: 'recipient_organization_id', type: 'uuid' })
  recipientOrganizationId: string;

  @Column({ name: 'can_grant', type: 'boolean', default: false })
  canGrant: boolean;

  @Column({ name: 'can_revoke', type: 'boolean', default: false })
  canRevoke: boolean;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 24 })
  scopeType: SystemResourceScope;

  @Column({ name: 'consumer_scope_type', type: 'varchar', length: 24 })
  consumerScopeType: SystemConsumerScope;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'revoked';

  @Column({ name: 'version', type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'created_by_identity_id', type: 'uuid' })
  createdByIdentityId: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'revoked_by_identity_id', type: 'uuid', nullable: true })
  revokedByIdentityId: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
