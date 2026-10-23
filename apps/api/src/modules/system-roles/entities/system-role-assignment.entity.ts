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
@ForeignKey('organization_memberships', ['membershipId'], ['id'])
@ForeignKey('system_role_delegations', ['delegationId'], ['id'])
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
@Unique(['createdByIdentityId', 'idempotencyKey'])
@Index('ix_system_assignments_membership_status', ['membershipId', 'status'])
@Index('ix_system_assignments_delegation', ['delegationId'])
@Index('ix_system_assignments_role_status', ['roleId', 'status'])
@ForeignKey('system_role_assignments', ['replacesAssignmentId'], ['id'])
@Unique(['replacesAssignmentId'])
@Check('replaces_assignment_id IS NULL OR replaces_assignment_id <> id')
@Entity('system_role_assignments')
export class SystemRoleAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'replaces_assignment_id', type: 'uuid', nullable: true })
  replacesAssignmentId: string | null;

  /** Closed by PostgreSQL at the end of the creation transaction. Never exposed in DTOs. */
  @Column({ type: 'boolean', default: false })
  sealed: boolean;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ name: 'delegation_id', type: 'uuid', nullable: true })
  delegationId: string | null;

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey: string;

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
