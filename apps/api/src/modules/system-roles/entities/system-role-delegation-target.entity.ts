import {
  Column,
  Entity,
  PrimaryColumn,
  Check,
  ForeignKey,
  Index,
} from 'typeorm';
import type {
  SystemResourceScope,
  SystemConsumerScope,
  SystemTargetType,
} from '../authorization/system-resource-scope';

/** Expanded metadata; requires the coordinated Legal scope migration before deployment. */
@ForeignKey('organizations', ['organizationId'], ['id'], {
  onDelete: 'RESTRICT',
})
@ForeignKey(
  'system_role_delegations',
  ['delegationId', 'scopeType', 'consumerScopeType'],
  ['id', 'scopeType', 'consumerScopeType'],
)
@Check(
  "(target_type = 'organization' AND organization_id IS NOT NULL AND resource_id IS NULL) OR (target_type IN ('legal_issuer','legal_application') AND organization_id IS NULL AND resource_id IS NOT NULL)",
)
@Check(
  "(scope_type = 'organizations' AND consumer_scope_type = 'not_applicable' AND target_type = 'organization') OR (scope_type IN ('legal_global','issuers','applications') AND consumer_scope_type IN ('not_applicable','all_organizations','organizations') AND ((target_type = 'legal_issuer' AND scope_type = 'issuers') OR (target_type = 'legal_application' AND scope_type = 'applications') OR (target_type = 'organization' AND consumer_scope_type = 'organizations')))",
)
@Index('ix_system_delegation_targets_org', ['organizationId'])
@Index('ix_system_delegation_targets_resource', [
  'targetType',
  'targetId',
  'delegationId',
])
@Entity('system_role_delegation_targets')
export class SystemRoleDelegationTarget {
  @PrimaryColumn({ name: 'delegation_id', type: 'uuid' })
  delegationId: string;

  @PrimaryColumn({ name: 'target_type', type: 'varchar', length: 24 })
  targetType: SystemTargetType;

  @PrimaryColumn({
    name: 'target_id',
    type: 'uuid',
    asExpression: 'COALESCE(organization_id, resource_id)',
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  targetId: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ name: 'scope_type', type: 'varchar', length: 24 })
  scopeType: SystemResourceScope;

  @Column({ name: 'consumer_scope_type', type: 'varchar', length: 24 })
  consumerScopeType: SystemConsumerScope;
}
