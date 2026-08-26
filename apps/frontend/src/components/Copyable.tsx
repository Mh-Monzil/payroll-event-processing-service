import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

/** Identifiers exist to be pasted somewhere else, so make that one click. */
export const Copyable = ({ value, label }: Props) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  };

  return (
    <button
      type="button"
      className="copyable"
      onClick={copy}
      title={`Copy ${label ?? 'value'}`}
    >
      <span className="copyable__text">{value}</span>
      <span className="copyable__hint">{copied ? 'copied' : 'copy'}</span>
    </button>
  );
};
