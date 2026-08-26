import type { EventStatus } from '../types';

const LABELS: Record<EventStatus, string> = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  AWAITING_RETRY: 'Retrying',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
};

export const StatusBadge = ({ status }: { status: EventStatus }) => (
  <span className={`status status--${status.toLowerCase()}`}>
    <span className="status__dot" />
    {LABELS[status]}
  </span>
);
