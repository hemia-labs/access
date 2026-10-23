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

export type OrganizationType =
  'internal' | 'customer' | 'partner' | 'vendor' | 'sandbox';

export type OrganizationStatus =
  'pending' | 'active' | 'suspended' | 'archived';

@Entity('organizations')
@Index('ux_organizations_code', ['code'], { unique: true })
@Index('ux_organizations_slug_active', ['slug'], {
  unique: true,
  where: '"archived_at" IS NULL',
})
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string;

  @Column()
  slug: string;

  @Column()
  name: string;

  @Column({ name: 'legal_name', type: 'varchar', nullable: true })
  legalName: string | null;

  @Column({ type: 'varchar' })
  type: OrganizationType;

  @Column({ type: 'varchar', default: 'pending' })
  status: OrganizationStatus;

  @Column({ name: 'country_code', type: 'varchar', nullable: true })
  countryCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  timezone: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

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

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
