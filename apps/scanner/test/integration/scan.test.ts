import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReportSchema, toAgentMarkdown, toJson, type Report, type ScanEvent } from '@teardown/core';
import { loadConfig } from '../../src/config';
import { SsrfGuard } from '../../src/security/guard';
import { BrowserPool } from '../../src/browser/pool';
import { PerfEngine } from '../../src/perf/engine';
import { DailyCounters } from '../../src/util/daily';
import { runScan } from '../../src/scan/run';
import type { AiService } from '../../src/ai/types';
import { startFixtureServer, type FixtureServer } from '../../scripts/fixtureServer';

const noAi: AiService = { available: () => false, advise: async () => Promise.reject(new Error('unused')) };

describe('full single-page scan of the bad fixture (M5: local Lighthouse, no API keys)', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let report: Report;
  const events: ScanEvent[] = [];

  beforeAll(async () => {
    server = await startFixtureServer();
    const cfg = loadConfig({ NODE_ENV: 'test', ALLOW_PRIVATE_TARGETS: 'true', PERF_ENGINE: 'auto' });
    const guard = new SsrfGuard({ allowPrivate: true });
    pool = new BrowserPool({ guard, noSandbox: true, maxContexts: 2 });
    const perf = new PerfEngine({ cfg, counters: new DailyCounters(), proxyUrl: () => pool.proxyUrl() });
    report = await runScan({ url: `${server.origin}/bad.html`, mode: 'single' }, { cfg, guard, pool, perf, ai: noAi }, { emit: (e) => events.push(e) });
  });

  afterAll(async () => {
    await pool?.close();
    await server?.close();
  });

  it('produces a schema-valid report', () => {
    const parsed = ReportSchema.safeParse(report);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 5));
    expect(parsed.success).toBe(true);
  });

  it('measured performance with local Lighthouse', () => {
    expect(report.scores.performance.source).toBe('lighthouse');
    expect(report.lighthouse?.source).toBe('local');
    expect(report.lighthouse?.metrics?.lcp).toBeGreaterThan(0);
    expect(report.pages[0]!.findings.some((f) => f.source === 'lighthouse')).toBe(true);
  });

  it('finds the expected problems and scores them low', () => {
    const ids = new Set(report.groups.map((g) => g.ruleId));
    for (const id of ['seo.h1.missing', 'a11y.img.alt', 'a11y.axe.color-contrast', 'ux.mobile.overflow', 'brand.fonts.too-many', 'perf.img.oversized']) expect(ids, id).toContain(id);
    expect(report.scores.accessibility).toBeLessThan(40);
    expect(report.scores.overall).toBeLessThan(70);
  });

  it('extracts the brand and screenshots with pin boxes', () => {
    expect(report.brand.fonts.length).toBeGreaterThanOrEqual(5);
    expect(report.pages[0]!.screenshots.desktop).toMatch(/^data:image\/jpeg/);
    expect(report.pages[0]!.screenshotSize?.desktop?.w).toBe(1440);
    expect(report.pages[0]!.findings.filter((f) => f.evidence.bbox).length).toBeGreaterThan(5);
  });

  it('falls back to deterministic advice with AI off', () => {
    expect(report.ai.status).toBe('skipped');
    expect(report.ai.summary).toMatch(/scores \d+ out of 100/);
    expect(report.ai.priorities.length).toBe(report.groups.length);
  });

  it('streams step events', () => {
    const steps = events.filter((e) => e.type === 'step').map((e) => (e as { data: { name: string } }).data.name);
    expect(steps).toEqual(expect.arrayContaining(['Check the address', 'Read robots.txt and sitemap', 'Load page', 'Measure performance']));
  });

  it('exports JSON and Markdown from the real report', () => {
    const md = toAgentMarkdown(report);
    expect(md).toContain('# Teardown agent brief: 127.0.0.1');
    expect(md).toMatch(/### T1\. /);
    expect(JSON.parse(toJson(report, { images: false })).tokens.color).toBeDefined();
  });
});
