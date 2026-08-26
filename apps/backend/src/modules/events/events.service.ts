import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  DataSource,
  FindOptionsWhere,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { CustomLogger } from '../../shared/services/custom-logger.service';
import { ProcessingTag } from '../../common/enums/logging-tag.enum';
import { PaginatedData } from '../../common/interfaces/api-response.interface';
import {
  PAYROLL_QUEUE,
  PROCESS_EVENT_JOB,
  createJobOptions,
} from '../../config/queue.config';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { PayrollEvent } from './entities/payroll-event.entity';
import { EventStatus } from './enums/event-status.enum';
import { SubmitEventDto } from './dto/submit-event.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { resolveIdempotencyKey } from './idempotency';
import { EventStateService } from './event-state.service';

const UNIQUE_VIOLATION = '23505';

export interface SubmissionResult {
  event: PayrollEvent;
  duplicate: boolean;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(PayrollEvent)
    private readonly events: Repository<PayrollEvent>,
    @InjectQueue(PAYROLL_QUEUE)
    private readonly queue: Queue,
    private readonly dataSource: DataSource,
    private readonly state: EventStateService,
    private readonly configService: ConfigService,
    private readonly logger: CustomLogger,
  ) {}

  async submit(
    dto: SubmitEventDto,
    clientKey?: string,
  ): Promise<SubmissionResult> {
    const idempotencyKey = resolveIdempotencyKey(dto, clientKey);

    const alreadyAccepted = await this.events.findOne({
      where: { idempotencyKey },
    });
    if (alreadyAccepted) {
      return this.replay(alreadyAccepted);
    }

    try {
      const event = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(PayrollEvent, {
            idempotencyKey,
            employeeId: dto.employeeId,
            type: dto.type,
            effectiveDate: dto.effectiveDate,
            payload: dto.payload,
            status: EventStatus.PENDING,
          }),
        );

        await manager.save(
          manager.create(EventStatusHistory, {
            eventId: created.id,
            fromStatus: null,
            toStatus: EventStatus.PENDING,
            attempt: 0,
            message: 'Accepted for processing',
          }),
        );

        return created;
      });

      this.logger.logWithTag(ProcessingTag.EVENT_ACCEPTED, 'Event accepted', {
        eventId: event.id,
        type: event.type,
        employeeId: event.employeeId,
        sequence: event.sequence,
      });

      await this.enqueue(event);

      return { event, duplicate: false };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.events.findOneOrFail({
          where: { idempotencyKey },
        });
        return this.replay(existing);
      }
      throw error;
    }
  }

  async enqueue(event: PayrollEvent): Promise<void> {
    try {
      await this.queue.add(
        PROCESS_EVENT_JOB,
        { eventId: event.id },
        {
          ...createJobOptions(this.configService),
          jobId: event.id,
        },
      );

      await this.state.transition(event, EventStatus.QUEUED, {
        queuedAt: new Date(),
        message: 'Queued for processing',
      });
    } catch (error) {
      this.logger.errorWithTag(
        ProcessingTag.PROCESSING_DEFERRED,
        `Could not queue event ${event.id}; it stays PENDING for reconciliation`,
        error,
      );
    }
  }

  async findById(id: string): Promise<PayrollEvent> {
    const event = await this.events.findOne({
      where: { id },
      relations: { history: true },
      order: { history: { createdAt: 'ASC' } },
    });

    if (!event) {
      throw new NotFoundException({
        code: 'EVENT_NOT_FOUND',
        message: `No event with id ${id}`,
      });
    }

    return event;
  }

  async list(query: ListEventsQueryDto): Promise<PaginatedData<PayrollEvent>> {
    const where: FindOptionsWhere<PayrollEvent> = {};
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.type) {
      where.type = query.type;
    }

    const [items, total] = await this.events.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  private replay(event: PayrollEvent): SubmissionResult {
    this.logger.logWithTag(
      ProcessingTag.EVENT_DUPLICATE,
      'Duplicate submission ignored',
      { eventId: event.id, status: event.status },
    );
    return { event, duplicate: true };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code ===
        UNIQUE_VIOLATION
    );
  }
}
