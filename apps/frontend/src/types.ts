export type EventStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'AWAITING_RETRY'
  | 'SUCCEEDED'
  | 'FAILED';

export const TERMINAL_STATUSES: EventStatus[] = ['SUCCEEDED', 'FAILED'];

export interface PayloadField {
  name: string;
  label: string;
  kind: 'text' | 'number';
  example: string;
}

export interface EventType {
  type: string;
  description: string;
  fields: PayloadField[];
}

export interface EventFailure {
  kind: 'PERMANENT' | 'RETRIES_EXHAUSTED';
  code: string | null;
  message: string | null;
  detail?: unknown;
}

export interface EventTimestamps {
  createdAt: string;
  queuedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  nextRetryAt: string | null;
}

export interface PayrollEvent {
  id: string;
  type: string;
  employeeId: string;
  effectiveDate: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  sequence: string;
  attemptCount: number;
  failure: EventFailure | null;
  result: unknown;
  timestamps: EventTimestamps;
  duplicate?: boolean;
}

export interface EventTransition {
  from: EventStatus | null;
  to: EventStatus;
  attempt: number;
  message: string | null;
  at: string;
}

export interface PayrollEventDetail extends PayrollEvent {
  history: EventTransition[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code?: string;
  fields?: { field: string; messages: string[] }[];
  knownTypes?: string[];
}
