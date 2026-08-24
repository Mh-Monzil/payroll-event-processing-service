/**
 * Why a FAILED event failed.
 *
 * Kept as a separate column rather than two statuses: the API and UI only need
 * "is it terminal, and did it work". The reason is a second dimension, and
 * splitting it keeps status queries and indexes simple.
 */
export enum FailureKind {
  /** A business rule was violated. Retrying can never help. */
  PERMANENT = 'PERMANENT',
  /** Transient errors that never cleared within the attempt budget. */
  RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED',
}
