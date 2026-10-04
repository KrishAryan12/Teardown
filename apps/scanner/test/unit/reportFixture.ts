import type { Report } from '@teardown/core';
import { analyzePage } from '../../src/scan/analyze';
import { buildReport } from '../../src/scan/report';
import { processBrand } from '../../src/brand/process';
import { deterministicAdvice } from '../../src/ai/fallback';
import { applyAdvice } from '../../src/scan/run';
import { loadCapture, noSignals } from './helpers';

/** A complete, schema-valid report built from the captured bad fixture (no screenshots). */
export function makeReportFromFixture(name: 'bad' | 'good' = 'bad'): Report {
  const cap = loadCapture(name);
  const a = analyzePage(cap, noSignals, true);
  const report = buildReport({
    mode: 'single',
    inputUrl: cap.finalUrl,
    finalUrl: cap.finalUrl,
    stack: [{ name: 'WordPress', confidence: 'high' }],
    pages: [{ url: cap.finalUrl, title: cap.title, status: cap.status, timings: { total: 1000 }, screenshots: {}, findings: a.findings, counts: a.counts }],
    brand: processBrand([cap.brand!]).profile,
    perf: { score: 61, source: 'lighthouse' },
    lighthouse: { source: 'local', performance: 61 },
    ai: { status: 'skipped', summary: '', priorities: [] },
    limits: { pagesScanned: 1, pagesSkipped: 0, truncated: false },
    generatedAt: '2026-10-04T12:00:00.000Z',
  });
  return applyAdvice(report, deterministicAdvice({ scores: report.scores, host: report.target.host, pageCount: 1 }, report.groups, 'fallback', 'Test fallback.'));
}
