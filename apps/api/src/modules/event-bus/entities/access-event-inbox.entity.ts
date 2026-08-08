import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('access_event_inbox')
@Index('ux_access_event_inbox_event_id', ['eventId'], { unique: true })
export class AccessEventInbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', length: 160 })
  eventId: string;

  @Column({ name: 'event_type', length: 160 })
  eventType: string;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  correlationId: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;
}
