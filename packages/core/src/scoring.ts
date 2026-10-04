import type { Category, Finding, Group, Report, Scores, Severity, PerfSource } from './schema';

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 15,
  serious: 8,
  moderate: 4,
  minor: 1,
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/** Weights for the overall score. Sum = 100. */
export const CATEGORY_WEIGHT: Record<Category, number> = {
  performance: 25,
  accessibility: 25,
  seo: 20,
  ux: 15,
  brand: 10,
  security: 5,
};

/** Max multiplier for repeated instances within one rule group. */
export const COUNT_CAP = 2.5;

export function worseSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

/** Penalty for one rule group: weight * (1 + log2(count)), capped at 2.5x the weight. */
export function groupPenalty(severity: Severity, count: number): number {
  const w = SEVERITY_WEIGHT[severity];
  const n = Math.max(1, count);
  return w * Math.min(1 + Math.log2(n), COUNT_CAP);
}

export interface PenaltyGroup {
  severity: Severity;
  count: number;
}

/** 100 minus summed group penalties, clamped 0-100 and rounded. */
export function categoryScore(groups: PenaltyGroup[]): number {
  const penalty = groups.reduce((sum, g) => sum + groupPenalty(g.severity, g.count), 0);
  return Math.round(Math.max(0, Math.min(100, 100 - penalty)));
}

/**
 * Groups findings by ruleId. `counts` (ruleId -> instances, including ones beyond the
 * per-page cap) overrides the number of finding objects when larger.
 */
export function groupFindings(findings: Finding[], counts: Record<string, number> = {}): Group[] {
  const map = new Map<string, Group>();
  for (const f of findings) {
    const g = map.get(f.ruleId);
    if (g) {
      g.count += 1;
      g.worstSeverity = worseSeverity(g.worstSeverity, f.severity);
      g.findingIds.push(f.id);
    } else {
      map.set(f.ruleId, {
        ruleId: f.ruleId,
        category: f.category,
        title: f.title,
        count: 1,
        worstSeverity: f.severity,
        findingIds: [f.id],
      });
    }
  }
  for (const g of map.values()) g.count = Math.max(g.count, counts[g.ruleId] ?? 0);
  return sortGroupsDeterministic([...map.values()]);
}

/** Deterministic priority: severity weight x count factor x category weight. */
export function groupPriorityScore(g: Pick<Group, 'worstSeverity' | 'count' | 'category'>): number {
  return groupPenalty(g.worstSeverity, g.count) * CATEGORY_WEIGHT[g.category];
}

export function sortGroupsDeterministic<T extends Pick<Group, 'worstSeverity' | 'count' | 'category' | 'ruleId'>>(
  groups: T[],
): T[] {
  return [...groups].sort(
    (a, b) =>
      groupPriorityScore(b) - groupPriorityScore(a) ||
      SEVERITY_RANK[a.worstSeverity] - SEVERITY_RANK[b.worstSeverity] ||
      b.count - a.count ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function scoresByCategory(groups: Pick<Group, 'category' | 'worstSeverity' | 'count'>[]): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const cat of ['performance', 'seo', 'accessibility', 'ux', 'brand', 'security'] as Category[]) {
    out[cat] = categoryScore(
      groups.filter((g) => g.category === cat).map((g) => ({ severity: g.worstSeverity, count: g.count })),
    );
  }
  return out;
}

export function overallScore(s: Record<Category, number>): number {
  let total = 0;
  let weight = 0;
  for (const [cat, w] of Object.entries(CATEGORY_WEIGHT) as [Category, number][]) {
    total += s[cat] * w;
    weight += w;
  }
  return Math.round(total / weight);
}

/**
 * Builds the Scores block. The performance score comes from the engine when one ran;
 * otherwise from the deterministic estimate passed in.
 */
export function computeScores(
  groups: Pick<Group, 'category' | 'worstSeverity' | 'count'>[],
  perf: { score: number; source: PerfSource },
): Scores {
  const cats = scoresByCategory(groups);
  cats.performance = Math.round(Math.max(0, Math.min(100, perf.score)));
  return {
    overall: overallScore(cats),
    performance: { score: cats.performance, source: perf.source },
    seo: cats.seo,
    accessibility: cats.accessibility,
    ux: cats.ux,
    brand: cats.brand,
    security: cats.security,
  };
}

/** Groups ordered by AI rank when present, otherwise deterministic. Unranked groups follow ranked ones. */
export function orderedGroups(report: Pick<Report, 'groups' | 'ai'>): Group[] {
  const rank = new Map(report.ai.priorities.map((p) => [p.groupRuleId, p.rank]));
  const det = sortGroupsDeterministic(report.groups);
  const detIndex = new Map(det.map((g, i) => [g.ruleId, i]));
  return [...report.groups].sort((a, b) => {
    const ra = rank.get(a.ruleId);
    const rb = rank.get(b.ruleId);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return detIndex.get(a.ruleId)! - detIndex.get(b.ruleId)!;
  });
}

export function allFindings(report: Pick<Report, 'pages'>): Finding[] {
  return report.pages.flatMap((p) => p.findings);
}

export function scoreBand(score: number): 'good' | 'fair' | 'poor' {
  return score >= 90 ? 'good' : score >= 50 ? 'fair' : 'poor';
}
