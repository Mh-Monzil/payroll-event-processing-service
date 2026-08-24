import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Seeded reference data.
 *
 * Exists so that "employee does not exist" and "employee is inactive" are real,
 * demonstrable PERMANENT failures rather than hypothetical ones.
 */
@Entity('employees')
export class Employee {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  fullName: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
