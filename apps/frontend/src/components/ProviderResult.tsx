import { Copyable } from './Copyable';
import { clock } from '../lib/format';

interface Shape {
  provider?: string;
  externalRef?: string | null;
  acknowledgedAt?: string;
  alreadyApplied?: boolean;
}

// Every field is optional, so a plain object narrows to Shape without a cast.
const read = (value: unknown): Shape | null =>
  value !== null && typeof value === 'object' ? value : null;

/**
 * The provider's answer, read as a sentence rather than dumped as JSON. The
 * alreadyApplied flag is the interesting one: it means a replayed job found the
 * change already in the ledger and did not repeat it.
 */
export const ProviderResult = ({ value }: { value: unknown }) => {
  const result = read(value);

  if (!result) return null;

  return (
    <div className="result">
      <div className="result__head">
        <span className="result__tick" aria-hidden="true">
          ✓
        </span>
        {result.alreadyApplied
          ? 'Already applied — settled without repeating it'
          : 'Confirmed by the payroll provider'}
      </div>

      <div className="result__body">
        {result.provider && (
          <>
            <span className="result__label">Provider</span>
            <span className="result__value">{result.provider}</span>
          </>
        )}

        {result.externalRef && (
          <>
            <span className="result__label">Reference</span>
            <span className="result__value">
              <Copyable value={result.externalRef} label="reference" />
            </span>
          </>
        )}

        {result.acknowledgedAt && (
          <>
            <span className="result__label">Acknowledged</span>
            <span className="result__value">
              {clock(result.acknowledgedAt)}
            </span>
          </>
        )}

        {result.alreadyApplied && (
          <span className="result__note">
            A worker picked this job up again after the change had already been
            written. The ledger row proved it, so the payroll change was not
            applied a second time.
          </span>
        )}
      </div>
    </div>
  );
};
