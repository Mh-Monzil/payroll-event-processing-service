import { useMemo, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { humanise, relative } from '../lib/format';
import type { EventStatus, PayrollEvent } from '../types';

type Filter = 'all' | 'in-flight' | 'succeeded' | 'failed';

const IN_FLIGHT: EventStatus[] = [
  'PENDING',
  'QUEUED',
  'PROCESSING',
  'AWAITING_RETRY',
];

const matches = (event: PayrollEvent, filter: Filter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'succeeded') return event.status === 'SUCCEEDED';
  if (filter === 'failed') return event.status === 'FAILED';
  return IN_FLIGHT.includes(event.status);
};

interface Props {
  events: PayrollEvent[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

export const EventList = ({ events, selectedId, loading, onSelect }: Props) => {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: events.length,
      'in-flight': events.filter((event) => matches(event, 'in-flight')).length,
      succeeded: events.filter((event) => matches(event, 'succeeded')).length,
      failed: events.filter((event) => matches(event, 'failed')).length,
    }),
    [events],
  );

  const visible = events.filter((event) => matches(event, filter));

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'in-flight', label: 'In flight' },
    { key: 'succeeded', label: 'Succeeded' },
    { key: 'failed', label: 'Failed' },
  ];

  return (
    <section className="card">
      <header className="card__head">
        <h2 className="card__title">Events</h2>
        <span className="card__hint">newest first</span>
      </header>

      <div className="filters">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={filter === chip.key ? 'chip chip--active' : 'chip'}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
            <span className="chip__count">{counts[chip.key]}</span>
          </button>
        ))}
      </div>

      {loading && events.length === 0 && (
        <div>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="empty">
          <span className="empty__icon" aria-hidden="true">
            ◷
          </span>
          <span className="empty__title">
            {events.length === 0 ? 'No events yet' : 'Nothing in this filter'}
          </span>
          <span className="empty__text">
            {events.length === 0
              ? 'Submit one on the left and it will appear here within a second.'
              : 'Try another filter to see the rest.'}
          </span>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="list">
          {visible.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className={
                  event.id === selectedId ? 'item item--active' : 'item'
                }
                onClick={() => onSelect(event.id)}
              >
                <span className="item__type">{humanise(event.type)}</span>
                <span className="item__meta">
                  {event.employeeId} · {relative(event.timestamps.createdAt)}
                </span>
                <span className="item__right">
                  <StatusBadge status={event.status} />
                  {event.attemptCount > 1 && (
                    <span className="item__attempts">
                      {event.attemptCount} attempts
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
