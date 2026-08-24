import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventStatus } from '../enums/event-status.enum';
import { PayrollEvent } from './payroll-event.entity';

/**
 * Append-only audit trail: one row per state transition, never updated, never
 * deleted.
 *
 * The status columns on PayrollEvent answer "what is it now" cheaply. This table
 * answers "how did it get here" completely — including every retry attempt and
 * every recovery action.
 */
@Entity('event_status_history')
@Index(['eventId', 'createdAt'])
export class EventStatusHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @Column({ type: 'enum', enum: EventStatus, nullable: true })
  fromStatus: EventStatus | null;

  @Column({ type: 'enum', enum: EventStatus })
  toStatus: EventStatus;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => PayrollEvent, (event) => event.history, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventId' })
  event: PayrollEvent;
}
