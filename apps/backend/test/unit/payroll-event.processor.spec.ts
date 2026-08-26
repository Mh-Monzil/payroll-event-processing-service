import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CustomLogger } from '../../src/shared/services/custom-logger.service';
import {
  PermanentPayrollError,
  TransientProviderError,
} from '../../src/common/errors/payroll.errors';
import { ProcessEventJobData } from '../../src/config/queue.config';
import {
  EventStateService,
  TransitionOptions,
} from '../../src/modules/events/event-state.service';
import { PayrollEvent } from '../../src/modules/events/entities/payroll-event.entity';
import { EventStatus } from '../../src/modules/events/enums/event-status.enum';
import { FailureKind } from '../../src/modules/events/enums/failure-kind.enum';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { Employee } from '../../src/modules/payroll-state/entities/employee.entity';
import { EmployeePayrollState } from '../../src/modules/payroll-state/entities/employee-payroll-state.entity';
import { PayrollApplication } from '../../src/modules/processing/entities/payroll-application.entity';
import { PayrollEventProcessor } from '../../src/modules/processing/payroll-event.processor';
import { PayrollProviderService } from '../../src/modules/processing/provider/payroll-provider.service';

const EVENT_ID = 'a0000000-0000-4000-8000-000000000001';

const pendingEvent = (): PayrollEvent =>
  ({
    id: EVENT_ID,
    type: PayrollEventType.SALARY_CHANGE,
    employeeId: 'EMP-001',
    effectiveDate: '2026-09-01',
    payload: { newSalary: 75000, currency: 'EUR' },
    status: EventStatus.QUEUED,
    attemptCount: 0,
  }) as unknown as PayrollEvent;

const job = (attemptsMade = 0, attempts = 5): Job<ProcessEventJobData> =>
  ({
    data: { eventId: EVENT_ID },
    attemptsMade,
    opts: { attempts },
  }) as Job<ProcessEventJobData>;

interface RecordedTransition {
  status: EventStatus;
  options: TransitionOptions;
  manager?: EntityManager;
}

