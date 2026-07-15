import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type IdentityType = 'workforce_user' | 'customer_user' | 'service_account';
export type IdentityReferenceStatus = 'active' | 'disabled';

@Entity('identity_references')
@Index('ux_identity_references_issuer_subject', ['issuer', 'subjectId'], {
  unique: true,
})
export class IdentityReference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  issuer: string;

  @Column({ name: 'subject_id' })
  subjectId: string;

  @Column({ name: 'identity_type' })
  identityType: IdentityType;

  @Column({ name: 'email_snapshot', type: 'varchar', nullable: true })
  emailSnapshot: string | null;

  @Column({ name: 'display_name_snapshot', type: 'varchar', nullable: true })
  displayNameSnapshot: string | null;

  @Column({ name: 'avatar_url_snapshot', type: 'varchar', nullable: true })
  avatarUrlSnapshot: string | null;

  @Column({ default: 'active' })
  status: IdentityReferenceStatus;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
