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

export type MembershipStatus =
  'pending' | 'active' | 'suspended' | 'revoked' | 'expired';
export type MembershipType =
  'member' | 'owner' | 'external_collaborator' | 'service';

@Entity('organization_memberships')
@Index(
  'ux_membership_org_identity',
  ['organizationId', 'identityReferenceId'],
  { unique: true },
)
@Index('ix_memberships_identity_status', ['identityReferenceId', 'status'])
@Index('ix_memberships_org_status', ['organizationId', 'status'])
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'identity_reference_id', type: 'uuid' })
  identityReferenceId: string;

  @ManyToOne(() => IdentityReference)
  @JoinColumn({ name: 'identity_reference_id' })
  identityReference: IdentityReference;

  @Column({ type: 'varchar', default: 'pending' })
  status: MembershipStatus;

  @Column({ name: 'membership_type', type: 'varchar', default: 'member' })
  membershipType: MembershipType;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ default: 1 })
  version: number;

  @Column({ name: 'context_version', default: 1 })
  contextVersion: number;

  @Column({ name: 'created_by_identity_id', type: 'uuid' })
  createdByIdentityId: string;

  @Column({ name: 'updated_by_identity_id', type: 'uuid' })
  updatedByIdentityId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
