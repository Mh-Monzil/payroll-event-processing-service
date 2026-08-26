import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CustomLogger } from '../../src/shared/services/custom-logger.service';
import { EventsService } from '../../src/modules/events/events.service';
import { EventStateService } from '../../src/modules/events/event-state.service';
import { PayrollEvent } from '../../src/modules/events/entities/payroll-event.entity';
import { EventStatusHistory } from '../../src/modules/events/entities/event-status-history.entity';
import { EventStatus } from '../../src/modules/events/enums/event-status.enum';
import { PayrollEventType } from '../../src/modules/events/enums/payroll-event-type.enum';
import { PayrollApplication } from '../../src/modules/processing/entities/payroll-application.entity';
import { ReconciliationService } from '../../src/modules/processing/reconciliation.service';
import { TEST_KEY_PREFIX, createTestDataSource } from './data-source';

const TIMEOUT_MS = 60_000;
const LONG_AGO = new Date(Date.now() - 10 * TIMEOUT_MS);

describe('reconciliation against a real database', () => {
  let dataSource: DataSource;
  let eventRepository: Repository<PayrollEvent>;
  let service: ReconciliationService;
  let enqueued: string[];

  const insertEvent = async (
    status: EventStatus,
    timestamps: Partial<
      Pick<PayrollEvent, 'processingStartedAt' | 'nextRetryAt'>
    > = {},
    stale = true,
  ): Promise<PayrollEvent> => {
    const event = await eventRepository.save(
      eventRepository.create({
        idempotencyKey: `${TEST_KEY_PREFIX}${randomUUID()}`,
        employeeId: 'EMP-001',
        type: PayrollEventType.SALARY_CHANGE,
        effectiveDate: '2026-09-01',
        payload: { newSalary: 1000, currency: 'EUR' },
        status,
        ...timestamps,
      }),
    );

    if (stale) {
      await dataSource.query(
        'update payroll_events set "createdAt" = $2 where id = $1',
        [event.id, LONG_AGO],
      );
    }

    return event;
  };

  const statusOf = async (id: string): Promise<EventStatus> =>
    (await eventRepository.findOneOrFail({ where: { id } })).status;

  const deleteTestRows = (): Promise<unknown> =>
    dataSource.query(
      'delete from payroll_events where "idempotencyKey" like $1',
      [`${TEST_KEY_PREFIX}%`],
    );

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    eventRepository = dataSource.getRepository(PayrollEvent);
  });

  // Also on the way out, so a finished run leaves the database as it found it.
  afterAll(async () => {
    await deleteTestRows();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await deleteTestRows();

    enqueued = [];
    service = new ReconciliationService(
      dataSource,
      {
        enqueue: (event: PayrollEvent) => {
          enqueued.push(event.id);
          return Promise.resolve();
        },
      } as unknown as EventsService,
      new EventStateService(eventRepository),
      { get: () => TIMEOUT_MS } as unknown as ConfigService,
      {
        warnWithTag: jest.fn(),
        errorWithTag: jest.fn(),
      } as unknown as CustomLogger,
    );
  });

  // A worker died after writing the ledger row but before settling the event.
  // The change must not be repeated, only recognised.
  it('settles a stuck event whose change is already in the ledger', async () => {
    const event = await insertEvent(EventStatus.PROCESSING, {
      processingStartedAt: LONG_AGO,
    });
    await dataSource.getRepository(PayrollApplication).save({
      eventId: event.id,
      employeeId: event.employeeId,
      externalRef: 'PRV-RECOVERED',
    });

    const summary = await service.sweep();

    expect(summary).toEqual({ settled: 1, requeued: 0 });
    expect(await statusOf(event.id)).toBe(EventStatus.SUCCEEDED);
    expect(enqueued).toHaveLength(0);
  });

  it('reclaims a stuck event that never got applied and re-queues it', async () => {
    const event = await insertEvent(EventStatus.PROCESSING, {
      processingStartedAt: LONG_AGO,
    });

    const summary = await service.sweep();

    expect(summary).toEqual({ settled: 0, requeued: 1 });
    expect(await statusOf(event.id)).toBe(EventStatus.PENDING);
    expect(enqueued).toEqual([event.id]);

    const history = await dataSource
      .getRepository(EventStatusHistory)
      .find({ where: { eventId: event.id } });
    expect(history.map((entry) => entry.toStatus)).toContain(
      EventStatus.PENDING,
    );
  });

  // The enqueue never reached Redis when the event was submitted.
  it('queues an event that was accepted but never handed to the queue', async () => {
    const event = await insertEvent(EventStatus.PENDING);

    const summary = await service.sweep();

    expect(summary.requeued).toBe(1);
    expect(enqueued).toEqual([event.id]);
    expect(await statusOf(event.id)).toBe(EventStatus.PENDING);
  });

  // Redis lost the delayed job, so nothing was ever going to wake this up.
  it('rescues a retry whose scheduled time passed long ago', async () => {
    const event = await insertEvent(EventStatus.AWAITING_RETRY, {
      nextRetryAt: LONG_AGO,
    });

    await service.sweep();

    expect(await statusOf(event.id)).toBe(EventStatus.PENDING);
    expect(enqueued).toEqual([event.id]);
  });

  // The guard that matters most: normal in-flight work must be left alone.
  it('leaves an event that is still within the timeout alone', async () => {
    const event = await insertEvent(
      EventStatus.PROCESSING,
      { processingStartedAt: new Date() },
      false,
    );

    const summary = await service.sweep();

    expect(summary).toEqual({ settled: 0, requeued: 0 });
    expect(await statusOf(event.id)).toBe(EventStatus.PROCESSING);
    expect(enqueued).toHaveLength(0);
  });

  it('never touches an event that has already settled', async () => {
    const succeeded = await insertEvent(EventStatus.SUCCEEDED);
    const failed = await insertEvent(EventStatus.FAILED);

    const summary = await service.sweep();

    expect(summary).toEqual({ settled: 0, requeued: 0 });
    expect(await statusOf(succeeded.id)).toBe(EventStatus.SUCCEEDED);
    expect(await statusOf(failed.id)).toBe(EventStatus.FAILED);
  });
});
