import { SEVERITY_RANK, type Finding, type Group, type Report } from '@teardown/core';
import type { AiGroupInput, AiInput } from './types';

// Control, zero-width, bidi-override and BOM characters. Built from escapes so the source stays ASCII.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', 'g');

/**
 * Page-derived text is untrusted. Strip control and bidi characters, collapse whitespace, remove
 * anything resembling our prompt delimiters, and truncate.
 */
export function untrusted(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const clean = s
    .replace(CONTROL, ' ')
    .replace(/<{2,}|>{2,}|\[\[|\]\]|```/g, ' ')
    .replace(/\b(BEGIN|END)[ _-]?(UNTRUSTED|PAGE|DATA)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/** Top groups by severity then count, sent in full; the rest as ids and counts. */
export const MAX_GROUPS_IN_FULL = 20;

export function buildAiInput(report: Pick<Report, 'target' | 'mode' | 'stack' | 'scores' | 'brand' | 'pages'>, groups: Group[]): AiInput {
  const byId = new Map<string, Finding>(report.pages.flatMap((p) => p.findings.map((f) => [f.id, f] as const)));
  const sorted = [...groups].sort((a, b) => SEVERITY_RANK[a.worstSeverity] - SEVERITY_RANK[b.worstSeverity] || b.count - a.count || a.ruleId.localeCompare(b.ruleId));
  const full = sorted.slice(0, MAX_GROUPS_IN_FULL);
  const rest = sorted.slice(MAX_GROUPS_IN_FULL).map((g) => ({ ruleId: g.ruleId, count: g.count }));
  const toInput = (g: Group): AiGroupInput => {
    const f = g.findingIds.map((id) => byId.get(id)).find(Boolean);
    return {
      ruleId: g.ruleId,
      category: g.category,
      severity: g.worstSeverity,
      count: g.count,
      title: untrusted(g.title, 100) ?? g.ruleId,
      fixSummary: untrusted(f?.fix.summary, 220) ?? '',
      sample: {
        page: f ? untrusted(new URL(f.pageUrl).pathname, 80) : undefined,
        selector: untrusted(f?.evidence.selector, 100),
        snippet: untrusted(f?.evidence.htmlSnippet, 140),
        measured: untrusted(f?.evidence.measured, 80),
        expected: untrusted(f?.evidence.expected, 60),
      },
    };
  };
  const b = report.brand;
  const brandLine = [
    b.colors.length ? `${b.colors.length} colours (${b.colors.slice(0, 4).map((c) => `${c.hex} ${c.role ?? ''}`.trim()).join(', ')})` : 'no colour data',
    b.fonts.length ? `fonts ${b.fonts.slice(0, 3).map((f) => untrusted(f.family, 30)).join(', ')}` : 'no font data',
    b.spacing.baseUnit ? `${b.spacing.baseUnit}px spacing grid` : 'no spacing grid',
  ].join('; ');
  const s = report.scores;
  return {
    host: report.target.host,
    mode: report.mode,
    pageCount: report.pages.length,
    stack: report.stack.map((x) => untrusted(x.name, 30)!).filter(Boolean).slice(0, 6),
    siteLine: `${report.mode === 'site' ? `${report.pages.length} pages` : '1 page'}; scores overall ${s.overall}, performance ${s.performance.score} (${s.performance.source}), accessibility ${s.accessibility}, SEO ${s.seo}, UX ${s.ux}, brand ${s.brand}, security ${s.security}.`,
    brandLine,
    scores: report.scores,
    groups: full.map(toInput),
    rest,
  };
}
