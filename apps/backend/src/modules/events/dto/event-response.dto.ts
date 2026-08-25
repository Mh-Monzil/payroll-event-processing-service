import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayrollEvent } from '../entities/payroll-event.entity';
import { EventStatus } from '../enums/event-status.enum';
import { FailureKind } from '../enums/failure-kind.enum';
import { PayrollEventType } from '../enums/payroll-event-type.enum';

export class EventFailureDto {
  @ApiProperty({ enum: FailureKind })
  kind!: FailureKind;

  @ApiProperty({ example: 'PROVIDER_UNAVAILABLE' })
  code!: string | null;

  @ApiProperty()
  message!: string | null;

  @ApiPropertyOptional()
  detail?: unknown;
}

export class EventTimestampsDto {
  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  queuedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  processingStartedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  completedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  nextRetryAt!: Date | null;
}

export class EventTransitionDto {
  @ApiPropertyOptional({ enum: EventStatus, nullable: true })
  from!: EventStatus | null;

  @ApiProperty({ enum: EventStatus })
  to!: EventStatus;

  @ApiProperty()
  attempt!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  message!: string | null;

  @ApiProperty()
  at!: Date;
}

export class EventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PayrollEventType })
  type!: PayrollEventType;

  @ApiProperty({ example: 'EMP-001' })
  employeeId!: string;

  @ApiProperty({ example: '2026-09-01' })
  effectiveDate!: string;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty({ enum: EventStatus })
  status!: EventStatus;

  @ApiProperty({ description: 'Acceptance order for this employee' })
  sequence!: string;

  @ApiProperty()
  attemptCount!: number;

  @ApiPropertyOptional({ type: EventFailureDto, nullable: true })
  failure!: EventFailureDto | null;

  @ApiPropertyOptional({ nullable: true, description: 'Provider result' })
  result!: unknown;

  @ApiProperty({ type: EventTimestampsDto })
  timestamps!: EventTimestampsDto;
}

export class EventDetailResponseDto extends EventResponseDto {
  @ApiProperty({ type: [EventTransitionDto] })
  history!: EventTransitionDto[];
}

export class SubmitEventResponseDto extends EventResponseDto {
  @ApiProperty({
    description:
      'True when this submission matched an event that was already accepted',
  })
  duplicate!: boolean;
}

const toFailure = (event: PayrollEvent): EventFailureDto | null =>
  event.failureKind === null
    ? null
    : {
        kind: event.failureKind,
        code: event.lastErrorCode,
        message: event.lastErrorMessage,
        detail: event.lastErrorDetail,
      };

export const toEventResponse = (event: PayrollEvent): EventResponseDto => ({
  id: event.id,
  type: event.type,
  employeeId: event.employeeId,
  effectiveDate: event.effectiveDate,
  payload: event.payload,
  status: event.status,
  sequence: event.sequence,
  attemptCount: event.attemptCount,
  failure: toFailure(event),
  result: event.result ?? null,
  timestamps: {
    createdAt: event.createdAt,
    queuedAt: event.queuedAt,
    processingStartedAt: event.processingStartedAt,
    completedAt: event.completedAt,
    nextRetryAt: event.nextRetryAt,
  },
});

export const toSubmitEventResponse = (
  event: PayrollEvent,
  duplicate: boolean,
): SubmitEventResponseDto => ({ ...toEventResponse(event), duplicate });

export const toEventDetailResponse = (
  event: PayrollEvent,
): EventDetailResponseDto => ({
  ...toEventResponse(event),
  history: (event.history ?? []).map((entry) => ({
    from: entry.fromStatus,
    to: entry.toStatus,
    attempt: entry.attempt,
    message: entry.message,
    at: entry.createdAt,
  })),
});
