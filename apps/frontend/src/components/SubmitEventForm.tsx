import { useMemo, useState } from 'react';
import { RequestFailed, submitEvent } from '../api';
import { humanise } from '../lib/format';
import type { ApiError, EventType, PayrollEvent } from '../types';

interface Props {
  eventTypes: EventType[];
  onSubmitted: (event: PayrollEvent) => void;
}

/**
 * One click each for the three outcomes worth showing: a normal run, and the
 * two permanent failures. Without these the failure paths are invisible unless
 * you already know which employee ids are special.
 */
const EMPLOYEE_PRESETS = [
  { id: 'EMP-001', label: 'Active', note: 'processes normally' },
  { id: 'EMP-005', label: 'Inactive', note: 'fails permanently' },
  { id: 'EMP-999', label: 'Unknown', note: 'fails permanently' },
];

const today = () => new Date().toISOString().slice(0, 10);

export const SubmitEventForm = ({ eventTypes, onSubmitted }: Props) => {
  const [type, setType] = useState(eventTypes[0]?.type ?? '');
  const [employeeId, setEmployeeId] = useState('EMP-001');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    repeat: boolean;
  } | null>(null);
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

  const fillExample = () => {
    if (!selected) return;
    setValues(
      Object.fromEntries(
        selected.fields.map((field) => [field.name, field.example]),
      ),
    );
  };

  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!selected) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    // Numbers must leave as numbers: the API rejects "75000" for a field it
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

      setNotice({
        repeat: Boolean(event.duplicate),
        text: event.duplicate
          ? 'Recognised as a repeat — you got back the event created the first time, and nothing was applied twice.'
          : 'Accepted for processing. Follow it in the timeline.',
      });
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
    <section className="card sticky">
      <header className="card__head">
        <h2 className="card__title">New event</h2>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={fillExample}
          disabled={!selected}
        >
          Fill example
        </button>
      </header>

      <form className="card__body" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field__label">Event type</span>
          <select
            className="select"
            value={type}
            onChange={(event) => changeType(event.target.value)}
          >
            {eventTypes.map((candidate) => (
              <option key={candidate.type} value={candidate.type}>
                {humanise(candidate.type)}
              </option>
            ))}
          </select>
          {selected && (
            <span className="field__note">{selected.description}</span>
          )}
        </label>

        <div className="field">
          <span className="field__label">Employee</span>
          <input
            className="input"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            placeholder="EMP-001"
          />
          <div className="presets">
            {EMPLOYEE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={`${preset.id} — ${preset.note}`}
                className={
                  employeeId === preset.id ? 'preset preset--active' : 'preset'
                }
                onClick={() => setEmployeeId(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Effective date</span>
          <input
            className="input"
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>

        {/* Rendered from GET /event-types, so a new event type on the backend
            appears here without a frontend change. */}
        {selected?.fields.map((field) => (
          <label className="field" key={field.name}>
            <span className="field__label">{field.label}</span>
            <input
              className="input"
              value={values[field.name] ?? ''}
              placeholder={field.example}
              inputMode={field.kind === 'number' ? 'decimal' : undefined}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
            />
          </label>
        ))}

        <label className="field">
          <span className="field__label">Idempotency key — optional</span>
          <input
            className="input"
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            placeholder="reuse a key to prove a retry is safe"
          />
          <span className="field__note">
            Left empty, the service fingerprints the request body instead.
          </span>
        </label>

        <button className="btn" type="submit" disabled={busy || !selected}>
          {busy && <span className="spinner" />}
          {busy ? 'Submitting' : 'Submit event'}
        </button>

        {notice && (
          <div
            className={notice.repeat ? 'alert alert--info' : 'alert alert--ok'}
          >
            <strong className="alert__title">
              {notice.repeat ? 'Duplicate ignored' : 'Accepted'}
            </strong>
            {notice.text}
          </div>
        )}

        {error && (
          <div className="alert alert--bad">
            <strong className="alert__title">{error.code ?? 'Rejected'}</strong>
            {error.message}
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
    </section>
  );
};
