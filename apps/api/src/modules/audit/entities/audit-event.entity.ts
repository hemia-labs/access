import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'actor_type' })
  actorType: string;

  @Column({ name: 'actor_issuer', type: 'varchar', nullable: true })
  actorIssuer: string | null;

  @Column({ name: 'actor_subject_id', type: 'varchar', nullable: true })
  actorSubjectId: string | null;

  @Column()
  action: string;

  @Column({ name: 'resource_type' })
  resourceType: string;

  @Column({ name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'before_snapshot', type: 'jsonb', nullable: true })
  beforeSnapshot: Record<string, unknown> | null;

  @Column({ name: 'after_snapshot', type: 'jsonb', nullable: true })
  afterSnapshot: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;
}
