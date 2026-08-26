import type { EventStatus } from '../types';

const LABELS: Record<EventStatus, string> = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  AWAITING_RETRY: 'Awaiting retry',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
};

export const StatusBadge = ({ status }: { status: EventStatus }) => (
  <span className={`badge badge--${status.toLowerCase()}`}>
    {LABELS[status]}
  </span>
);
