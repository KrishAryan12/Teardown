import { CATEGORY_WEIGHT, sortGroupsDeterministic, type Category, type Group, type Report } from '@teardown/core';
import type { AiResult } from './types';

export interface SummaryContext {
  scores: Report['scores'];
  host: string;
  pageCount: number;
}

const LABEL: Record<Category, string> = {
  performance: 'performance',
  seo: 'SEO',
  accessibility: 'accessibility',
  ux: 'usability',
  brand: 'brand consistency',
  security: 'security hygiene',
};

/** Plain-language summary written from scores and the top groups, no model involved. */
export function deterministicSummary(ctx: SummaryContext, groups: Group[]): string {
  const s = ctx.scores;
  const cats = (Object.keys(CATEGORY_WEIGHT) as Category[]).map((c) => ({ c, v: c === 'performance' ? s.performance.score : s[c] }));
  const weakest = [...cats].sort((a, b) => a.v - b.v)[0]!;
  const strongest = [...cats].sort((a, b) => b.v - a.v)[0]!;
  const top = sortGroupsDeterministic(groups).slice(0, 3);
  const pages = ctx.pageCount;
  const total = groups.reduce((n, g) => n + g.count, 0);
  const parts = [
    `${ctx.host} scores ${s.overall} out of 100 overall, strongest on ${LABEL[strongest.c]} (${strongest.v}) and weakest on ${LABEL[weakest.c]} (${weakest.v}).`,
    total
      ? `Teardown found ${total} issue${total === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'} across ${pages} page${pages === 1 ? '' : 's'}.`
      : `Teardown found no issues on the ${pages} page${pages === 1 ? '' : 's'} it checked.`,
  ];
  if (top.length) {
    const names = top.map((g) => g.title.charAt(0).toLowerCase() + g.title.slice(1));
    parts.push(`Start with: ${names.length > 1 ? names.slice(0, -1).join('; ') + ' and ' + names.at(-1) : names[0]}.`);
  }
  return parts.join(' ');
}

/** Deterministic ordering and fix-template text, used when AI is off, over budget or failing. */
export function deterministicAdvice(ctx: SummaryContext, groups: Group[], status: 'fallback' | 'skipped', notes: string): AiResult {
  const ordered = sortGroupsDeterministic(groups);
  return {
    status,
    summary: deterministicSummary(ctx, groups),
    priorities: ordered.map((g, i) => ({
      groupRuleId: g.ruleId,
      rank: i + 1,
      rationale: `${g.worstSeverity} ${LABEL[g.category]} issue${g.count > 1 ? `, ${g.count} instances` : ''}.`,
    })),
    instructions: [],
    notes,
  };
}
