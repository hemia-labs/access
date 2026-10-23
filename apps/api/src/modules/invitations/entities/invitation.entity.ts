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

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

@Entity('organization_invitations')
@Index('ix_invitations_org_status', ['organizationId', 'status'])
@Index('ux_invitations_token_hash', ['tokenHash'], { unique: true })
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'email_normalized' })
  emailNormalized: string;

  @Column({ name: 'identity_issuer_hint', type: 'varchar', nullable: true })
  identityIssuerHint: string | null;

  @Column({ name: 'product_code', type: 'varchar', nullable: true })
  productCode: string | null;

  @Column({ name: 'role_codes', type: 'jsonb', default: [] })
  roleCodes: string[];

  @Column({ name: 'token_hash' })
  tokenHash: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: InvitationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_by_identity_id', type: 'uuid', nullable: true })
  acceptedByIdentityId: string | null;

  @ManyToOne(() => IdentityReference, { nullable: true })
  @JoinColumn({ name: 'accepted_by_identity_id' })
  acceptedByIdentity: IdentityReference | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'created_by_identity_id', type: 'uuid' })
  createdByIdentityId: string;

  @ManyToOne(() => IdentityReference)
  @JoinColumn({ name: 'created_by_identity_id' })
  createdByIdentity: IdentityReference;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
