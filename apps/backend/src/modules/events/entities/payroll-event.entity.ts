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
import { PayrollEventType } from '../enums/payroll-event-type.enum';
import { EventStatusHistory } from './event-status-history.entity';
import { PayrollApplication } from '../../processing/entities/payroll-application.entity';

@Entity('payroll_events')
@Index(['employeeId', 'sequence'])
@Index(['status'])
export class PayrollEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  idempotencyKey!: string;

  @Column({ type: 'bigint' })
  @Generated('increment')
  sequence!: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: PayrollEventType;

  @Column({ type: 'date' })
  effectiveDate!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.PENDING })
  status!: EventStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'enum', enum: FailureKind, nullable: true })
  failureKind!: FailureKind | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  lastErrorDetail!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  result!: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  queuedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @OneToMany(() => EventStatusHistory, (history) => history.event)
  history!: EventStatusHistory[];

  @OneToOne(() => PayrollApplication, (application) => application.event)
  application!: PayrollApplication | null;
}
