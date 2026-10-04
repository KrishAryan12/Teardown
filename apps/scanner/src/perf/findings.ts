import type { Finding, Severity } from '@teardown/core';
import { LIGHTHOUSE_TO_RULE, dedupeIds, toFinding } from '../rules';
import type { FixTemplate } from '../rules/types';
import type { PerfAudit, PerfResult } from './types';

/** Diagnostics worth reporting even without a savings estimate. Everything else informational is skipped. */
const USEFUL_DIAGNOSTICS = new Set([
  'lcp-discovery-insight',
  'lcp-phases-insight',
  'cls-culprits-insight',
  'font-display-insight',
  'duplicated-javascript-insight',
  'legacy-javascript-insight',
  'forced-reflow-insight',
  'unused-javascript',
  'unused-css-rules',
  'bootup-time',
  'mainthread-work-breakdown',
  'long-tasks',
  'cache-insight',
]);

const METRIC_FIX: Record<string, { title: string; fix: FixTemplate }> = {
  'largest-contentful-paint': {
    title: 'Largest Contentful Paint is slow',
    fix: {
      summary: 'Make the largest above-the-fold element (usually the hero image or heading) render sooner.',
      steps: [
        'Identify the LCP element in DevTools > Performance (look for the LCP marker).',
        'If it is an image: serve it in AVIF/WebP at display size, add fetchpriority="high", and never lazy-load it.',
        'Preload the LCP image or font, and remove render-blocking CSS/JS in front of it.',
        'Reduce server response time (cache HTML at the edge).',
      ],
      codeHint: '<img src="hero.avif" width="1200" height="800" fetchpriority="high" alt="…">',
      effort: 'm',
      acceptance: ['Lighthouse mobile LCP is 2.5 s or less.'],
      verify: 'Run Lighthouse (mobile) in Chrome DevTools and read the LCP metric.',
    },
  },
  'cumulative-layout-shift': {
    title: 'Layout shifts while the page loads',
    fix: {
      summary: 'Reserve space for images, embeds, ads and late-loading UI so content does not jump.',
      steps: ['Add width/height or aspect-ratio to every image and embed.', 'Reserve space for banners and ads with min-height.', 'Use font-display: optional or size-adjusted fallbacks to avoid font swaps that reflow text.'],
      effort: 's',
      acceptance: ['Lighthouse CLS is 0.1 or less.'],
      verify: 'DevTools > Performance > enable "Layout shift regions" and reload.',
    },
  },
  'total-blocking-time': {
    title: 'Main thread is blocked by JavaScript',
    fix: {
      summary: 'Ship less JavaScript up front and break long tasks into smaller ones.',
      steps: ['Find long tasks in DevTools > Performance.', 'Code-split routes and lazy-load heavy components.', 'Defer or remove third-party scripts.', 'Move expensive work off the main thread or yield with scheduler.yield/setTimeout.'],
      effort: 'm',
      acceptance: ['Lighthouse mobile TBT is 200 ms or less.'],
    },
  },
  'first-contentful-paint': {
    title: 'First paint is slow',
    fix: {
      summary: 'Get something on screen sooner: cut render-blocking resources and server response time.',
      steps: ['Inline critical CSS and defer the rest.', 'Add defer to scripts in <head>.', 'Cache HTML at the edge and enable compression.'],
      effort: 'm',
      acceptance: ['Lighthouse mobile FCP is 1.8 s or less.'],
    },
  },
  'speed-index': {
    title: 'Page fills in slowly',
    fix: {
      summary: 'Render above-the-fold content earlier and avoid late-loading hero content.',
      steps: ['Prioritise above-the-fold resources (preload, fetchpriority).', 'Avoid client-side rendering of the first screen.', 'Remove render-blocking resources.'],
      effort: 'm',
      acceptance: ['Lighthouse mobile Speed Index is 3.4 s or less.'],
    },
  },
};

/** Lighthouse descriptions contain Markdown links; keep the text, drop the URLs. */
export function plainDescription(md: string): string {
  return md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function severityFor(a: PerfAudit): Severity {
  if (a.kind === 'metric') return (a.score ?? 1) < 0.5 ? 'serious' : 'moderate';
  if ((a.savingsMs ?? 0) >= 1000 || (a.savingsBytes ?? 0) >= 500_000) return 'serious';
  if ((a.savingsMs ?? 0) >= 300 || (a.savingsBytes ?? 0) >= 100_000) return 'moderate';
  return 'minor';
}

const kib = (b: number) => `${Math.round(b / 1024)} KiB`;

/**
 * Turns audits scoring below 0.9 into `perf.lh.*` findings: the core metrics plus the top
 * opportunities, skipping audits our own rules already cover.
 */
export function lighthouseFindings(result: PerfResult, pageUrl: string, maxOpportunities = 6): Finding[] {
  const out: Finding[] = [];
  const label = result.source === 'psi' ? 'PageSpeed Insights' : 'local Lighthouse (indicative lab data)';
  const metrics = result.audits.filter((a) => a.kind === 'metric');
  const others = result.audits
    .filter((a) => a.kind !== 'metric' && !LIGHTHOUSE_TO_RULE.has(a.id) && (a.kind === 'opportunity' || USEFUL_DIAGNOSTICS.has(a.id)))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsBytes ?? 0) - (a.savingsBytes ?? 0))
    .slice(0, maxOpportunities);
  for (const a of [...metrics, ...others]) {
    const known = METRIC_FIX[a.id];
    const desc = plainDescription(a.description);
    const rule = {
      id: `perf.lh.${a.id}`,
      category: 'performance' as const,
      severity: severityFor(a),
      title: known?.title ?? a.title,
      detail: `${desc} Measured by ${label}.`.slice(0, 1900),
      fix:
        known?.fix ??
        ({
          summary: `${a.title}.${a.savingsMs ? ` Estimated saving: ${a.savingsMs} ms.` : ''}${a.savingsBytes ? ` Estimated saving: ${kib(a.savingsBytes)}.` : ''}`,
          steps: [desc.slice(0, 500), 'Re-run Lighthouse to confirm the audit passes.'],
          effort: 's',
          acceptance: [`Lighthouse audit "${a.id}" scores 0.9 or higher.`],
          verify: 'Chrome DevTools > Lighthouse > Mobile > Performance.',
        } satisfies FixTemplate),
    };
    const measured = a.displayValue ?? (a.savingsBytes ? `${kib(a.savingsBytes)} to save` : a.score !== null ? `score ${Math.round(a.score * 100)}` : undefined);
    out.push(toFinding(rule, { measured, expected: known ? known.fix.acceptance[0]!.replace(/^Lighthouse (mobile )?\w+ is /, '').replace(/\.$/, '') : 'score >= 90' }, pageUrl, 'lighthouse', a.id));
  }
  return dedupeIds(out);
}
