import type { PerfAudit, PerfResult } from './types';

/** Minimal view of a Lighthouse result (LHR); local runs and PSI share the shape. */
interface Lhr {
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<
    string,
    {
      id: string;
      title: string;
      description: string;
      score: number | null;
      scoreDisplayMode?: string;
      displayValue?: string;
      numericValue?: number;
      metricSavings?: Record<string, number>;
      details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number };
    }
  >;
  runtimeError?: { code: string; message: string };
}

export const METRIC_AUDITS: Record<string, string> = {
  'first-contentful-paint': 'fcp',
  'largest-contentful-paint': 'lcp',
  'total-blocking-time': 'tbt',
  'cumulative-layout-shift': 'cls',
  'speed-index': 'si',
  'server-response-time': 'ttfb',
};

const pct = (s: number | null | undefined) => (s === null || s === undefined ? undefined : Math.round(s * 100));

/** Converts a Lighthouse result into our PerfResult. Throws if Lighthouse reported a runtime error. */
export function fromLhr(lhr: Lhr, source: PerfResult['source'], durationMs: number): PerfResult {
  if (lhr.runtimeError?.code && lhr.runtimeError.code !== 'NO_ERROR') {
    throw new Error(`Lighthouse runtime error: ${lhr.runtimeError.code}`);
  }
  const perf = lhr.categories.performance?.score;
  if (perf === null || perf === undefined) throw new Error('Lighthouse returned no performance score');
  const metrics: Record<string, number> = {};
  for (const [id, key] of Object.entries(METRIC_AUDITS)) {
    const a = lhr.audits[id];
    if (a?.numericValue !== undefined) metrics[key] = Math.round(a.numericValue * (key === 'cls' ? 1000 : 1)) / (key === 'cls' ? 1000 : 1);
  }
  const audits: PerfAudit[] = [];
  for (const a of Object.values(lhr.audits)) {
    if (a.score === null || a.score >= 0.9) continue;
    if (a.scoreDisplayMode && !['numeric', 'binary', 'metricSavings'].includes(a.scoreDisplayMode)) continue;
    const isMetric = a.id in METRIC_AUDITS && a.id !== 'server-response-time';
    const savingsMs = a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? a.metricSavings?.FCP ?? a.metricSavings?.TBT;
    const savingsBytes = a.details?.overallSavingsBytes;
    const kind: PerfAudit['kind'] = isMetric ? 'metric' : a.details?.type === 'opportunity' || savingsMs || savingsBytes ? 'opportunity' : 'diagnostic';
    audits.push({
      id: a.id,
      title: a.title,
      description: a.description,
      score: a.score,
      ...(a.displayValue ? { displayValue: a.displayValue } : {}),
      ...(a.numericValue !== undefined ? { numericValue: a.numericValue } : {}),
      ...(savingsMs ? { savingsMs: Math.round(savingsMs) } : {}),
      ...(savingsBytes ? { savingsBytes: Math.round(savingsBytes) } : {}),
      kind,
    });
  }
  return {
    source,
    score: pct(perf)!,
    metrics,
    categories: {
      seo: pct(lhr.categories.seo?.score),
      accessibility: pct(lhr.categories.accessibility?.score),
      bestPractices: pct(lhr.categories['best-practices']?.score),
    },
    audits,
    durationMs,
  };
}
