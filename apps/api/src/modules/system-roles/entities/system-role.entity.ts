import type { SystemScopeProfile } from '../authorization/system-resource-scope';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Check,
  Unique,
  ForeignKey,
} from 'typeorm';

/** Expanded metadata; requires the coordinated Legal scope migration before deployment. */
@ForeignKey('products', ['productId'], ['id'])
@Unique(['productId', 'code', 'catalogVersion'])
@Check('contract_version > 0 AND catalog_version > 0')
@Check("status IN ('active','disabled')")
@Unique(['id', 'scopeProfile'])
@Check("scope_profile IN ('billing_v1','legal_v1')")
@Entity('system_roles')
export class SystemRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_profile', type: 'varchar', length: 24 })
  scopeProfile: SystemScopeProfile;

  /** Closed by PostgreSQL at the end of the creation transaction. Never exposed in DTOs. */
  @Column({ type: 'boolean', default: false })
  sealed: boolean;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'code', type: 'varchar', length: 120 })
  code: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'contract_version', type: 'integer', default: 1 })
  contractVersion: number;

  @Column({ name: 'catalog_version', type: 'integer' })
  catalogVersion: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'disabled';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
