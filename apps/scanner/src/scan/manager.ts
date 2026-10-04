import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { RULESET_VERSION, type Report, type ScanEvent, type ScanMode } from '@teardown/core';
import type { Config } from '../config';
import { ScanError, toScanError } from '../errors';
import { log } from '../util/log';
import { CancelledError, runScan, type ScanDeps } from './run';

export interface StoredEvent {
  id: number;
  event: ScanEvent;
}

type Status = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

interface ScanState {
  id: string;
  url: string;
  host: string;
  mode: ScanMode;
  cacheKey: string;
  status: Status;
  events: StoredEvent[];
  subscribers: Set<(e: StoredEvent) => void>;
  abort: AbortController;
  createdAt: number;
  finishedAt?: number;
}

export const SCAN_TTL_MS = 30 * 60_000;
const MAX_EVENTS = 500;

export type Runner = typeof runScan;

/**
 * Owns scan lifecycles: a FIFO queue with a fixed number of running scans, per-scan event buffers
 * for SSE replay, a TTL on finished scans, and an LRU cache of reports.
 */
export class ScanManager {
  private readonly scans = new Map<string, ScanState>();
  private readonly waiting: ScanState[] = [];
  private running = 0;
  private accepting = true;
  private readonly cache: LRUCache<string, { report: Report; at: number }>;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly cfg: Config,
    private readonly deps: ScanDeps,
    private readonly runner: Runner = runScan,
  ) {
    this.cache = new LRUCache({
      max: Math.max(1, cfg.CACHE_MAX_ENTRIES),
      maxSize: Math.max(1, cfg.CACHE_MAX_BYTES),
      sizeCalculation: (v) => Math.max(1, Buffer.byteLength(JSON.stringify(v.report))),
      ttl: Math.max(1, cfg.CACHE_TTL_MS),
    });
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  static cacheKey(normalizedUrl: string, mode: ScanMode): string {
    return `${normalizedUrl}|${mode}|${RULESET_VERSION}`;
  }

  stats() {
    return { running: this.running, waiting: this.waiting.length };
  }

  queueFull(): boolean {
    return this.waiting.length >= this.cfg.MAX_QUEUE && this.running >= this.cfg.MAX_CONCURRENT_SCANS;
  }

  isAccepting(): boolean {
    return this.accepting;
  }

  cached(key: string): { report: Report; at: number } | undefined {
    if (this.cfg.CACHE_TTL_MS <= 0 || this.cfg.CACHE_MAX_ENTRIES <= 0) return undefined;
    return this.cache.get(key);
  }

  private create(url: string, host: string, mode: ScanMode, cacheKey: string, status: Status): ScanState {
    const s: ScanState = {
      id: randomUUID(),
      url,
      host,
      mode,
      cacheKey,
      status,
      events: [],
      subscribers: new Set(),
      abort: new AbortController(),
      createdAt: Date.now(),
    };
    this.scans.set(s.id, s);
    return s;
  }

  /** A scan served from cache: it completes immediately and costs no PSI/AI budget. */
  fromCache(url: string, host: string, mode: ScanMode, key: string, hit: { report: Report; at: number }): string {
    const s = this.create(url, host, mode, key, 'done');
    const cachedAt = new Date(hit.at).toISOString();
    this.push(s, { type: 'started', data: { mode, cached: true, cachedAt } });
    this.push(s, { type: 'report', data: { report: hit.report, cached: true, cachedAt } });
    this.push(s, { type: 'done', data: {} });
    s.finishedAt = Date.now();
    log.info({ event: 'scan', host, mode, outcome: 'cache_hit', ms: 0 });
    return s.id;
  }

  enqueue(url: string, host: string, mode: ScanMode, key: string): string {
    if (!this.accepting) throw new ScanError('QUEUE_FULL', 'The scanner is restarting. Try again in a minute.');
    if (this.queueFull()) throw new ScanError('QUEUE_FULL');
    const s = this.create(url, host, mode, key, 'queued');
    this.waiting.push(s);
    this.pump();
    this.announcePositions();
    return s.id;
  }

  private push(s: ScanState, event: ScanEvent) {
    const stored = { id: (s.events.at(-1)?.id ?? 0) + 1, event };
    s.events.push(stored);
    // Keep the buffer bounded, but never drop the report or terminal events.
    if (s.events.length > MAX_EVENTS) {
      const idx = s.events.findIndex((e) => e.event.type === 'step' || e.event.type === 'queued');
      if (idx >= 0) s.events.splice(idx, 1);
    }
    for (const fn of s.subscribers) fn(stored);
  }

  private announcePositions() {
    this.waiting.forEach((s, i) => this.push(s, { type: 'queued', data: { position: i + 1 } }));
  }

  private pump() {
    while (this.running < this.cfg.MAX_CONCURRENT_SCANS && this.waiting.length) {
      const s = this.waiting.shift()!;
      if (s.status === 'cancelled') continue;
      this.running++;
      void this.execute(s).finally(() => {
        this.running--;
        this.pump();
        this.announcePositions();
      });
    }
  }

  private async execute(s: ScanState) {
    const t0 = Date.now();
    s.status = 'running';
    this.push(s, { type: 'started', data: { mode: s.mode } });
    try {
      const report = await this.runner({ url: s.url, mode: s.mode }, this.deps, {
        emit: (e) => this.push(s, e),
        signal: s.abort.signal,
      });
      if (this.cfg.CACHE_TTL_MS > 0 && this.cfg.CACHE_MAX_ENTRIES > 0) this.cache.set(s.cacheKey, { report, at: Date.now() });
      this.push(s, { type: 'report', data: { report, cached: false } });
      s.status = 'done';
      log.info({ event: 'scan', host: s.host, mode: s.mode, outcome: 'ok', ms: Date.now() - t0, ai: report.ai.status, perf: report.scores.performance.source });
    } catch (e) {
      if (e instanceof CancelledError || s.abort.signal.aborted) {
        s.status = 'cancelled';
        log.info({ event: 'scan', host: s.host, mode: s.mode, outcome: 'cancelled', ms: Date.now() - t0 });
      } else {
        const err = toScanError(e);
        s.status = 'error';
        this.push(s, { type: 'error', data: { code: err.code, message: err.message } });
        log.info({ event: 'scan', host: s.host, mode: s.mode, outcome: 'error', code: err.code, ms: Date.now() - t0 });
        if (err.code === 'SCAN_FAILED' && !(e instanceof ScanError)) {
          log.error({ event: 'scan_exception', host: s.host, error: e instanceof Error ? e.message.split('\n')[0]!.slice(0, 200) : 'unknown' });
        }
      }
    } finally {
      s.finishedAt = Date.now();
      this.push(s, { type: 'done', data: {} });
    }
  }

  exists(id: string): boolean {
    return this.scans.has(id);
  }

  /** Replays buffered events after `lastEventId`, then streams new ones. Returns an unsubscribe fn. */
  subscribe(id: string, lastEventId: number, fn: (e: StoredEvent) => void): (() => void) | null {
    const s = this.scans.get(id);
    if (!s) return null;
    for (const e of s.events) if (e.id > lastEventId) fn(e);
    s.subscribers.add(fn);
    return () => s.subscribers.delete(fn);
  }

  isFinished(id: string): boolean {
    const st = this.scans.get(id)?.status;
    return st === 'done' || st === 'error' || st === 'cancelled';
  }

  cancel(id: string): boolean {
    const s = this.scans.get(id);
    if (!s || this.isFinished(id)) return false;
    if (s.status === 'queued') {
      const i = this.waiting.indexOf(s);
      if (i >= 0) this.waiting.splice(i, 1);
      s.status = 'cancelled';
      s.finishedAt = Date.now();
      this.push(s, { type: 'done', data: {} });
      this.announcePositions();
    }
    s.abort.abort();
    return true;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.scans) {
      const age = now - (s.finishedAt ?? s.createdAt);
      if ((s.finishedAt && age > SCAN_TTL_MS) || (!s.finishedAt && now - s.createdAt > SCAN_TTL_MS * 2)) {
        s.abort.abort();
        this.scans.delete(id);
      }
    }
  }

  /** SIGTERM: stop accepting, cancel queued scans, give running ones `graceMs` to finish, then abort. */
  async drain(graceMs: number): Promise<void> {
    this.accepting = false;
    for (const s of [...this.waiting]) this.cancel(s.id);
    const deadline = Date.now() + graceMs;
    while (this.running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    for (const s of this.scans.values()) if (s.status === 'running') s.abort.abort();
    while (this.running > 0 && Date.now() < deadline + 5000) await new Promise((r) => setTimeout(r, 100));
    clearInterval(this.sweeper);
  }
}
