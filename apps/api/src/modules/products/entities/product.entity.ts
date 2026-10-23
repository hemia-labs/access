import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProductAudience = 'internal' | 'customer' | 'mixed';
export type ProductProvisioningMode =
  'manual' | 'event_driven' | 'api_callback' | 'none';
export type ProductStatus = 'active' | 'deprecated' | 'disabled';

@Entity('products')
@Index('ux_products_code', ['code'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'internal' })
  audience: ProductAudience;

  @Column({ name: 'provisioning_mode', type: 'varchar', default: 'none' })
  provisioningMode: ProductProvisioningMode;

  @Column({ type: 'varchar', default: 'active' })
  status: ProductStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
