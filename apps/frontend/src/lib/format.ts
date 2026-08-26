/** SALARY_CHANGE reads as shouting; Salary Change reads as a product. */
export const humanise = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

/** Fallback for a payload key with no descriptor: newSalary -> New salary. */
export const labelise = (key: string): string => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Live systems read better in relative time: "4s ago" beats "10:42:31". */
export const relative = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 1000),
  );

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return new Date(iso).toLocaleDateString();
};

/** Gap between two transitions, so a slow step is visible at a glance. */
export const gap = (from: string, to: string): string => {
  const ms = new Date(to).getTime() - new Date(from).getTime();

  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;

  return `+${Math.round(ms / 60_000)}m`;
};
