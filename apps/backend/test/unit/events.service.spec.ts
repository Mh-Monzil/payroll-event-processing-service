import { NotFoundException } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { CustomLogger } from '../../src/shared/services/custom-logger.service';
import { EventsService } from '../../src/modules/events/events.service';
import { PayrollEvent } from '../../src/modules/events/entities/payroll-event.entity';
import { EventStatus } from '../../src/modules/events/enums/event-status.enum';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { SubmitEventDto } from '../../src/modules/events/dto/submit-event.dto';

const submission = {
  type: PayrollEventType.SALARY_CHANGE,
  employeeId: 'EMP-001',
  effectiveDate: '2026-09-01',
  payload: { newSalary: 75000, currency: 'EUR' },
} as SubmitEventDto;

const existingEvent = {
  id: 'a0000000-0000-4000-8000-000000000001',
  status: EventStatus.SUCCEEDED,
} as PayrollEvent;

const uniqueViolation = (): QueryFailedError =>
  new QueryFailedError('insert', [], { code: '23505' } as unknown as Error);

describe('EventsService', () => {
  let repository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    findAndCount: jest.Mock;
  };
  let manager: { create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: EventsService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      findAndCount: jest.fn(),
    };

    manager = {
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve({ id: 'new-event-id', sequence: '1', ...entity }),
      ),
    };

    dataSource = {
      transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
        work(manager as unknown as EntityManager),
      ),
    };

    service = new EventsService(
      repository as unknown as Repository<PayrollEvent>,
      dataSource as unknown as DataSource,
      { logWithTag: jest.fn() } as unknown as CustomLogger,
    );
  });

  it('persists a new event as PENDING with its first history row', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.submit(submission);

    expect(result.duplicate).toBe(false);
    expect(manager.save).toHaveBeenCalledTimes(2);
    expect(manager.create).toHaveBeenCalledWith(
      PayrollEvent,
      expect.objectContaining({
        employeeId: 'EMP-001',
        status: EventStatus.PENDING,
      }),
    );
  });

  it('returns the original event instead of writing a second one', async () => {
    repository.findOne.mockResolvedValue(existingEvent);

    const result = await service.submit(submission);

    expect(result).toEqual({ event: existingEvent, duplicate: true });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  // Two concurrent retries both get past the lookup above; the unique index is
  // what actually stops the second insert.
  it('treats a unique violation as a duplicate rather than a failure', async () => {
    repository.findOne.mockResolvedValue(null);
    repository.findOneOrFail.mockResolvedValue(existingEvent);
    dataSource.transaction.mockRejectedValue(uniqueViolation());

    const result = await service.submit(submission);

    expect(result).toEqual({ event: existingEvent, duplicate: true });
  });

  it('lets a genuine database failure surface', async () => {
    repository.findOne.mockResolvedValue(null);
    dataSource.transaction.mockRejectedValue(new Error('connection lost'));

    await expect(service.submit(submission)).rejects.toThrow('connection lost');
  });

  it('reports a missing event as 404 rather than null', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findById('missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('paginates from page and limit', async () => {
    repository.findAndCount.mockResolvedValue([[existingEvent], 42]);

    const page = await service.list({ page: 3, limit: 20 });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
    expect(page.totalPages).toBe(3);
  });
});
