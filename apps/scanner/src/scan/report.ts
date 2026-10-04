import {
  REPORT_SCHEMA,
  RULESET_VERSION,
  computeScores,
  groupFindings,
  scoresByCategory,
  type BrandProfile,
  type Finding,
  type Page,
  type PerfSource,
  type Report,
} from '@teardown/core';

export interface PageOutcome {
  url: string;
  title?: string;
  status: number;
  timings: Record<string, number>;
  screenshots: { desktop?: string; mobile?: string };
  screenshotSize?: Page['screenshotSize'];
  findings: Finding[];
  counts: Record<string, number>;
  metrics?: Record<string, number>;
  /** Engine performance score for this page, when an engine ran on it. */
  perfScore?: number;
}

export interface ReportInput {
  mode: Report['mode'];
  inputUrl: string;
  finalUrl: string;
  stack: Report['stack'];
  pages: PageOutcome[];
  brand: BrandProfile;
  perf: { score: number; source: PerfSource };
  lighthouse?: Report['lighthouse'];
  ai: Report['ai'];
  limits: Report['limits'];
  reducedAccuracy?: boolean;
  generatedAt?: string;
}

export function sumCounts(pages: Pick<PageOutcome, 'counts'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pages) for (const [k, v] of Object.entries(p.counts)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function buildReport(i: ReportInput): Report {
  const findings = i.pages.flatMap((p) => p.findings);
  const groups = groupFindings(findings, sumCounts(i.pages));
  const pages: Page[] = i.pages.map((p) => {
    const pageGroups = groupFindings(p.findings, p.counts);
    const cats = scoresByCategory(pageGroups);
    if (p.perfScore !== undefined) cats.performance = p.perfScore;
    return {
      url: p.url,
      ...(p.title ? { title: p.title.slice(0, 300) } : {}),
      status: p.status,
      timings: p.timings,
      screenshots: p.screenshots,
      ...(p.screenshotSize ? { screenshotSize: p.screenshotSize } : {}),
      findings: p.findings,
      ruleCounts: p.counts,
      scores: cats,
      ...(p.metrics ? { metrics: p.metrics } : {}),
    };
  });
  return {
    schema: REPORT_SCHEMA,
    generatedAt: i.generatedAt ?? new Date().toISOString(),
    rulesetVersion: RULESET_VERSION,
    mode: i.mode,
    target: { inputUrl: i.inputUrl.slice(0, 2048), finalUrl: i.finalUrl.slice(0, 2048), host: new URL(i.finalUrl).hostname },
    stack: i.stack,
    scores: computeScores(groups, i.perf),
    ...(i.lighthouse ? { lighthouse: i.lighthouse } : {}),
    pages,
    brand: i.brand,
    groups,
    ai: i.ai,
    limits: i.limits,
    ...(i.reducedAccuracy ? { reducedAccuracy: true } : {}),
  };
}

/**
 * Keeps the serialised report under `maxBytes` by dropping screenshots, lowest priority first:
 * desktop shots of later pages, then the mobile shot, then the first page's desktop shot.
 */
export function enforcePayloadCap(report: Report, maxBytes: number): Report {
  const size = () => Buffer.byteLength(JSON.stringify(report));
  if (size() <= maxBytes) return report;
  let dropped = 0;
  const order: { page: number; kind: 'desktop' | 'mobile' }[] = [];
  for (let p = report.pages.length - 1; p >= 1; p--) order.push({ page: p, kind: 'mobile' }, { page: p, kind: 'desktop' });
  order.push({ page: 0, kind: 'mobile' }, { page: 0, kind: 'desktop' });
  for (const o of order) {
    const shots = report.pages[o.page]!.screenshots;
    if (!shots[o.kind]) continue;
    delete shots[o.kind];
    dropped++;
    if (size() <= maxBytes) break;
  }
  if (dropped) {
    report.limits.screenshotsDropped = (report.limits.screenshotsDropped ?? 0) + dropped;
    report.limits.notes = [...(report.limits.notes ?? []), `${dropped} screenshot(s) were left out to keep the report under ${Math.round(maxBytes / 1024 / 1024)} MB.`];
  }
  return report;
}
