import { DataSource } from 'typeorm';
import {
  LOCK_BUSY,
  EmployeeLockService,
} from '../../src/modules/processing/ordering/employee-lock.service';

describe('EmployeeLockService', () => {
  let query: jest.Mock;
  let release: jest.Mock;
  let service: EmployeeLockService;

  const acquired = (yes: boolean) =>
    query.mockImplementation((sql: string) =>
      sql.includes('pg_try_advisory_lock')
        ? Promise.resolve([{ acquired: yes }])
        : Promise.resolve([]),
    );

  const callsMatching = (fragment: string): unknown[][] =>
    (query.mock.calls as unknown[][]).filter((call) =>
      String(call[0]).includes(fragment),
    );

  const unlockCalls = (): unknown[][] => callsMatching('pg_advisory_unlock');

  beforeEach(() => {
    query = jest.fn();
    release = jest.fn();
    service = new EmployeeLockService({
      createQueryRunner: () => ({
        connect: jest.fn(),
        query,
        release,
      }),
    } as unknown as DataSource);
  });

  it('runs the work while holding the lock, then releases everything', async () => {
    acquired(true);

    const result = await service.runExclusively('EMP-001', () =>
      Promise.resolve('done'),
    );

    expect(result).toBe('done');
    expect(unlockCalls()).toHaveLength(1);
    expect(release).toHaveBeenCalled();
  });

  // A worker that blocks on a lock is a worker not processing anyone else.
  it('gives up immediately rather than waiting when the lock is taken', async () => {
    acquired(false);
    const work = jest.fn();

    const result = await service.runExclusively('EMP-001', work);

    expect(result).toBe(LOCK_BUSY);
    expect(work).not.toHaveBeenCalled();
    expect(unlockCalls()).toHaveLength(0);
    expect(release).toHaveBeenCalled();
  });

  // Leaking an advisory lock would wedge every later event for that employee.
  it('releases the lock even when the work throws', async () => {
    acquired(true);

    await expect(
      service.runExclusively('EMP-001', () =>
        Promise.reject(new Error('provider exploded')),
      ),
    ).rejects.toThrow('provider exploded');

    expect(unlockCalls()).toHaveLength(1);
    expect(release).toHaveBeenCalled();
  });

  it('locks per employee rather than globally', async () => {
    acquired(true);

    await service.runExclusively('EMP-007', () => Promise.resolve(null));

    expect(callsMatching('pg_try_advisory_lock')[0]?.[1]).toEqual([
      expect.any(Number),
      'EMP-007',
    ]);
  });
});
