import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReportSchema, type Report } from '@teardown/core';
import { loadConfig } from '../../src/config';
import { SsrfGuard } from '../../src/security/guard';
import { PerfEngine } from '../../src/perf/engine';
import { DailyCounters } from '../../src/util/daily';
import { runScan } from '../../src/scan/run';
import { ScanManager } from '../../src/scan/manager';
import { Semaphore } from '../../src/util/limiter';
import type { BrowserPool } from '../../src/browser/pool';
import type { AiService } from '../../src/ai/types';
import { startFixtureServer, type FixtureServer } from '../../scripts/fixtureServer';

/**
 * Fallback matrix, row 1: Chromium can't launch -> retry once -> HTML-only analysis with a
 * visible "reduced accuracy" flag, no screenshots or brand data, estimated performance.
 * (PSI/Lighthouse/estimate and the AI chain rows are covered in perf.test.ts and ai.test.ts;
 * capacity -> single-page in api.test.ts.)
 */
describe('fallback: browser unavailable', () => {
  let server: FixtureServer;
  let report: Report;
  const launches = vi.fn();
  const notes: string[] = [];
  let launchAttempts = 0;

  beforeAll(async () => {
    server = await startFixtureServer();
    const cfg = loadConfig({ NODE_ENV: 'test', ALLOW_PRIVATE_TARGETS: 'true', PERF_ENGINE: 'auto' });
    const guard = new SsrfGuard({ allowPrivate: true });
    const brokenPool = {
      contexts: new Semaphore(2),
      newContext: async () => {
        launches();
        throw new Error('browserType.launch: Failed to launch chromium because executable does not exist');
      },
      proxyUrl: async () => 'http://127.0.0.1:1',
      getBrowser: async () => {
        throw new Error('no browser');
      },
      close: async () => undefined,
    } as unknown as BrowserPool;
    const lighthouse = vi.fn();
    const perf = new PerfEngine({ cfg, counters: new DailyCounters(), proxyUrl: async () => 'http://127.0.0.1:1', lighthouse });
    const ai: AiService = { available: () => false, unavailableReason: () => 'AI off in test.', advise: async () => Promise.reject(new Error('unused')) };
    report = await runScan({ url: `${server.origin}/bad.html`, mode: 'single' }, { cfg, guard, pool: brokenPool, perf, ai }, { emit: () => undefined });
    notes.push(...(report.limits.notes ?? []));
    // Read now: mocks are cleared between tests.
    launchAttempts = launches.mock.calls.length;
    expect(lighthouse).not.toHaveBeenCalled(); // no browser, so no Lighthouse attempt either
  });
  afterAll(() => server?.close());

  it('retries the browser once, then completes from HTML only', () => {
    expect(launchAttempts).toBe(2);
    expect(report.reducedAccuracy).toBe(true);
    expect(ReportSchema.safeParse(report).success).toBe(true);
    expect(notes.join(' ')).toMatch(/Reduced accuracy/);
  });

  it('still finds HTML-level problems', () => {
    const ids = report.groups.map((g) => g.ruleId);
    for (const id of ['seo.h1.missing', 'seo.title.short', 'a11y.img.alt', 'a11y.lang.missing', 'seo.viewport.missing', 'a11y.form.label']) expect(ids, id).toContain(id);
  });

  it('has no screenshots, an empty brand profile with a note, and an estimated performance score', () => {
    expect(report.pages[0]!.screenshots).toEqual({});
    expect(report.brand.colors).toEqual([]);
    expect(report.brand.consistency.notes[0]).toMatch(/real browser/);
    expect(report.scores.performance.source).toBe('estimated');
  });
});

describe('graceful shutdown (SIGTERM drain)', () => {
  it('cancels queued scans, lets running ones finish within the grace period, and refuses new ones', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', MAX_CONCURRENT_SCANS: '1', CACHE_TTL_MS: '0' });
    let finished = 0;
    const runner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      finished++;
      return {} as Report;
    });
    const manager = new ScanManager(cfg, {} as never, runner as never);
    const running = manager.enqueue('https://a.example/', 'a.example', 'single', 'k1');
    const queued = manager.enqueue('https://b.example/', 'b.example', 'single', 'k2');
    await manager.drain(2000);
    expect(finished).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.isFinished(running)).toBe(true);
    expect(manager.isFinished(queued)).toBe(true);
    expect(() => manager.enqueue('https://c.example/', 'c.example', 'single', 'k3')).toThrow(/restarting/);
  });

  it('aborts scans that outlive the grace period', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', CACHE_TTL_MS: '0' });
    let aborted = false;
    const runner = vi.fn(async (_r: unknown, _d: unknown, hooks: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => hooks.signal?.addEventListener('abort', () => ((aborted = true), resolve())));
      throw new Error('aborted');
    });
    const manager = new ScanManager(cfg, {} as never, runner as never);
    const id = manager.enqueue('https://a.example/', 'a.example', 'single', 'k1');
    await manager.drain(200);
    expect(aborted).toBe(true);
    expect(manager.isFinished(id)).toBe(true);
  });
});

describe('logging policy', () => {
  it('logs hostname, mode, outcome and duration only: no paths, queries or IPs', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => (lines.push(String(s)), true));
    const prev = process.env.DEBUG_LOGS;
    process.env.DEBUG_LOGS = '1';
    vi.resetModules();
    const { log } = await import('../../src/util/log');
    const { ScanManager: SM } = await import('../../src/scan/manager');
    const cfg = loadConfig({ NODE_ENV: 'test', CACHE_TTL_MS: '0' });
    const m = new SM(cfg, {} as never, (async () => ({ ai: { status: 'ok' }, scores: { performance: { source: 'lighthouse' } } })) as never);
    m.enqueue('https://site.example/private/path?token=secret', 'site.example', 'single', 'k');
    await new Promise((r) => setTimeout(r, 50));
    log.info({ event: 'probe' });
    spy.mockRestore();
    process.env.DEBUG_LOGS = prev;
    const scanLine = lines.find((l) => l.includes('"event":"scan"'));
    expect(scanLine).toBeDefined();
    expect(scanLine).toContain('"host":"site.example"');
    expect(scanLine).not.toMatch(/private\/path|token=secret|https:\/\//);
  });
});
