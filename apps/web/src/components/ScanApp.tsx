'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScanForm } from './ScanForm';
import { useScan, type ScanState } from '@/lib/useScan';
import { formatReset } from '@/lib/api';

// Only needed once a scan starts, so it stays out of the landing bundle.
const BenchLog = dynamic(() => import('./BenchLog').then((m) => m.BenchLog), { ssr: false });

const ReportSheet = dynamic(() => import('./report/ReportSheet'), {
  ssr: false,
  loading: () => <p className="dim">Laying out the sheet…</p>,
});

function ErrorNotice({ state, onRetry, onSingle }: { state: Extract<ScanState, { phase: 'error' }>; onRetry: () => void; onSingle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const title =
    state.code === 'RATE_LIMITED'
      ? 'Scan limit reached'
      : state.code === 'CAPACITY'
        ? "Today's capacity is used up"
        : state.code === 'BLOCKED_TARGET'
          ? "That address can't be scanned"
          : state.code === 'INVALID_URL'
            ? 'Check the address'
            : state.code === 'NETWORK'
              ? "Couldn't reach the scanner"
              : 'The scan stopped';
  return (
    <div className="notice notice-error" role="alert" tabIndex={-1} ref={ref}>
      <p className="notice-title">{title}</p>
      <p>{state.message}</p>
      {state.resetAt && <p>You can scan again {formatReset(state.resetAt)}.</p>}
      <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        {state.suggestMode === 'single' && state.mode === 'site' && (
          <button type="button" className="btn btn-primary" onClick={onSingle}>
            Scan this page only
          </button>
        )}
        {!['RATE_LIMITED', 'CAPACITY', 'BLOCKED_TARGET', 'INVALID_URL'].includes(state.code) && (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </p>
    </div>
  );
}

/** Landing → bench log → sheet, all in memory. `landing` is server-rendered content shown when idle. */
export function ScanApp({ hero, landing }: { hero: ReactNode; landing: ReactNode }) {
  const { state, start, cancel, reset } = useScan();
  const lastUrl = useRef('');

  // Back button leaves the report/scan and returns to the form.
  useEffect(() => {
    if (state.phase === 'scanning' || state.phase === 'report') {
      if (history.state?.td !== state.phase) history.pushState({ td: state.phase }, '');
    }
  }, [state.phase]);
  useEffect(() => {
    const onPop = () => {
      if (state.phase === 'scanning') void cancel();
      else if (state.phase === 'report') reset();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [state.phase, cancel, reset]);

  useEffect(() => {
    if (state.phase === 'report') {
      document.title = `${state.report.target.host} teardown · Teardown`;
      window.scrollTo({ top: 0 });
    } else if (state.phase === 'idle') document.title = 'Teardown: take any website apart';
  }, [state]);

  const scan = (url: string, mode: 'single' | 'site', fresh = false) => {
    lastUrl.current = url;
    void start(url, mode, fresh);
  };

  if (state.phase === 'starting' || state.phase === 'scanning') return <BenchLog state={state} onCancel={() => void cancel()} />;

  if (state.phase === 'report') {
    return (
      <>
        <p style={{ margin: '16px 0 0' }}>
          <button type="button" className="btn" onClick={reset}>
            Scan another site
          </button>
        </p>
        <ReportSheet report={state.report} cached={state.cached} cachedAt={state.cachedAt} onRescan={() => scan(state.url, state.mode, true)} />
      </>
    );
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        {hero}
        <ScanForm onScan={(u, m) => scan(u, m)} initialUrl={state.phase === 'error' ? state.url : ''} initialMode={state.phase === 'error' ? state.mode : 'single'} />
        {state.phase === 'error' && <ErrorNotice state={state} onRetry={() => scan(state.url, state.mode)} onSingle={() => scan(state.url, 'single')} />}
      </section>
      {landing}
    </>
  );
}
