/** Never succeeds, no matter how many times it is retried. Stop immediately. */
export class PermanentPayrollError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'PermanentPayrollError';
  }
}

/** The external system was unavailable or slow. Worth retrying with backoff. */
export class TransientProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

/** The submitted `type` has no registered handler. Rejected at the API edge. */
export class UnknownEventTypeError extends Error {
  constructor(
    readonly type: string,
    readonly knownTypes: string[],
  ) {
    super(
      `Unknown event type "${type}". Supported types: ${knownTypes.join(', ')}`,
    );
    this.name = 'UnknownEventTypeError';
  }
}
