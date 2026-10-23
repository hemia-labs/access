import { Column, Entity, PrimaryColumn, Check, ForeignKey } from 'typeorm';
import type {
  SystemResourceScope,
  SystemScopeProfile,
  SystemConsumerScope,
} from '../authorization/system-resource-scope';

/** Catalog rows select allowed pairs; never combine independent scope lists. */
@ForeignKey('system_roles', ['roleId', 'scopeProfile'], ['id', 'scopeProfile'])
@Check(
  "(scope_profile = 'billing_v1' AND scope_type IN ('catalog_global','all_customers','organizations') AND consumer_scope_type = 'not_applicable') OR (scope_profile = 'legal_v1' AND scope_type IN ('legal_global','issuers','applications') AND consumer_scope_type IN ('not_applicable','all_organizations','organizations'))",
)
@Entity('system_role_scopes')
export class SystemRoleScope {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ name: 'scope_profile', type: 'varchar', length: 24 })
  scopeProfile: SystemScopeProfile;

  @PrimaryColumn({ name: 'scope_type', type: 'varchar', length: 24 })
  scopeType: SystemResourceScope;

  @PrimaryColumn({ name: 'consumer_scope_type', type: 'varchar', length: 24 })
  consumerScopeType: SystemConsumerScope;
}
