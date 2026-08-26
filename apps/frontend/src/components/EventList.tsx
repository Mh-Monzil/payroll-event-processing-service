import { StatusBadge } from './StatusBadge';
import type { PayrollEvent } from '../types';

interface Props {
  events: PayrollEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const EventList = ({ events, selectedId, onSelect }: Props) => (
  <div className="panel">
    <h2>Events</h2>

    {events.length === 0 && <p className="hint">Nothing submitted yet.</p>}

    <ul className="event-list">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className={event.id === selectedId ? 'row row--selected' : 'row'}
            onClick={() => onSelect(event.id)}
          >
            <span className="row__main">
              <span className="row__type">{event.type}</span>
              <span className="row__employee">{event.employeeId}</span>
            </span>
            <span className="row__meta">
              <StatusBadge status={event.status} />
              {event.attemptCount > 1 && (
                <span className="attempts">{event.attemptCount} attempts</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </div>
);