describe('PayrollEventProcessor', () => {
  let events: { findOne: jest.Mock };
  let applications: { findOne: jest.Mock };
  let employees: { findOne: jest.Mock };
  let states: { findOne: jest.Mock };
  let manager: { createQueryBuilder: jest.Mock; upsert: jest.Mock };
  let insertExecute: jest.Mock;
  let dataSource: { transaction: jest.Mock };
  let provider: { apply: jest.Mock };
  let transitions: RecordedTransition[];
  let processor: PayrollEventProcessor;

  const transitionTo = (status: EventStatus): RecordedTransition | undefined =>
    transitions.find((entry) => entry.status === status);

  beforeEach(() => {
    events = { findOne: jest.fn().mockResolvedValue(pendingEvent()) };
    applications = { findOne: jest.fn().mockResolvedValue(null) };
    employees = {
      findOne: jest.fn().mockResolvedValue({ id: 'EMP-001', active: true }),
    };
    states = { findOne: jest.fn().mockResolvedValue(null) };

    insertExecute = jest
      .fn()
      .mockResolvedValue({ raw: [{ eventId: EVENT_ID }] });
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: insertExecute,
    };
    manager = { createQueryBuilder: jest.fn(() => builder), upsert: jest.fn() };

    dataSource = {
      transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
        work(manager),
      ),
    };
    provider = {
      apply: jest.fn().mockResolvedValue({
        provider: 'simulated-payroll',
        externalRef: 'PRV-ABC123',
        acknowledgedAt: '2026-09-01T00:00:00.000Z',
      }),
    };

    transitions = [];
    const state: Pick<EventStateService, 'transition'> = {
      transition: (
        event: PayrollEvent,
        status: EventStatus,
        options: TransitionOptions = {},
        entityManager?: EntityManager,
      ) => {
        transitions.push({ status, options, manager: entityManager });
        return Promise.resolve(event);
      },
    };

    processor = new PayrollEventProcessor(
      events as unknown as Repository<PayrollEvent>,
      applications as unknown as Repository<PayrollApplication>,
      employees as unknown as Repository<Employee>,
      states as unknown as Repository<EmployeePayrollState>,
      dataSource as unknown as DataSource,
      provider as unknown as PayrollProviderService,
      state as EventStateService,
      { get: jest.fn(() => 1000) } as unknown as ConfigService,
      {
        logWithTag: jest.fn(),
        warnWithTag: jest.fn(),
        errorWithTag: jest.fn(),
      } as unknown as CustomLogger,
    );
  });

  describe('the happy path', () => {
    it('calls the provider, writes the state and settles as SUCCEEDED', async () => {
      const outcome = await processor.process(job());

      expect(outcome).toEqual({
        outcome: 'applied',
        externalRef: 'PRV-ABC123',
      });
      expect(provider.apply).toHaveBeenCalledTimes(1);
      expect(manager.upsert).toHaveBeenCalledWith(
        EmployeePayrollState,
        expect.objectContaining({
          employeeId: 'EMP-001',
          salaryAmount: '75000.00',
        }),
        ['employeeId'],
      );
      expect(transitionTo(EventStatus.SUCCEEDED)).toBeDefined();
    });

    it('writes the ledger, the state and the status in one transaction', async () => {
      await processor.process(job());

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(transitionTo(EventStatus.SUCCEEDED)?.manager).toBe(manager);
    });
  });

  describe('replay after a crash', () => {
    it('does nothing when the event is already terminal', async () => {
      events.findOne.mockResolvedValue({
        ...pendingEvent(),
        status: EventStatus.SUCCEEDED,
      });

      const outcome = await processor.process(job());

      expect(outcome).toEqual({ outcome: 'already-settled' });
      expect(provider.apply).not.toHaveBeenCalled();
    });

    // The crash window from requirement 8: the change was applied, but the job
    // never got acknowledged. The ledger row is what proves it happened.
    it('settles from the ledger without applying the change twice', async () => {
      applications.findOne.mockResolvedValue({
        eventId: EVENT_ID,
        externalRef: 'PRV-ABC123',
      });

      const outcome = await processor.process(job());

      expect(outcome.outcome).toBe('already-applied');
      expect(provider.apply).not.toHaveBeenCalled();
      expect(manager.upsert).not.toHaveBeenCalled();
      expect(transitionTo(EventStatus.SUCCEEDED)).toBeDefined();
    });

    // Two workers on the same job: the loser's insert is ignored, so it must
    // not re-apply the change, but it must still settle the event.
    it('skips the mutation when another worker won the ledger insert', async () => {
      insertExecute.mockResolvedValue({ raw: [] });

      await processor.process(job());

      expect(manager.upsert).not.toHaveBeenCalled();
      expect(transitionTo(EventStatus.SUCCEEDED)).toBeDefined();
    });
  });

  describe('failures', () => {
    it('fails an unknown employee permanently and stops BullMQ retrying', async () => {
      employees.findOne.mockResolvedValue(null);

      await expect(processor.process(job())).rejects.toThrow(
        UnrecoverableError,
      );

      expect(provider.apply).not.toHaveBeenCalled();
      expect(transitionTo(EventStatus.FAILED)?.options).toMatchObject({
        failureKind: FailureKind.PERMANENT,
        lastErrorCode: 'EMPLOYEE_NOT_FOUND',
      });
    });

    it('fails an inactive employee permanently', async () => {
      employees.findOne.mockResolvedValue({ id: 'EMP-005', active: false });

      await expect(processor.process(job())).rejects.toThrow(
        UnrecoverableError,
      );

      expect(transitionTo(EventStatus.FAILED)?.options).toMatchObject({
        lastErrorCode: 'EMPLOYEE_INACTIVE',
      });
    });

    it('parks the event for retry and rethrows so BullMQ owns the backoff', async () => {
      provider.apply.mockRejectedValue(
        new TransientProviderError('PROVIDER_UNAVAILABLE', 'down'),
      );

      await expect(processor.process(job(0, 5))).rejects.toBeInstanceOf(
        TransientProviderError,
      );

      const retry = transitionTo(EventStatus.AWAITING_RETRY);
      expect(retry?.options).toMatchObject({
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
      });
      expect(retry?.options.nextRetryAt).toBeInstanceOf(Date);
      expect(transitionTo(EventStatus.FAILED)).toBeUndefined();
    });

    it('marks the last failed attempt as RETRIES_EXHAUSTED', async () => {
      provider.apply.mockRejectedValue(
        new TransientProviderError('PROVIDER_UNAVAILABLE', 'down'),
      );

      await expect(processor.process(job(4, 5))).rejects.toThrow(
        UnrecoverableError,
      );

      expect(transitionTo(EventStatus.FAILED)?.options).toMatchObject({
        failureKind: FailureKind.RETRIES_EXHAUSTED,
      });
      expect(transitionTo(EventStatus.AWAITING_RETRY)).toBeUndefined();
    });

    it('rejects a currency switch without ever calling the provider', async () => {
      states.findOne.mockResolvedValue({
        employeeId: 'EMP-001',
        salaryCurrency: 'USD',
      });

      await expect(processor.process(job())).rejects.toThrow(
        UnrecoverableError,
      );

      expect(provider.apply).not.toHaveBeenCalled();
      expect(transitionTo(EventStatus.FAILED)?.options).toMatchObject({
        lastErrorCode: 'CURRENCY_MISMATCH',
      });
    });

    it('does not retry a job whose event has been deleted', async () => {
      events.findOne.mockResolvedValue(null);

      await expect(processor.process(job())).rejects.toThrow(
        UnrecoverableError,
      );
    });

    it('keeps a permanent provider rejection out of the retry path', async () => {
      provider.apply.mockRejectedValue(
        new PermanentPayrollError('REJECTED_BY_PROVIDER', 'no'),
      );

      await expect(processor.process(job(0, 5))).rejects.toThrow(
        UnrecoverableError,
      );

      expect(transitionTo(EventStatus.AWAITING_RETRY)).toBeUndefined();
    });
  });
});
