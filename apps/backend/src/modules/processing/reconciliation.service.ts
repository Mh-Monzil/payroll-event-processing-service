import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { CustomLogger } from '../../shared/services/custom-logger.service';
import { ProcessingTag } from '../../common/enums/logging-tag.enum';
import { EventsService } from '../events/events.service';
import { EventStateService } from '../events/event-state.service';
import { PayrollEvent } from '../events/entities/payroll-event.entity';
import { EventStatus } from '../events/enums/event-status.enum';
import { PayrollApplication } from './entities/payroll-application.entity';

const BATCH_SIZE = 50;

export interface ReconciliationSummary {
  settled: number;
  requeued: number;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsService,
    private readonly state: EventStateService,
    private readonly configService: ConfigService,
    private readonly logger: CustomLogger,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduledSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.errorWithTag(
        ProcessingTag.RECOVERY,
        'Reconciliation sweep failed',
        error,
      );
    }
  }

  async sweep(): Promise<ReconciliationSummary> {
    const cutoff = new Date(Date.now() - this.timeoutMs());
    const summary: ReconciliationSummary = { settled: 0, requeued: 0 };
    const requeue: PayrollEvent[] = [];

    await this.dataSource.transaction(async (manager) => {
      for (const event of await this.claimStale(manager, cutoff)) {
        const applied = await manager.findOne(PayrollApplication, {
          where: { eventId: event.id },
        });

        if (applied) {
          await this.state.transition(
            event,
            EventStatus.SUCCEEDED,
            {
              completedAt: new Date(),
              nextRetryAt: null,
              failureKind: null,
              result: {
                externalRef: applied.externalRef,
                alreadyApplied: true,
              },
              message: 'Reconciled: the change was already applied',
            },
            manager,
          );
          summary.settled += 1;
          continue;
        }

        if (event.status !== EventStatus.PENDING) {
          await this.state.transition(
            event,
            EventStatus.PENDING,
            {
              processingStartedAt: undefined,
              nextRetryAt: null,
              message: `Reclaimed from ${event.status} after no progress`,
            },
            manager,
          );
        }

        requeue.push(event);
      }
    });

    for (const event of requeue) {
      await this.events.enqueue(event);
      summary.requeued += 1;
    }

    if (summary.settled > 0 || summary.requeued > 0) {
      this.logger.warnWithTag(
        ProcessingTag.RECOVERY,
        'Reconciliation recovered stranded events',
        summary,
      );
    }

    return summary;
  }

  private claimStale(
    manager: EntityManager,
    cutoff: Date,
  ): Promise<PayrollEvent[]> {
    return manager
      .createQueryBuilder(PayrollEvent, 'event')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where(
        `(event.status = :pending AND event."createdAt" < :cutoff)
          OR (event.status = :processing AND event."processingStartedAt" < :cutoff)
          OR (event.status = :retrying AND event."nextRetryAt" < :cutoff)`,
        {
          pending: EventStatus.PENDING,
          processing: EventStatus.PROCESSING,
          retrying: EventStatus.AWAITING_RETRY,
          cutoff,
        },
      )
      .orderBy('event.sequence', 'ASC')
      .limit(BATCH_SIZE)
      .getMany();
  }

  private timeoutMs(): number {
    return Number(
      this.configService.get<number>('STUCK_EVENT_TIMEOUT_MS', 120000),
    );
  }
}
