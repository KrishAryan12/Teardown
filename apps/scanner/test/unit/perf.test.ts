import { describe, expect, it, vi } from 'vitest';
import { FindingSchema } from '@teardown/core';
import { loadConfig } from '../../src/config';
import { DailyCounters } from '../../src/util/daily';
import { PerfEngine } from '../../src/perf/engine';
import { fromLhr } from '../../src/perf/lhr';
import { lighthouseFindings, plainDescription } from '../../src/perf/findings';
import { estimatePerformance } from '../../src/perf/estimate';
import { runPsi } from '../../src/perf/psi';
import type { PerfResult } from '../../src/perf/types';
import { loadCapture } from './helpers';

const fakeResult = (source: PerfResult['source'], score = 80): PerfResult => ({ source, score, metrics: { lcp: 2000 }, audits: [], durationMs: 10 });

const lhr = {
  categories: { performance: { score: 0.62 }, seo: { score: 0.9 } },
  audits: {
    'largest-contentful-paint': { id: 'largest-contentful-paint', title: 'Largest Contentful Paint', description: 'LCP marks… [Learn more](https://x)', score: 0.3, scoreDisplayMode: 'numeric', numericValue: 5200, displayValue: '5.2 s' },
    'cumulative-layout-shift': { id: 'cumulative-layout-shift', title: 'CLS', description: 'd', score: 1, scoreDisplayMode: 'numeric', numericValue: 0.01 },
    'render-blocking-insight': { id: 'render-blocking-insight', title: 'Render blocking', description: 'd', score: 0, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 400 } },
    'unused-javascript': { id: 'unused-javascript', title: 'Reduce unused JavaScript', description: 'Remove [unused](https://x) code.', score: 0.2, scoreDisplayMode: 'metricSavings', details: { type: 'opportunity', overallSavingsMs: 1200, overallSavingsBytes: 300000 } },
    'bf-cache': { id: 'bf-cache', title: 'bfcache', description: 'd', score: 0, scoreDisplayMode: 'binary' },
    'diagnostics': { id: 'diagnostics', title: 'Diagnostics', description: 'd', score: null, scoreDisplayMode: 'informative' },
  },
};

describe('fromLhr', () => {
  it('extracts score, metrics and failing audits', () => {
    const r = fromLhr(lhr as never, 'lighthouse', 100);
    expect(r.score).toBe(62);
    expect(r.metrics.lcp).toBe(5200);
    expect(r.categories?.seo).toBe(90);
    expect(r.audits.map((a) => a.id).sort()).toEqual(['bf-cache', 'largest-contentful-paint', 'render-blocking-insight', 'unused-javascript']);
  });
  it('throws on runtime errors', () => {
    expect(() => fromLhr({ ...lhr, runtimeError: { code: 'NO_FCP', message: 'x' } } as never, 'lighthouse', 1)).toThrow(/NO_FCP/);
  });
});

describe('lighthouseFindings', () => {
  const f = lighthouseFindings(fromLhr(lhr as never, 'lighthouse', 1), 'https://example.com/');
  it('reports metrics and opportunities, skipping audits our rules cover and bare diagnostics', () => {
    const ids = f.map((x) => x.ruleId);
    expect(ids).toContain('perf.lh.largest-contentful-paint');
    expect(ids).toContain('perf.lh.unused-javascript');
    expect(ids).not.toContain('perf.lh.render-blocking-insight'); // covered by perf.render-blocking
    expect(ids).not.toContain('perf.lh.bf-cache');
  });
  it('grades severity from score and savings, and labels the source', () => {
    expect(f.find((x) => x.ruleId === 'perf.lh.largest-contentful-paint')!.severity).toBe('serious');
    expect(f.find((x) => x.ruleId === 'perf.lh.unused-javascript')!.severity).toBe('serious');
    expect(f[0]!.detail).toMatch(/indicative lab data/);
    for (const x of f) {
      expect(x.source).toBe('lighthouse');
      expect(FindingSchema.safeParse(x).success).toBe(true);
    }
  });
  it('strips markdown links from descriptions', () => {
    expect(plainDescription('Remove [unused](https://x) code.')).toBe('Remove unused code.');
  });
});

