import { findingId, type Finding } from '@teardown/core';
import { seoRules } from './seo';
import { a11yRules } from './a11y';
import { uxRules } from './ux';
import { securityRules } from './security';
import { brandRules } from './brand';
import { perfRules } from './perf';
import type { Rule, RuleContext, RuleHit } from './types';

export const RULES: Rule[] = [...seoRules, ...a11yRules, ...uxRules, ...securityRules, ...brandRules, ...perfRules];
export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** axe rule ids that one of our own rules already covers (we keep ours). */
export const SUPERSEDED_AXE = new Set(RULES.flatMap((r) => r.supersedesAxe ?? []));

/** Lighthouse audit id -> our rule id that covers it (we keep ours). */
export const LIGHTHOUSE_TO_RULE = new Map(RULES.flatMap((r) => (r.supersedesLighthouse ?? []).map((a) => [a, r.id] as const)));

/** Instances kept per rule per page; the rest are counted, not listed. */
export const MAX_INSTANCES = 10;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** <= 300 chars, single-spaced, script/style bodies emptied, control characters removed. */
export function sanitizeSnippet(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 300 ? clean.slice(0, 299) + '…' : clean;
}

const cap = (s: string | undefined, n: number) => (s === undefined ? undefined : s.length > n ? s.slice(0, n - 1) + '…' : s);

export function toFinding(rule: Pick<Rule, 'id' | 'category' | 'severity' | 'title' | 'detail' | 'fix'>, hit: RuleHit, pageUrl: string, source: Finding['source'] = 'rule', ref?: string): Finding {
  const bbox =
    hit.bbox && hit.bbox.w > 0 && hit.bbox.h > 0
      ? { x: Math.max(0, hit.bbox.x), y: Math.max(0, hit.bbox.y), w: hit.bbox.w, h: hit.bbox.h, viewport: hit.viewport ?? ('desktop' as const) }
      : undefined;
  return {
    id: findingId(rule.id, pageUrl, hit.selector ?? hit.measured ?? ''),
    ruleId: rule.id,
    category: rule.category,
    severity: hit.severity ?? rule.severity,
    source,
    pageUrl: pageUrl.slice(0, 2048),
    title: cap(rule.title, 300)!,
    detail: cap(hit.detail ?? rule.detail, 2000)!,
    evidence: {
      ...(hit.selector ? { selector: cap(hit.selector, 500) } : {}),
      ...(hit.snippet ? { htmlSnippet: sanitizeSnippet(hit.snippet) } : {}),
      ...(bbox ? { bbox } : {}),
      ...(hit.measured ? { measured: cap(hit.measured, 200) } : {}),
      ...(hit.expected ? { expected: cap(hit.expected, 200) } : {}),
      ...(ref ? { ref } : {}),
    },
    fix: {
      summary: rule.fix.summary,
      steps: rule.fix.steps.slice(0, 12),
      ...(rule.fix.codeHint ? { codeHint: rule.fix.codeHint } : {}),
      effort: rule.fix.effort,
      acceptance: rule.fix.acceptance.slice(0, 10),
      ...(rule.fix.verify ? { verify: rule.fix.verify } : {}),
    },
  };
}

/** Keeps finding ids unique within a page (two hits on the same selector get a suffix). */
export function dedupeIds(findings: Finding[]): Finding[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const n = seen.get(f.id) ?? 0;
    seen.set(f.id, n + 1);
    return n === 0 ? f : { ...f, id: `${f.id}-${n + 1}` };
  });
}

export interface RuleRun {
  findings: Finding[];
  counts: Record<string, number>;
  errors: string[];
}

export function runRules(ctx: RuleContext, rules: Rule[] = RULES): RuleRun {
  const findings: Finding[] = [];
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  for (const rule of rules) {
    let hits: RuleHit[];
    try {
      const out = rule.check(ctx);
      hits = !out ? [] : Array.isArray(out) ? out : [out];
    } catch (e) {
      errors.push(`${rule.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!hits.length) continue;
    counts[rule.id] = hits.length;
    for (const h of hits.slice(0, MAX_INSTANCES)) findings.push(toFinding(rule, h, ctx.url));
  }
  return { findings: dedupeIds(findings), counts, errors };
}
