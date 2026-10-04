'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ErrorCode, Report, ScanMode, StepStatus } from '@teardown/core';
import { ApiFailure, cancelScan, eventsUrl, startScan } from './api';

export interface Step {
  name: string;
  status: StepStatus;
  ms?: number;
}

export interface PageRow {
  url: string;
  index?: number;
  total?: number;
  findingCount?: number;
  done: boolean;
}

export type ScanState =
  | { phase: 'idle' }
  | { phase: 'starting'; url: string; mode: ScanMode; startedAt: number }
  | {
      phase: 'scanning';
      url: string;
      mode: ScanMode;
      id: string;
      startedAt: number;
      position?: number;
      steps: Step[];
      pages: PageRow[];
      writingAdvice: boolean;
      reconnecting: boolean;
    }
  | { phase: 'report'; url: string; mode: ScanMode; report: Report; cached: boolean; cachedAt?: string }
  | { phase: 'error'; url: string; mode: ScanMode; code: ErrorCode | 'NETWORK'; message: string; resetAt?: string; suggestMode?: ScanMode };

type Action =
  | { t: 'start'; url: string; mode: ScanMode }
  | { t: 'accepted'; id: string }
  | { t: 'queued'; position: number }
  | { t: 'started' }
  | { t: 'step'; step: Step }
  | { t: 'page_started'; url: string; index: number; total: number }
  | { t: 'page_done'; url: string; findingCount: number }
  | { t: 'ai' }
  | { t: 'reconnecting'; on: boolean }
  | { t: 'report'; report: Report; cached: boolean; cachedAt?: string }
  | { t: 'error'; code: ErrorCode | 'NETWORK'; message: string; resetAt?: string; suggestMode?: ScanMode }
  | { t: 'reset' };

function reducer(s: ScanState, a: Action): ScanState {
  switch (a.t) {
    case 'start':
      return { phase: 'starting', url: a.url, mode: a.mode, startedAt: Date.now() };
    case 'accepted':
      if (s.phase !== 'starting') return s;
      return { phase: 'scanning', url: s.url, mode: s.mode, id: a.id, startedAt: s.startedAt, steps: [], pages: [], writingAdvice: false, reconnecting: false };
    case 'reset':
      return { phase: 'idle' };
    case 'error':
      if (s.phase === 'idle' || s.phase === 'report') return s;
      return { phase: 'error', url: s.url, mode: s.mode, code: a.code, message: a.message, resetAt: a.resetAt, suggestMode: a.suggestMode };
    case 'report':
      if (s.phase !== 'scanning') return s;
      return { phase: 'report', url: s.url, mode: s.mode, report: a.report, cached: a.cached, cachedAt: a.cachedAt };
  }
  if (s.phase !== 'scanning') return s;
  switch (a.t) {
    case 'queued':
      return { ...s, position: a.position };
    case 'started':
      return { ...s, position: undefined };
    case 'reconnecting':
      return { ...s, reconnecting: a.on };
    case 'ai':
      return { ...s, writingAdvice: true };
    case 'step': {
      const i = s.steps.findIndex((x) => x.name === a.step.name && x.status === 'running');
      const steps = [...s.steps];
      if (i >= 0) steps[i] = a.step;
      else if (!steps.some((x) => x.name === a.step.name && x.status === a.step.status)) steps.push(a.step);
      return { ...s, steps, position: undefined };
    }
    case 'page_started':
      return { ...s, pages: [...s.pages.filter((p) => p.url !== a.url), { url: a.url, index: a.index, total: a.total, done: false }] };
    case 'page_done': {
      const existing = s.pages.find((p) => p.url === a.url);
      const row = { ...(existing ?? { url: a.url }), findingCount: a.findingCount, done: true };
      return { ...s, pages: existing ? s.pages.map((p) => (p.url === a.url ? row : p)) : [...s.pages, row] };
    }
  }
  return s;
}

/** Drives one scan at a time: POST, then SSE with automatic reconnect (Last-Event-ID replay). */
export function useScan() {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' } as ScanState);
  const es = useRef<EventSource | null>(null);
  const scanId = useRef<string | null>(null);

  const close = useCallback(() => {
    es.current?.close();
    es.current = null;
  }, []);

  useEffect(() => close, [close]);

  const listen = useCallback(
    (id: string) => {
      close();
      const source = new EventSource(eventsUrl(id));
      es.current = source;
      const on = <T,>(type: string, fn: (d: T) => void) =>
        source.addEventListener(type, (e) => {
          if (!(e instanceof MessageEvent) || typeof e.data !== 'string') return;
          dispatch({ t: 'reconnecting', on: false });
          fn(JSON.parse(e.data) as T);
        });
      on<{ position: number }>('queued', (d) => dispatch({ t: 'queued', position: d.position }));
      on('started', () => dispatch({ t: 'started' }));
      on<Step>('step', (d) => dispatch({ t: 'step', step: d }));
      on<{ url: string; index: number; total: number }>('page_started', (d) => dispatch({ t: 'page_started', ...d }));
      on<{ url: string; findingCount: number }>('page_done', (d) => dispatch({ t: 'page_done', url: d.url, findingCount: d.findingCount }));
      on('ai_started', () => dispatch({ t: 'ai' }));
      on<{ report: Report; cached: boolean; cachedAt?: string }>('report', (d) => dispatch({ t: 'report', report: d.report, cached: d.cached, cachedAt: d.cachedAt }));
      on<{ code: ErrorCode; message: string }>('error', (d) => dispatch({ t: 'error', code: d.code, message: d.message }));
      on('done', () => close());
      let failures = 0;
      source.onerror = () => {
        // EventSource reconnects by itself and resends Last-Event-ID; give up after repeated failures.
        failures++;
        dispatch({ t: 'reconnecting', on: true });
        if (source.readyState === EventSource.CLOSED || failures > 8) {
          close();
          dispatch({ t: 'error', code: 'NETWORK', message: 'The connection to the scanner was lost and the scan result could not be fetched. Start the scan again.' });
        }
      };
      source.onopen = () => {
        failures = 0;
      };
    },
    [close],
  );

  const start = useCallback(
    async (url: string, mode: ScanMode, fresh = false) => {
      close();
      dispatch({ t: 'start', url, mode });
      try {
        const { scanId: id } = await startScan(url, mode, fresh);
        scanId.current = id;
        dispatch({ t: 'accepted', id });
        listen(id);
      } catch (e) {
        const f = e instanceof ApiFailure ? e : new ApiFailure('NETWORK', 'Something went wrong starting the scan. Try again.');
        dispatch({ t: 'error', code: f.code, message: f.message, resetAt: f.resetAt, suggestMode: f.suggestMode });
      }
    },
    [close, listen],
  );

  const cancel = useCallback(async () => {
    close();
    const id = scanId.current;
    scanId.current = null;
    dispatch({ t: 'reset' });
    if (id) await cancelScan(id);
  }, [close]);

  const reset = useCallback(() => {
    close();
    scanId.current = null;
    dispatch({ t: 'reset' });
  }, [close]);

  return { state, start, cancel, reset };
}