describe('PerfEngine fallbacks', () => {
  const base = { ...process.env, NODE_ENV: 'test' as const };
  const deps = (env: Record<string, string>, psi = vi.fn(), lighthouse = vi.fn()) => ({
    cfg: loadConfig({ ...base, ...env }),
    counters: new DailyCounters(),
    proxyUrl: async () => 'http://127.0.0.1:1',
    psi,
    lighthouse,
  });

  it('uses local Lighthouse when there is no PSI key', async () => {
    const d = deps({}, vi.fn(), vi.fn().mockResolvedValue(fakeResult('lighthouse')));
    const e = new PerfEngine(d);
    expect(e.active()).toBe('lighthouse');
    const out = await e.run('https://example.com/');
    expect(out.result?.source).toBe('lighthouse');
    expect(d.psi).not.toHaveBeenCalled();
  });

  it('uses PSI when a key is set, and counts the call', async () => {
    const d = deps({ PSI_API_KEY: 'k' }, vi.fn().mockResolvedValue(fakeResult('psi')), vi.fn());
    const e = new PerfEngine(d);
    expect(e.active()).toBe('psi');
    expect((await e.run('https://example.com/')).result?.source).toBe('psi');
    expect(d.counters.get('psi')).toBe(1);
  });

  it('falls back from PSI failure to Lighthouse', async () => {
    const d = deps({ PSI_API_KEY: 'k' }, vi.fn().mockRejectedValue(new Error('PSI HTTP 500')), vi.fn().mockResolvedValue(fakeResult('lighthouse')));
    const out = await new PerfEngine(d).run('https://example.com/');
    expect(out.result?.source).toBe('lighthouse');
    expect(out.notes.join(' ')).toMatch(/PageSpeed Insights was unavailable/);
  });

  it('skips PSI once the daily cap is reached', async () => {
    const d = deps({ PSI_API_KEY: 'k', PSI_DAILY_CAP: '1' }, vi.fn().mockResolvedValue(fakeResult('psi')), vi.fn().mockResolvedValue(fakeResult('lighthouse')));
    const e = new PerfEngine(d);
    await e.run('https://example.com/');
    expect(e.active()).toBe('lighthouse');
    expect((await e.run('https://example.com/')).result?.source).toBe('lighthouse');
  });

  it('returns null (estimate) when Lighthouse fails too', async () => {
    const d = deps({}, vi.fn(), vi.fn().mockRejectedValue(new Error('Lighthouse timed out')));
    const out = await new PerfEngine(d).run('https://example.com/');
    expect(out.result).toBeNull();
    expect(out.notes.join(' ')).toMatch(/estimate/);
  });

  it('honours PERF_ENGINE=estimate', async () => {
    const d = deps({ PERF_ENGINE: 'estimate' });
    const e = new PerfEngine(d);
    expect(e.active()).toBe('estimated');
    expect((await e.run('https://example.com/')).result).toBeNull();
    expect(d.lighthouse).not.toHaveBeenCalled();
  });
});

describe('runPsi', () => {
  it('calls the v5 endpoint with mobile strategy and four categories, retrying once', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) return new Response('busy', { status: 503 });
      return Response.json({ lighthouseResult: lhr });
    });
    const r = await runPsi('https://example.com/', 'KEY', fetchImpl as never);
    expect(r.source).toBe('psi');
    expect(calls).toHaveLength(2);
    const u = new URL(calls[0]!);
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.getAll('category')).toEqual(['performance', 'seo', 'accessibility', 'best-practices']);
  });
  it('does not retry client errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 400 }));
    await expect(runPsi('https://example.com/', 'KEY', fetchImpl as never)).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('estimatePerformance', () => {
  it('scores a light page well and a heavy page badly', () => {
    const good = loadCapture('good');
    const light = estimatePerformance(good.network, good.facts, []);
    const heavyNet = { ...good.network!, transferBytes: 8 * 1024 * 1024, requests: 180 };
    const heavy = estimatePerformance(heavyNet, { ...good.facts, renderBlocking: Array(6).fill({ kind: 'script', url: 'x' }) }, [{ worstSeverity: 'serious', count: 3 }]);
    expect(light).toBeGreaterThan(90);
    expect(heavy).toBeLessThan(40);
  });
});
