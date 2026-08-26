import { useState } from 'react';
import { Copyable } from './Copyable';
import { ProviderResult } from './ProviderResult';
import { StatusBadge } from './StatusBadge';
import { clock, gap, humanise, labelise } from '../lib/format';
import type { EventType, PayrollEventDetail } from '../types';

const FAILURE_EXPLANATION = {
  PERMANENT: 'Retrying can never help, so it was not retried.',
  RETRIES_EXHAUSTED: 'Transient errors that never cleared within the budget.',
};

interface Props {
  event: PayrollEventDetail;
  eventTypes: EventType[];
}

export const EventDetail = ({ event, eventTypes }: Props) => {
  const [raw, setRaw] = useState(false);
  const finished = event.timestamps.completedAt;

  // Field labels come from the registry, so the panel reads the way the form
  // does instead of exposing camelCase keys.
  const descriptor = eventTypes.find((type) => type.type === event.type);
  const labelFor = (key: string) =>
    descriptor?.fields.find((field) => field.name === key)?.label ??
    labelise(key);

  return (
    <section className="card sticky">
      <header className="detail__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="detail__type">{humanise(event.type)}</h2>
          <div className="detail__id">
            <Copyable value={event.id} label="event id" />
          </div>
        </div>
        <div className="detail__actions">
          <StatusBadge status={event.status} />
          <div className="segmented">
            <button
              type="button"
              className={raw ? '' : 'is-on'}
              onClick={() => setRaw(false)}
            >
              Details
            </button>
            <button
              type="button"
              className={raw ? 'is-on' : ''}
              onClick={() => setRaw(true)}
            >
              Raw
            </button>
          </div>
        </div>
      </header>

      {raw ? (
        <div className="section">
          <div className="section__title">
            Exactly what GET /events/:id returns
          </div>
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </div>
      ) : (
        <>
          <div className="facts">
            <div className="fact">
              <div className="fact__label">Employee</div>
              <div className="fact__value">{event.employeeId}</div>
            </div>
            <div className="fact">
              <div className="fact__label">Effective</div>
              <div className="fact__value">{event.effectiveDate}</div>
            </div>
            <div className="fact">
              <div className="fact__label">Accepted as</div>
              <div className="fact__value">#{event.sequence}</div>
            </div>
            <div className="fact">
              <div className="fact__label">Attempts</div>
              <div className="fact__value">{event.attemptCount}</div>
            </div>
            <div className="fact">
              <div className="fact__label">Took</div>
              <div className="fact__value">
                {finished ? gap(event.timestamps.createdAt, finished) : '—'}
              </div>
            </div>
          </div>

          {event.failure && (
            <div className="section">
              <div className="alert alert--bad" style={{ marginTop: 0 }}>
                <strong className="alert__title">
                  {event.failure.code ?? 'Failed'}
                </strong>
                {event.failure.message}
                <div className="alert__aside">
                  {FAILURE_EXPLANATION[event.failure.kind]}
                </div>
              </div>
            </div>
          )}

          <div className="section">
            <div className="section__title">Requested change</div>
            <dl className="kv">
              {Object.entries(event.payload).map(([key, value]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt>{labelFor(key)}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          {!!event.result && (
            <div className="section">
              <div className="section__title">Result</div>
              <ProviderResult value={event.result} />
            </div>
          )}

          {/* The audit trail: every attempt and every recovery, in order. */}
          <div className="section">
            <div className="section__title">
              Timeline · {event.history.length} transitions
            </div>
            <ol className="timeline">
              {event.history.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className={`step step--${entry.to.toLowerCase()}`}
                >
                  <span className="step__node" />
                  <span className="step__to">{humanise(entry.to)}</span>
                  <span className="step__time">
                    {clock(entry.at)}
                    {index > 0 && (
                      <span className="step__gap">
                        {gap(event.history[index - 1].at, entry.at)}
                      </span>
                    )}
                  </span>
                  {entry.message && (
                    <span className="step__message">{entry.message}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
};
