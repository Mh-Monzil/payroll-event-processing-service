import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CustomLogger } from '../../shared/services/custom-logger.service';
import { ProcessingTag } from '../../common/enums/logging-tag.enum';
import { PermanentPayrollError } from '../../common/errors/payroll.errors';
import { PAYROLL_QUEUE, ProcessEventJobData } from '../../config/queue.config';
import { EventStateService } from '../events/event-state.service';
import { PayrollEvent } from '../events/entities/payroll-event.entity';
import {
  EventStatus,
  TERMINAL_STATUSES,
} from '../events/enums/event-status.enum';
import { Employee } from '../payroll-state/entities/employee.entity';
import { EmployeePayrollState } from '../payroll-state/entities/employee-payroll-state.entity';
import { PayrollApplication } from './entities/payroll-application.entity';
import {
  PayrollProviderService,
  ProviderResult,
} from './provider/payroll-provider.service';
import { getEventHandler } from './handlers/event-handler.registry';
import { classifyFailure } from './failure-classifier';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);

export interface ProcessEventOutcome {
  outcome: 'applied' | 'already-applied' | 'already-settled';
  externalRef?: string;
}

@Processor(PAYROLL_QUEUE, { concurrency: CONCURRENCY })
export class PayrollEventProcessor extends WorkerHost {
  constructor(
    @InjectRepository(PayrollEvent)
    private readonly events: Repository<PayrollEvent>,
    @InjectRepository(PayrollApplication)
    private readonly applications: Repository<PayrollApplication>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeePayrollState)
    private readonly states: Repository<EmployeePayrollState>,
    private readonly dataSource: DataSource,
    private readonly provider: PayrollProviderService,
    private readonly state: EventStateService,
    private readonly configService: ConfigService,
    private readonly logger: CustomLogger,
  ) {
    super();
  }

  async process(job: Job<ProcessEventJobData>): Promise<ProcessEventOutcome> {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    const event = await this.events.findOne({
      where: { id: job.data.eventId },
    });

    if (!event) {
      throw new UnrecoverableError(
        `Event ${job.data.eventId} no longer exists`,
      );
    }

    if (TERMINAL_STATUSES.includes(event.status)) {
      return { outcome: 'already-settled' };
    }

    const applied = await this.applications.findOne({
      where: { eventId: event.id },
    });
    if (applied) {
      await this.settle(
        event,
        applied.externalRef,
        attempt,
        'Recovered: this change was already applied',
      );
      this.logger.logWithTag(
        ProcessingTag.RECOVERY,
        'Replayed job found the change already applied',
        { eventId: event.id, externalRef: applied.externalRef },
      );
      return {
        outcome: 'already-applied',
        externalRef: applied.externalRef ?? undefined,
      };
    }

    await this.state.transition(event, EventStatus.PROCESSING, {
      attempt,
      attemptCount: attempt,
      processingStartedAt: new Date(),
      message: `Attempt ${attempt} of ${maxAttempts}`,
    });

    this.logger.logWithTag(
      ProcessingTag.PROCESSING_STARTED,
      'Processing started',
      {
        eventId: event.id,
        type: event.type,
        attempt,
      },
    );

    try {
      const current = await this.runBusinessChecks(event);
      const result = await this.provider.apply(event);

      await this.apply(event, current, result, attempt);

      this.logger.logWithTag(
        ProcessingTag.PROCESSING_SUCCEEDED,
        'Processing succeeded',
        { eventId: event.id, attempt, externalRef: result.externalRef },
      );

      return { outcome: 'applied', externalRef: result.externalRef };
    } catch (error) {
      return this.fail(event, error, attempt, maxAttempts);
    }
  }

  private async runBusinessChecks(
    event: PayrollEvent,
  ): Promise<EmployeePayrollState | null> {
    const employee = await this.employees.findOne({
      where: { id: event.employeeId },
    });

    if (!employee) {
      throw new PermanentPayrollError(
        'EMPLOYEE_NOT_FOUND',
        `No employee with id ${event.employeeId}`,
      );
    }

    if (!employee.active) {
      throw new PermanentPayrollError(
        'EMPLOYEE_INACTIVE',
        `Employee ${event.employeeId} is not active`,
      );
    }

    const current = await this.states.findOne({
      where: { employeeId: event.employeeId },
    });

    getEventHandler(event.type).validate(event, current);

    return current;
  }

  private async apply(
    event: PayrollEvent,
    current: EmployeePayrollState | null,
    result: ProviderResult,
    attempt: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(PayrollApplication)
        .values({
          eventId: event.id,
          employeeId: event.employeeId,
          externalRef: result.externalRef,
          snapshotBefore: current,
        } as QueryDeepPartialEntity<PayrollApplication>)
        .orIgnore()
        .returning('"eventId"')
        .execute();

      const weAppliedIt = (insert.raw as unknown[]).length > 0;

      if (weAppliedIt) {
        await manager.upsert(
          EmployeePayrollState,
          {
            employeeId: event.employeeId,
            ...getEventHandler(event.type).buildPatch(event),
          },
          ['employeeId'],
        );
      }

      await this.state.transition(
        event,
        EventStatus.SUCCEEDED,
        {
          attempt,
          attemptCount: attempt,
          completedAt: new Date(),
          nextRetryAt: null,
          failureKind: null,
          result: { ...result, alreadyApplied: !weAppliedIt },
          message: weAppliedIt
            ? 'Applied'
            : 'Another worker had already applied this change',
        },
        manager,
      );
    });
  }

  private async settle(
    event: PayrollEvent,
    externalRef: string | null,
    attempt: number,
    message: string,
  ): Promise<void> {
    await this.state.transition(event, EventStatus.SUCCEEDED, {
      attempt,
      completedAt: new Date(),
      nextRetryAt: null,
      failureKind: null,
      result: { externalRef, alreadyApplied: true },
      message,
    });
  }

  private async fail(
    event: PayrollEvent,
    error: unknown,
    attempt: number,
    maxAttempts: number,
  ): Promise<never> {
    const failure = classifyFailure(error, attempt, maxAttempts);

    if (failure.retryable) {
      await this.state.transition(event, EventStatus.AWAITING_RETRY, {
        attempt,
        attemptCount: attempt,
        nextRetryAt: new Date(Date.now() + this.backoffDelay(attempt)),
        failureKind: null,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        lastErrorDetail: failure.detail,
        message: `Attempt ${attempt} of ${maxAttempts} failed: ${failure.code}`,
      });

      this.logger.warnWithTag(
        ProcessingTag.RETRY_SCHEDULED,
        'Retry scheduled',
        {
          eventId: event.id,
          attempt,
          maxAttempts,
          code: failure.code,
        },
      );

      throw error;
    }

    await this.state.transition(event, EventStatus.FAILED, {
      attempt,
      attemptCount: attempt,
      completedAt: new Date(),
      nextRetryAt: null,
      failureKind: failure.kind,
      lastErrorCode: failure.code,
      lastErrorMessage: failure.message,
      lastErrorDetail: failure.detail,
      message: `Failed permanently: ${failure.code}`,
    });

    this.logger.errorWithTag(
      ProcessingTag.PROCESSING_FAILED,
      `Event ${event.id} failed (${failure.kind})`,
      error,
    );

    throw new UnrecoverableError(failure.message);
  }

  private backoffDelay(attempt: number): number {
    const base = Number(this.configService.get<number>('JOB_BACKOFF_MS', 1000));
    return base * Math.pow(2, attempt - 1);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warnWithTag(
      ProcessingTag.JOB_STALLED,
      'Job stalled and will be reclaimed',
      { jobId },
    );
  }
}
