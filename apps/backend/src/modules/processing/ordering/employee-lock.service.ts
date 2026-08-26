import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const LOCK_NAMESPACE = 4207;

export const LOCK_BUSY = Symbol('LOCK_BUSY');

@Injectable()
export class EmployeeLockService {
  constructor(private readonly dataSource: DataSource) {}

  async runExclusively<T>(
    employeeId: string,
    work: () => Promise<T>,
  ): Promise<T | typeof LOCK_BUSY> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();

    try {
      const rows = (await runner.query(
        'select pg_try_advisory_lock($1, hashtext($2)) as acquired',
        [LOCK_NAMESPACE, employeeId],
      )) as { acquired: boolean }[];

      if (!rows[0]?.acquired) {
        return LOCK_BUSY;
      }

      try {
        return await work();
      } finally {
        await runner.query('select pg_advisory_unlock($1, hashtext($2))', [
          LOCK_NAMESPACE,
          employeeId,
        ]);
      }
    } finally {
      await runner.release();
    }
  }
}
