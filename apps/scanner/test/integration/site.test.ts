import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReportSchema, type Report, type ScanEvent } from '@teardown/core';
import { loadConfig } from '../../src/config';
import { SsrfGuard } from '../../src/security/guard';
import { BrowserPool } from '../../src/browser/pool';
import { PerfEngine } from '../../src/perf/engine';
import { DailyCounters } from '../../src/util/daily';
import { runScan } from '../../src/scan/run';
import type { AiService } from '../../src/ai/types';
import { FIXTURES_DIR, startFixtureServer, type FixtureServer } from '../../scripts/fixtureServer';

const noAi: AiService = { available: () => false, advise: async () => Promise.reject(new Error('unused')) };

describe('full-site scan of the multi-page fixture (M10)', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let report: Report;
  const events: ScanEvent[] = [];

  beforeAll(async () => {
    server = await startFixtureServer(resolve(FIXTURES_DIR, 'site'));
    // Caps: 5 pages, Lighthouse on the home page plus 1 more; estimate mode keeps the test fast.
    const cfg = loadConfig({ NODE_ENV: 'test', ALLOW_PRIVATE_TARGETS: 'true', SITE_MAX_PAGES: '5', PERF_MAX_PAGES_FULL: '1', PERF_ENGINE: 'estimate' });
    const guard = new SsrfGuard({ allowPrivate: true });
    pool = new BrowserPool({ guard, noSandbox: true, maxContexts: 4 });
    const perf = new PerfEngine({ cfg, counters: new DailyCounters(), proxyUrl: () => pool.proxyUrl() });
    report = await runScan({ url: `${server.origin}/`, mode: 'site' }, { cfg, guard, pool, perf, ai: noAi }, { emit: (e) => events.push(e) });
  });

  afterAll(async () => {
    await pool?.close();
    await server?.close();
  });

  it('produces a schema-valid multi-page report within the page cap', () => {
    expect(ReportSchema.safeParse(report).success).toBe(true);
    expect(report.mode).toBe('site');
    expect(report.pages.length).toBe(5);
    expect(report.limits.pagesScanned).toBe(5);
    expect(report.limits.truncated).toBe(true);
    expect(report.limits.pagesSkipped).toBeGreaterThan(0);
  });

  it('respects robots.txt and skips non-HTML files', () => {
    const paths = report.pages.map((p) => new URL(p.url).pathname);
    expect(paths).not.toContain('/private/secret.html');
    expect(paths.some((p) => p.endsWith('.pdf'))).toBe(false);
    expect(report.limits.notes?.join(' ')).toMatch(/robots\.txt disallows/);
  });

  it('prefers one page per template before repeating blog posts', () => {
    const paths = report.pages.map((p) => new URL(p.url).pathname);
    expect(paths[0]).toBe('/');
    expect(paths).toEqual(expect.arrayContaining(['/about/', '/pricing.html']));
    expect(paths.filter((p) => p.startsWith('/blog/')).length).toBeLessThanOrEqual(2);
  });

  it('streams page events and detects duplicate titles across pages', () => {
    expect(events.filter((e) => e.type === 'page_started').length).toBe(5);
    expect(events.filter((e) => e.type === 'page_done').length).toBe(5);
    const dup = report.groups.find((g) => g.ruleId === 'seo.title.duplicate');
    expect(dup?.count).toBe(2);
  });

  it('merges brand data across pages and keeps screenshots inside the payload cap', () => {
    expect(report.brand.colors.length).toBeGreaterThan(0);
    expect(report.pages[0]!.screenshots.mobile).toMatch(/^data:image\/jpeg/);
    expect(report.pages[1]!.screenshots.mobile).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(10 * 1024 * 1024);
  });
});
