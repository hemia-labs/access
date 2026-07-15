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
import { Organization } from '../../organizations/entities/organization.entity';
import type { AccessScope, CatalogStatus } from './permission.entity';

@Entity('roles')
@Index('ux_roles_global_code', ['code'], {
  unique: true,
  where: '"organization_id" IS NULL',
})
@Index('ux_roles_org_code', ['organizationId', 'code'], {
  unique: true,
  where: '"organization_id" IS NOT NULL',
})
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar' })
  scope: AccessScope;

  @Column({ type: 'varchar', default: 'active' })
  status: CatalogStatus;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
