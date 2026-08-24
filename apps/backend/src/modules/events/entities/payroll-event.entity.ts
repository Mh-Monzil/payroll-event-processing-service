import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventStatus } from '../enums/event-status.enum';
import { FailureKind } from '../enums/failure-kind.enum';
import { EventStatusHistory } from './event-status-history.entity';
import { PayrollApplication } from '../../processing/entities/payroll-application.entity';

/**
 * The request log: what was asked, and where its processing has got to.
 *
 * This table is never the business state — that lives in EmployeePayrollState.
 * Keeping the two apart is what lets the payload stay schemaless per event type
 * while the state stays strongly typed.
 */
@Entity('payroll_events')
@Index(['employeeId', 'sequence'])
@Index(['status'])
export class PayrollEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The deduplication boundary. Either the client's Idempotency-Key header or a
   * hash derived from the business content. UNIQUE — the database is the only
   * race-free arbiter of "have we seen this request before".
   */
  @Column({ type: 'varchar', length: 128, unique: true })
  idempotencyKey: string;

  /**
   * Acceptance order, assigned by Postgres. NOT `createdAt`: two rows can share
   * a timestamp, and clocks on multiple API replicas drift. A sequence has one
   * authority and is strictly monotonic.
   *
   * NOTE: node-postgres returns bigint as a string. Never compare it in JS —
   * the ordering gate compares it in SQL.
   */
  @Column({ type: 'bigint' })
  @Generated('increment')
  sequence: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  /**
   * varchar, not a Postgres enum: a new event type must not require a migration.
   * Unknown types are rejected by the registry at the API edge, so bad data
   * still cannot get in.
   */
  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'date' })
  effectiveDate: string;

  /** Type-specific fields, already validated against the handler's DTO. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.PENDING })
  status: EventStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'enum', enum: FailureKind, nullable: true })
  failureKind: FailureKind | null;

  /** Stable machine-readable code, e.g. PROVIDER_UNAVAILABLE, EMPLOYEE_NOT_FOUND. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode: string | null;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  lastErrorDetail: unknown;

  /** Provider response on success, including the external reference. */
  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  queuedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @OneToMany(() => EventStatusHistory, (history) => history.event)
  history: EventStatusHistory[];

  @OneToOne(() => PayrollApplication, (application) => application.event)
  application: PayrollApplication | null;
}
