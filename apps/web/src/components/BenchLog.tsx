'use client';

import { useEffect, useRef, useState } from 'react';
import type { ScanState } from '@/lib/useScan';

type Active = Extract<ScanState, { phase: 'starting' | 'scanning' }>;

const TICK = { running: '…', done: '✓', failed: '✗', skipped: '–' } as const;

function host(u: string): string {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname;
  } catch {
    return u;
  }
}

export function BenchLog({ state, onCancel }: { state: Active; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.round((now - state.startedAt) / 1000);
  const scanning = state.phase === 'scanning' ? state : null;
  const steps = scanning?.steps ?? [];
  const pages = scanning?.pages ?? [];
  const done = steps.filter((s) => s.status !== 'running');
  const running = steps.filter((s) => s.status === 'running').at(-1);

  let status: string;
  if (state.phase === 'starting') status = elapsed > 4 ? 'Starting the scanner (it sleeps when idle)…' : 'Sending the address…';
  else if (scanning?.position) status = `Waiting in line: position ${scanning.position}`;
  else if (scanning?.reconnecting) status = 'Reconnecting to the scanner…';
  else if (scanning?.writingAdvice) status = 'Writing prioritised advice';
  else status = 'Scanning';

  return (
    <div className="bench">
      <div className="titleblock">
        <div className="tb-host">
          <span className="label">Specimen</span>
          <strong>{host(state.url)}</strong>
        </div>
        <dl>
          <dt className="label">Mode</dt>
          <dd>{state.mode === 'site' ? 'Full site' : 'Single page'}</dd>
          <dt className="label">Elapsed</dt>
          <dd className="mono">{elapsed}s</dd>
          <dt className="label">Status</dt>
          <dd>{status}</dd>
        </dl>
        <div className="tb-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel scan
          </button>
        </div>
      </div>
      <div className="log">
        <h1 ref={heading} tabIndex={-1} style={{ fontSize: '1.5rem', textTransform: 'uppercase', marginBottom: 12 }}>
          Bench log
        </h1>
        {state.phase === 'starting' && elapsed > 4 && (
          <p className="notice notice-warn">
            The scanner runs on a free server that sleeps when nobody is using it. Waking it up can take up to a minute. Your scan will start as soon as it&apos;s ready.
          </p>
        )}
        {scanning?.position ? (
          <p className="notice">
            Your scan is number {scanning.position} in line. Scans run {scanning.position > 1 ? 'a couple at a time' : 'next'}, so this usually takes under {Math.max(1, scanning.position)} minute{scanning.position > 1 ? 's' : ''}.
          </p>
        ) : null}
        <ol aria-live="polite" aria-relevant="additions" aria-label="Completed steps">
          {done.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <span className={`tick-${s.status}`} aria-hidden="true">
                {TICK[s.status]}
              </span>
              <span>
                {s.name}
                <span className="visually-hidden"> {s.status}</span>
              </span>
              <span className="ms">{s.ms !== undefined ? `${s.ms} ms` : ''}</span>
            </li>
          ))}
        </ol>
        {running && (
          <p className="mono" style={{ marginTop: 8 }}>
            <span className="tick-running" aria-hidden="true">
              …
            </span>{' '}
            {running.name}
          </p>
        )}
        {pages.length > 0 && (
          <>
            <h2 className="label" style={{ margin: '20px 0 8px', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
              Pages ({pages.filter((p) => p.done).length} of {pages.find((p) => p.total)?.total ?? pages.length})
            </h2>
            <ol aria-live="polite">
              {pages.map((p) => (
                <li key={p.url}>
                  <span className={p.done ? 'tick-done' : 'tick-running'} aria-hidden="true">
                    {p.done ? '✓' : '…'}
                  </span>
                  <span style={{ overflowWrap: 'anywhere' }}>{(() => { try { return new URL(p.url).pathname; } catch { return p.url; } })()}</span>
                  <span className="ms">{p.done ? `${p.findingCount ?? 0} findings` : 'scanning'}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="log-note">
          {steps.some((s) => s.name === 'Measure performance' && s.status === 'running')
            ? 'Lighthouse runs one page at a time on a small shared server. This step takes 20 to 60 seconds.'
            : 'Teardown loads the page in a real browser at desktop and phone sizes, runs accessibility checks, reads the brand system, then measures performance.'}
        </p>
      </div>
    </div>
  );
}
