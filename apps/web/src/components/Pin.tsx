import type { Severity } from '@teardown/core';

/** Severity is encoded by shape (circle, diamond, triangle, square) as well as colour. */
const SHAPES: Record<Severity, React.ReactNode> = {
  critical: <circle cx="13" cy="13" r="11.5" />,
  serious: <rect x="4.5" y="4.5" width="17" height="17" transform="rotate(45 13 13)" />,
  moderate: <polygon points="13,1.5 25,24 1,24" />,
  minor: <rect x="2" y="2" width="22" height="22" />,
};

export function Pin({ severity, n, small = false }: { severity: Severity; n: number | string; small?: boolean }) {
  return (
    <span className={`pin sev-${severity}${small ? ' small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 26 26" focusable="false">
        {SHAPES[severity]}
      </svg>
      <span>{n}</span>
    </span>
  );
}
