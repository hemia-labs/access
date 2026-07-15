import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Membership } from '../../memberships/entities/membership.entity';
import { IdentityReference } from '../../identity-references/entities/identity-reference.entity';
import { Role } from './role.entity';

@Entity('membership_roles')
export class MembershipRole {
  @PrimaryColumn({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @ManyToOne(() => Membership)
  @JoinColumn({ name: 'membership_id' })
  membership: Membership;

  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'assigned_by_identity_id', type: 'uuid' })
  assignedByIdentityId: string;

  @ManyToOne(() => IdentityReference)
  @JoinColumn({ name: 'assigned_by_identity_id' })
  assignedByIdentity: IdentityReference;

  @Column({ name: 'assigned_at', type: 'timestamptz', default: () => 'now()' })
  assignedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}
