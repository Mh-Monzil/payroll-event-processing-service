import type {
  ApiError,
  EventType,
  Page,
  PayrollEvent,
  PayrollEventDetail,
} from './types';

interface Envelope<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code?: string;
    fields?: { field: string; messages: string[] }[];
    knownTypes?: string[];
  };
}

export class RequestFailed extends Error {
  constructor(readonly detail: ApiError) {
    super(detail.message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  const body = (await response.json()) as Envelope<T>;

  if (!response.ok || !body.success) {
    throw new RequestFailed({
      message: body.message || `Request failed with ${response.status}`,
      code: body.error?.code,
      fields: body.error?.fields,
      knownTypes: body.error?.knownTypes,
    });
  }

  return body.data as T;
};

export const fetchEventTypes = (): Promise<EventType[]> =>
  request<EventType[]>('/event-types');

export const fetchEvents = (): Promise<Page<PayrollEvent>> =>
  request<Page<PayrollEvent>>('/events?limit=50');

export const fetchEvent = (id: string): Promise<PayrollEventDetail> =>
  request<PayrollEventDetail>(`/events/${id}`);

export interface SubmitInput {
  type: string;
  employeeId: string;
  effectiveDate: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export const submitEvent = ({
  idempotencyKey,
  ...body
}: SubmitInput): Promise<PayrollEvent> =>
  request<PayrollEvent>('/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
