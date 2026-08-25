import dataSource from '../../config/typeorm.config';
import { Employee } from '../../modules/payroll-state/entities/employee.entity';

/**
 * Reference employees.
 *
 * EMP-005 is inactive on purpose: it makes "employee is inactive" a real,
 * demonstrable PERMANENT failure rather than a hypothetical one. Submitting an
 * event for an unknown id such as EMP-999 demonstrates the other permanent case.
 */
const EMPLOYEES: Array<Pick<Employee, 'id' | 'fullName' | 'active'>> = [
  { id: 'EMP-001', fullName: 'Ada Lovelace', active: true },
  { id: 'EMP-002', fullName: 'Grace Hopper', active: true },
  { id: 'EMP-003', fullName: 'Alan Turing', active: true },
  { id: 'EMP-004', fullName: 'Katherine Johnson', active: true },
  { id: 'EMP-005', fullName: 'Terminated Tom', active: false },
];

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    const repository = dataSource.getRepository(Employee);

    // Idempotent: re-running the seed must not fail or duplicate.
    await repository.upsert(EMPLOYEES, ['id']);

    const count = await repository.count();
    process.stdout.write(`Seeded employees. Total in table: ${count}\n`);
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${String(error)}\n`);
  process.exit(1);
});
