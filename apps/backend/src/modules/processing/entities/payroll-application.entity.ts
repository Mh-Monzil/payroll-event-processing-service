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

@Entity('payroll_applications')
@Index(['employeeId', 'appliedAt'])
export class PayrollApplication {
  @PrimaryColumn({ type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 64 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalRef!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshotBefore!: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  appliedAt!: Date;

  @OneToOne(() => PayrollEvent, (event) => event.application, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventId' })
  event!: PayrollEvent;
}
