import { findingId, groupFindings, computeScores, REPORT_SCHEMA, RULESET_VERSION } from '../src';
import type { Finding, Report, Severity, Category } from '../src';

export function makeFinding(
  ruleId: string,
  opts: { severity?: Severity; category?: Category; selector?: string; page?: string } = {},
): Finding {
  const page = opts.page ?? 'https://example.com/';
  return {
    id: findingId(ruleId, page, opts.selector ?? ''),
    ruleId,
    category: opts.category ?? 'seo',
    severity: opts.severity ?? 'moderate',
    source: 'rule',
    pageUrl: page,
    title: `Title for ${ruleId}`,
    detail: `Detail for ${ruleId}.`,
    evidence: { selector: opts.selector, measured: '1', expected: '2' },
    fix: {
      summary: `Fix ${ruleId}.`,
      steps: ['Step one.', 'Step two.'],
      effort: 's',
      acceptance: [`${ruleId} passes.`],
    },
  };
}

export function makeReport(findings: Finding[] = []): Report {
  const groups = groupFindings(findings);
  return {
    schema: REPORT_SCHEMA,
    generatedAt: '2026-10-04T12:00:00.000Z',
    rulesetVersion: RULESET_VERSION,
    mode: 'single',
    target: { inputUrl: 'example.com', finalUrl: 'https://example.com/', host: 'example.com' },
    stack: [{ name: 'Next.js', confidence: 'high' }],
    scores: computeScores(groups, { score: 72, source: 'lighthouse' }),
    lighthouse: { source: 'local', performance: 72 },
    pages: [{ url: 'https://example.com/', title: 'Example', status: 200, timings: { total: 1000 }, screenshots: {}, findings }],
    brand: {
      colors: [
        { hex: '#ffffff', role: 'background', share: 0.6, samples: 40 },
        { hex: '#111111', role: 'text', share: 0.3, samples: 80 },
        { hex: '#0055ff', role: 'accent', share: 0.1, samples: 12 },
      ],
      cssVariables: { '--brand': '#0055ff' },
      fonts: [{ family: 'Inter', source: 'google', weights: [400, 700], usedFor: ['heading', 'body'], fallbackStack: 'Inter, sans-serif' }],
      typeScale: [
        { px: 16, count: 50, sampleTag: 'p' },
        { px: 32, count: 3, sampleTag: 'h1' },
      ],
      spacing: { baseUnit: 8, onGridRatio: 0.9, values: [{ px: 8, count: 20 }, { px: 16, count: 30 }] },
      radii: [{ px: 4, count: 10 }],
      shadows: ['0 1px 2px rgba(0,0,0,0.2)'],
      contrast: [{ fg: '#111111', bg: '#ffffff', ratio: 18.88, passAA: true, passAAA: true, count: 80 }],
      contrastUnknown: 0,
      assets: { favicon: 'https://example.com/favicon.ico' },
      consistency: { colorCount: 3, fontCount: 1, notes: [] },
    },
    groups,
    ai: { status: 'fallback', summary: 'The site is in fair shape. Fix the missing title first.', priorities: [] },
    limits: { pagesScanned: 1, pagesSkipped: 0, truncated: false },
  };
}
