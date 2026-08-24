import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { PayrollEvent } from '../../events/entities/payroll-event.entity';

/**
 * THE exactly-once ledger.
 *
 * One row means: this event's payroll change has been applied to the employee's
 * state. The primary key on `eventId` is the entire guarantee — the apply
 * transaction inserts here FIRST with `ON CONFLICT DO NOTHING RETURNING`, so a
 * replayed job inserts nothing, skips the mutation, and cannot apply twice.
 *
 * Deliberately a separate table rather than a `status = SUCCEEDED` check:
 * `status` is our workflow state, this is a business fact. They are written in
 * the same transaction so they cannot disagree, and this one carries the audit
 * detail a status column cannot.
 */
@Entity('payroll_applications')
@Index(['employeeId', 'appliedAt'])
export class PayrollApplication {
  @PrimaryColumn({ type: 'uuid' })
  eventId: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  /** Reference returned by the external payroll system. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  externalRef: string | null;

  /** The employee's payroll state immediately before this change was applied. */
  @Column({ type: 'jsonb', nullable: true })
  snapshotBefore: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  appliedAt: Date;

  @OneToOne(() => PayrollEvent, (event) => event.application, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventId' })
  event: PayrollEvent;
}
