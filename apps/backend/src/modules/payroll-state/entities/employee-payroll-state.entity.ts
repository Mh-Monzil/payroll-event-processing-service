import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The materialised current payroll state of an employee — the thing payroll
 * events actually change.
 *
 * Strongly typed columns on purpose: this is what gets queried and constrained.
 * The event log stays JSON so new event types need no migration; the state does
 * not, because it must be trustworthy.
 */
@Entity('employee_payroll_states')
export class EmployeePayrollState {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  employeeId: string;

  @Column({ type: 'varchar', length: 34, nullable: true })
  iban: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  street: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  postalCode: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  country: string | null;

  /**
   * numeric, and node-postgres returns it as a string. That is what we want —
   * money must never round-trip through a JS float.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  salaryAmount: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  salaryCurrency: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastAppliedEventId: string | null;

  @Column({ type: 'date', nullable: true })
  lastEffectiveDate: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
