import { useMemo, useState } from 'react';
import { RequestFailed, submitEvent } from '../api';
import type { ApiError, EventType, PayrollEvent } from '../types';

interface Props {
  eventTypes: EventType[];
  onSubmitted: (event: PayrollEvent) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export const SubmitEventForm = ({ eventTypes, onSubmitted }: Props) => {
  const [type, setType] = useState(eventTypes[0]?.type ?? '');
  const [employeeId, setEmployeeId] = useState('EMP-001');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => eventTypes.find((candidate) => candidate.type === type),
    [eventTypes, type],
  );

  const changeType = (next: string) => {
    setType(next);
    setValues({});
    setError(null);
  };

  const submit = async (submitEvt: React.FormEvent) => {
    submitEvt.preventDefault();
    if (!selected) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    // Numbers have to leave as numbers: the API rejects "75000" for a field it
    // validates as numeric.
    const payload = Object.fromEntries(
      selected.fields.map((field) => [
        field.name,
        field.kind === 'number'
          ? Number(values[field.name] ?? '')
          : (values[field.name] ?? ''),
      ]),
    );

    try {
      const event = await submitEvent({
        type,
        employeeId,
        effectiveDate,
        payload,
        idempotencyKey: idempotencyKey.trim() || undefined,
      });

      setNotice(
        event.duplicate
          ? 'Already submitted — the API returned the event it created the first time.'
          : 'Accepted. Watch it move through the list.',
      );
      onSubmitted(event);
    } catch (failure) {
      setError(
        failure instanceof RequestFailed
          ? failure.detail
          : { message: String(failure) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <h2>Submit an event</h2>

      <label>
        Event type
        <select value={type} onChange={(e) => changeType(e.target.value)}>
          {eventTypes.map((candidate) => (
            <option key={candidate.type} value={candidate.type}>
              {candidate.type}
            </option>
          ))}
        </select>
      </label>
      {selected && <p className="hint">{selected.description}</p>}

      <label>
        Employee
        <input
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          placeholder="EMP-001"
        />
      </label>
      <p className="hint">
        EMP-001 to EMP-004 are active. EMP-005 is inactive and EMP-999 does not
        exist — both fail permanently.
      </p>

      <label>
        Effective date
        <input
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </label>

      {/* Rendered from GET /event-types, so a new event type on the backend
          shows up here without a frontend change. */}
      {selected?.fields.map((field) => (
        <label key={field.name}>
          {field.label}
          <input
            value={values[field.name] ?? ''}
            placeholder={field.example}
            inputMode={field.kind === 'number' ? 'decimal' : undefined}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                [field.name]: e.target.value,
              }))
            }
          />
        </label>
      ))}

      <label>
        Idempotency key (optional)
        <input
          value={idempotencyKey}
          onChange={(e) => setIdempotencyKey(e.target.value)}
          placeholder="leave empty to fingerprint the body"
        />
      </label>

      <button type="submit" disabled={busy || !selected}>
        {busy ? 'Submitting…' : 'Submit'}
      </button>

      {notice && <p className="notice">{notice}</p>}

      {error && (
        <div className="error">
          <strong>{error.code ?? 'Rejected'}</strong>
          <p>{error.message}</p>
          {error.fields && (
            <ul>
              {error.fields.map((field) => (
                <li key={field.field}>
                  <code>{field.field}</code> — {field.messages.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
};
