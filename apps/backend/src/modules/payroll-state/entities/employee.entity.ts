import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('employees')
export class Employee {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  fullName!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
