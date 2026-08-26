import { useCallback, useEffect, useState } from 'react';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PayrollEventDetail | null>(null);
  const [offline, setOffline] = useState<string | null>(null);

  useEffect(() => {
    fetchEventTypes()
      .then(setEventTypes)
      .catch((error: unknown) => setOffline(String(error)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const page = await fetchEvents();
      setEvents(page.items);
      setOffline(null);
    } catch (error) {
      setOffline(String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }

    let live = true;
    const load = () => {
      fetchEvent(selectedId)
        .then((detail) => {
          if (live) setSelected(detail);
        })
        .catch(() => undefined);
    };

    load();
    const timer = setInterval(() => {
      if (selected && TERMINAL_STATUSES.includes(selected.status)) return;
      load();
    }, POLL_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selectedId, selected]);

  return (
    <main>
      <header>
        <h1>Payroll events</h1>
        <p>
          Submit a change, then watch the worker pick it up, retry it if the
          provider misbehaves, and settle it.
        </p>
      </header>

      {offline && <div className="error">Cannot reach the API — {offline}</div>}

      <div className="columns">
        <div className="column">
          {eventTypes.length > 0 && (
            <SubmitEventForm
              eventTypes={eventTypes}
              onSubmitted={(event: PayrollEvent) => {
                setSelectedId(event.id);
                void refresh();
              }}
            />
          )}
        </div>

        <div className="column">
          <EventList
            events={events}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <div className="column">
          {selected ? (
            <EventDetail event={selected} />
          ) : (
            <div className="panel">
              <h2>Event detail</h2>
              <p className="hint">Pick an event to see its history.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
