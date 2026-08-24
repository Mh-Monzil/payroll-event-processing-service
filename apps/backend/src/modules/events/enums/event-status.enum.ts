/**
 * Six states, two of them terminal.
 *
 *                     ┌──────────────► SUCCEEDED  (terminal)
 *                     │
 * PENDING ─► QUEUED ─► PROCESSING ─┬─► FAILED (PERMANENT)         (terminal)
 *    ▲                   │         └─► FAILED (RETRIES_EXHAUSTED) (terminal)
 *    │                   └─► AWAITING_RETRY ─┐
 *    └──── reconciliation ───────────────────┘
 */
export enum EventStatus {
  /** Committed to Postgres. Not on the queue yet. */
  PENDING = 'PENDING',
  /** Job accepted by BullMQ. */
  QUEUED = 'QUEUED',
  /** A worker holds it. */
  PROCESSING = 'PROCESSING',
  /** Transient failure; `nextRetryAt` says when BullMQ will try again. */
  AWAITING_RETRY = 'AWAITING_RETRY',
  /** Terminal: the payroll change is applied and the ledger row exists. */
  SUCCEEDED = 'SUCCEEDED',
  /** Terminal: see `failureKind` for why. */
  FAILED = 'FAILED',
}

export const TERMINAL_STATUSES: readonly EventStatus[] = [
  EventStatus.SUCCEEDED,
  EventStatus.FAILED,
];
