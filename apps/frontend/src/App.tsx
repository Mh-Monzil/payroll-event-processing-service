import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEvent, fetchEventTypes, fetchEvents } from './api';
import { EventDetail } from './components/EventDetail';
import { EventList } from './components/EventList';
import { SubmitEventForm } from './components/SubmitEventForm';
import type { EventType, PayrollEvent, PayrollEventDetail } from './types';
import { TERMINAL_STATUSES } from './types';

const POLL_MS = 1500;

export const App = () => {
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [events, setEvents] = useState<PayrollEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PayrollEventDetail | null>(null);
  const [offline, setOffline] = useState(false);

  const selectedRef = useRef<PayrollEventDetail | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    fetchEventTypes()
      .then(setEventTypes)
      .catch(() => setOffline(true));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const page = await fetchEvents();
      setEvents(page.items);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Processing happens in the background, so the only way to see it is to keep
  // asking.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The open event polls on its own until it settles. Reading the current value
  // from a ref keeps the interval from being torn down on every update.
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }

    let live = true;

    const load = async () => {
      try {
        const detail = await fetchEvent(selectedId);
        if (live) setSelected(detail);
      } catch {
        // The list poll already reports connectivity; stay quiet here.
      }
    };

    void load();

    const timer = setInterval(() => {
      const current = selectedRef.current;
      const settled =
        current?.id === selectedId &&
        TERMINAL_STATUSES.includes(current.status);

      if (!settled) void load();
    }, POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selectedId]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            P
          </span>
          <span>
            <span className="brand__title">Payroll Events</span>
            <span className="brand__subtitle">
              Submit a change and watch it settle
            </span>
          </span>
        </div>

        <span className="topbar__spacer" />

        <div className="topbar__links">
          <a
            className="linkbtn"
            href="http://localhost:3000/api"
            target="_blank"
            rel="noreferrer"
          >
            API docs
          </a>
        </div>

        <span className={offline ? 'pulse pulse--down' : 'pulse'}>
          <span className="pulse__dot" />
          {offline ? 'API unreachable' : 'Live'}
        </span>
      </header>

      <main className="workspace">
        {eventTypes.length > 0 ? (
          <SubmitEventForm
            eventTypes={eventTypes}
            onSubmitted={(event: PayrollEvent) => {
              setSelectedId(event.id);
              void refresh();
            }}
          />
        ) : (
          <section className="card">
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">
                ⚠
              </span>
              <span className="empty__title">Waiting for the API</span>
              <span className="empty__text">
                The form is built from the event-type registry, so it appears
                once the API answers.
              </span>
            </div>
          </section>
        )}

        <EventList
          events={events}
          selectedId={selectedId}
          loading={loading}
          onSelect={setSelectedId}
        />

        {selected ? (
          <EventDetail event={selected} eventTypes={eventTypes} />
        ) : (
          <section className="card sticky">
            <header className="card__head">
              <h2 className="card__title">Event detail</h2>
            </header>
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">
                ☰
              </span>
              <span className="empty__title">Nothing selected</span>
              <span className="empty__text">
                Pick an event to see its payload, its result, and every state it
                passed through.
              </span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
