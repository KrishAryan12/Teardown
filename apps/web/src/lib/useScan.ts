'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ErrorCode, Report, ScanEvent, ScanMode, StepStatus } from '@teardown/core';
import { ApiFailure, streamScan } from './api';

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

/**
 * Drives one scan at a time over a single streaming request: the response body carries the
 * scan's events until `done`. Aborting the request cancels the scan on the server.
 */
export function useScan() {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' } as ScanState);
  const ctrl = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (url: string, mode: ScanMode, fresh = false) => {
      stop();
      const c = new AbortController();
      ctrl.current = c;
      dispatch({ t: 'start', url, mode });
      let accepted = false;
      let finished = false;
      const onEvent = (e: ScanEvent) => {
        if (c.signal.aborted) return;
        if (!accepted) {
          accepted = true;
          dispatch({ t: 'accepted', id: 'stream' });
        }
        switch (e.type) {
          case 'queued':
            return dispatch({ t: 'queued', position: e.data.position });
          case 'started':
            return dispatch({ t: 'started' });
          case 'step':
            return dispatch({ t: 'step', step: e.data });
          case 'page_started':
            return dispatch({ t: 'page_started', url: e.data.url, index: e.data.index, total: e.data.total });
          case 'page_done':
            return dispatch({ t: 'page_done', url: e.data.url, findingCount: e.data.findingCount });
          case 'ai_started':
            return dispatch({ t: 'ai' });
          case 'report':
            finished = true;
            return dispatch({ t: 'report', report: e.data.report, cached: e.data.cached, cachedAt: e.data.cachedAt });
          case 'error':
            finished = true;
            return dispatch({ t: 'error', code: e.data.code, message: e.data.message });
          case 'done':
            return;
        }
      };
      try {
        await streamScan(url, mode, fresh, c.signal, onEvent);
        if (!finished && !c.signal.aborted) {
          dispatch({ t: 'error', code: 'NETWORK', message: 'The scan stopped before the report arrived. Start the scan again.' });
        }
      } catch (e) {
        if (c.signal.aborted) return;
        const f = e instanceof ApiFailure ? e : new ApiFailure('NETWORK', 'Something went wrong starting the scan. Try again.');
        dispatch({ t: 'error', code: f.code, message: f.message, resetAt: f.resetAt, suggestMode: f.suggestMode });
      } finally {
        if (ctrl.current === c) ctrl.current = null;
      }
    },
    [stop],
  );

  const cancel = useCallback(async () => {
    stop();
    dispatch({ t: 'reset' });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    dispatch({ t: 'reset' });
  }, [stop]);

  return { state, start, cancel, reset };
}
