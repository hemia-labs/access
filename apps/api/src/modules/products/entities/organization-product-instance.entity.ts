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
import { OrganizationProduct } from './organization-product.entity';

export type ProductInstanceStatus = 'ready' | 'failed';

@Entity('organization_product_instances')
@Index('ux_product_instances_org_product', ['organizationProductId'], {
  unique: true,
})
export class OrganizationProductInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_product_id', type: 'uuid' })
  organizationProductId: string;

  @ManyToOne(() => OrganizationProduct)
  @JoinColumn({ name: 'organization_product_id' })
  organizationProduct: OrganizationProduct;

  @Column({ name: 'external_tenant_id', type: 'varchar', nullable: true })
  externalTenantId: string | null;

  @Column({ type: 'varchar' })
  status: ProductInstanceStatus;

  @Column({ name: 'provisioned_at', type: 'timestamptz', nullable: true })
  provisionedAt: Date | null;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
