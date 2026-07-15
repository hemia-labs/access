import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type OutboxStatus =
  | 'pending'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'dead_letter';

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'aggregate_type' })
  aggregateType: string;

  @Column({ name: 'aggregate_id' })
  aggregateId: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ default: 'pending' })
  status: OutboxStatus;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
