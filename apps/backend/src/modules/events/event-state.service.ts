import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { PayrollEvent } from './entities/payroll-event.entity';
import { EventStatus } from './enums/event-status.enum';
import { FailureKind } from './enums/failure-kind.enum';

export interface TransitionOptions {
  attempt?: number;
  message?: string;
  metadata?: unknown;
  processingStartedAt?: Date;
  completedAt?: Date | null;
  nextRetryAt?: Date | null;
  queuedAt?: Date;
  result?: unknown;
  failureKind?: FailureKind | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastErrorDetail?: unknown;
  attemptCount?: number;
}

@Injectable()
export class EventStateService {
  constructor(
    @InjectRepository(PayrollEvent)
    private readonly events: Repository<PayrollEvent>,
  ) {}

  async transition(
    event: PayrollEvent,
    to: EventStatus,
    options: TransitionOptions = {},
    manager?: EntityManager,
  ): Promise<PayrollEvent> {
    const runner = manager ?? this.events.manager;
    const from = event.status;

    const patch: QueryDeepPartialEntity<PayrollEvent> = { status: to };
    const assignable = [
      'processingStartedAt',
      'completedAt',
      'nextRetryAt',
      'queuedAt',
      'result',
      'failureKind',
      'lastErrorCode',
      'lastErrorMessage',
      'lastErrorDetail',
      'attemptCount',
    ] as const;

    for (const key of assignable) {
      if (options[key] !== undefined) {
        Object.assign(patch, { [key]: options[key] });
      }
    }

    await runner.update(PayrollEvent, { id: event.id }, patch);
    await runner.save(
      runner.create(EventStatusHistory, {
        eventId: event.id,
        fromStatus: from,
        toStatus: to,
        attempt: options.attempt ?? event.attemptCount,
        message: options.message ?? null,
        metadata: options.metadata ?? null,
      }),
    );

    return Object.assign(event, patch);
  }
}
