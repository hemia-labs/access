import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdentityReference } from '../../identity-references/entities/identity-reference.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { Product } from './product.entity';

export type OrganizationProductStatus =
  | 'pending'
  | 'provisioning'
  | 'enabled'
  | 'suspended'
  | 'disabled'
  | 'failed'
  | 'expired';
export type OrganizationProductSource =
  'manual' | 'billing' | 'contract' | 'migration' | 'internal';

@Entity('organization_products')
@Index('ux_org_products', ['organizationId', 'productId'], { unique: true })
@Index('ix_org_products_status', ['organizationId', 'status'])
export class OrganizationProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', default: 'pending' })
  status: OrganizationProductStatus;

  @Column({ type: 'varchar', default: 'manual' })
  source: OrganizationProductSource;

  @Column({ name: 'entitlement_reference', type: 'varchar', nullable: true })
  entitlementReference: string | null;

  @Column({ type: 'jsonb', default: {} })
  configuration: Record<string, unknown>;

  @Column({ name: 'enabled_at', type: 'timestamptz', nullable: true })
  enabledAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ default: 1 })
  version: number;

  @Column({ name: 'created_by_identity_id', type: 'uuid' })
  createdByIdentityId: string;

  @ManyToOne(() => IdentityReference)
  @JoinColumn({ name: 'created_by_identity_id' })
  createdByIdentity: IdentityReference;

  @Column({ name: 'updated_by_identity_id', type: 'uuid' })
  updatedByIdentityId: string;

  @ManyToOne(() => IdentityReference)
  @JoinColumn({ name: 'updated_by_identity_id' })
  updatedByIdentity: IdentityReference;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
