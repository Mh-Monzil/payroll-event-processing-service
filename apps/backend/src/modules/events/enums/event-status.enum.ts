export enum EventStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  AWAITING_RETRY = 'AWAITING_RETRY',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export const TERMINAL_STATUSES: readonly EventStatus[] = [
  EventStatus.SUCCEEDED,
  EventStatus.FAILED,
];
