import { StatusBadge } from './StatusBadge';
import type { PayrollEventDetail } from '../types';

const when = (value: string | null) =>
  value ? new Date(value).toLocaleTimeString() : '—';

export const EventDetail = ({ event }: { event: PayrollEventDetail }) => (
  <div className="panel">
    <h2>
      {event.type} <StatusBadge status={event.status} />
    </h2>

    <dl className="facts">
      <dt>Employee</dt>
      <dd>{event.employeeId}</dd>
      <dt>Effective</dt>
      <dd>{event.effectiveDate}</dd>
      <dt>Accepted as</dt>
      <dd>#{event.sequence}</dd>
      <dt>Attempts</dt>
      <dd>{event.attemptCount}</dd>
      <dt>Submitted</dt>
      <dd>{when(event.timestamps.createdAt)}</dd>
      <dt>Finished</dt>
      <dd>{when(event.timestamps.completedAt)}</dd>
      {event.timestamps.nextRetryAt && (
        <>
          <dt>Next retry</dt>
          <dd>{when(event.timestamps.nextRetryAt)}</dd>
        </>
      )}
    </dl>

    <h3>Submitted values</h3>
    <pre>{JSON.stringify(event.payload, null, 2)}</pre>

    {event.failure && (
      <div className="error">
        <strong>
          {event.failure.code} ·{' '}
          {event.failure.kind === 'PERMANENT'
            ? 'will never succeed'
            : 'gave up after retrying'}
        </strong>
        <p>{event.failure.message}</p>
      </div>
    )}

    {!!event.result && (
      <>
        <h3>Provider result</h3>
        <pre>{JSON.stringify(event.result, null, 2)}</pre>
      </>
    )}

    {/* The audit trail: every attempt and every recovery, in order. */}
    <h3>History</h3>
    <ol className="history">
      {event.history.map((entry, index) => (
        <li key={index}>
          <span className="history__time">{when(entry.at)}</span>
          <span className="history__move">
            {entry.from ?? 'submitted'} → <strong>{entry.to}</strong>
          </span>
          {entry.message && (
            <span className="history__message">{entry.message}</span>
          )}
        </li>
      ))}
    </ol>
  </div>
);
