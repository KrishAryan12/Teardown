import { describe, expect, it } from 'vitest';
import {
  categoryScore,
  computeScores,
  groupFindings,
  groupPenalty,
  orderedGroups,
  overallScore,
  SEVERITIES,
  type PenaltyGroup,
  type Severity,
} from '../src';
import { makeFinding, makeReport } from './fixtures';

/** Small deterministic PRNG so the property test is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe('groupPenalty', () => {
  it('uses the documented weights and cap', () => {
    expect(groupPenalty('critical', 1)).toBe(15);
    expect(groupPenalty('serious', 1)).toBe(8);
    expect(groupPenalty('moderate', 1)).toBe(4);
    expect(groupPenalty('minor', 1)).toBe(1);
    expect(groupPenalty('critical', 2)).toBe(30);
    expect(groupPenalty('critical', 1000)).toBe(37.5);
  });
});

describe('categoryScore monotonicity', () => {
  const rand = rng(42);
  const randomGroups = (): PenaltyGroup[] =>
    Array.from({ length: Math.floor(rand() * 6) }, () => ({
      severity: SEVERITIES[Math.floor(rand() * 4)]!,
      count: 1 + Math.floor(rand() * 20),
    }));

  it('starts at 100 with no findings', () => {
    expect(categoryScore([])).toBe(100);
  });

  it('never rises when a group is added', () => {
    for (let i = 0; i < 500; i++) {
      const groups = randomGroups();
      const extra = randomGroups()[0] ?? { severity: 'minor' as Severity, count: 1 };
      expect(categoryScore([...groups, extra])).toBeLessThanOrEqual(categoryScore(groups));
    }
  });

  it('never rises when a group gets more instances', () => {
    for (let i = 0; i < 500; i++) {
      const groups = randomGroups();
      if (!groups.length) continue;
      const k = Math.floor(rand() * groups.length);
      const more = groups.map((g, j) => (j === k ? { ...g, count: g.count + 1 + Math.floor(rand() * 5) } : g));
      expect(categoryScore(more)).toBeLessThanOrEqual(categoryScore(groups));
    }
  });

  it('never rises when a group gets worse', () => {
    for (let i = 0; i < 500; i++) {
      const groups = randomGroups();
      if (!groups.length) continue;
      const k = Math.floor(rand() * groups.length);
      const idx = SEVERITIES.indexOf(groups[k]!.severity);
      if (idx === 0) continue;
      const worse = groups.map((g, j) => (j === k ? { ...g, severity: SEVERITIES[idx - 1]! } : g));
      expect(categoryScore(worse)).toBeLessThanOrEqual(categoryScore(groups));
    }
  });

  it('clamps at 0', () => {
    expect(categoryScore(Array.from({ length: 20 }, () => ({ severity: 'critical' as const, count: 50 })))).toBe(0);
  });
});

describe('groupFindings', () => {
  it('groups by rule, tracks worst severity and honours instance counts', () => {
    const groups = groupFindings(
      [
        makeFinding('seo.img.alt', { severity: 'moderate', selector: 'img:nth-of-type(1)' }),
        makeFinding('seo.img.alt', { severity: 'serious', selector: 'img:nth-of-type(2)' }),
        makeFinding('seo.title.missing', { severity: 'serious' }),
      ],
      { 'seo.img.alt': 80 },
    );
    const alt = groups.find((g) => g.ruleId === 'seo.img.alt')!;
    expect(alt.count).toBe(80);
    expect(alt.worstSeverity).toBe('serious');
    expect(alt.findingIds).toHaveLength(2);
  });
});

describe('overall and computed scores', () => {
  it('is the weighted mean', () => {
    expect(overallScore({ performance: 100, accessibility: 100, seo: 100, ux: 100, brand: 100, security: 100 })).toBe(100);
    expect(overallScore({ performance: 0, accessibility: 100, seo: 100, ux: 100, brand: 100, security: 100 })).toBe(75);
  });
  it('takes performance from the engine', () => {
    const s = computeScores([], { score: 61.4, source: 'lighthouse' });
    expect(s.performance).toEqual({ score: 61, source: 'lighthouse' });
    expect(s.seo).toBe(100);
  });
  it('overall never rises when findings are added', () => {
    const base = [makeFinding('seo.a', { severity: 'minor' })];
    const more = [...base, makeFinding('accessibility.b', { severity: 'critical', category: 'accessibility' })];
    const s1 = computeScores(groupFindings(base), { score: 80, source: 'estimated' });
    const s2 = computeScores(groupFindings(more), { score: 80, source: 'estimated' });
    expect(s2.overall).toBeLessThanOrEqual(s1.overall);
  });
});

describe('orderedGroups', () => {
  it('follows AI ranks, then deterministic order for the rest', () => {
    const r = makeReport([
      makeFinding('seo.a', { severity: 'critical' }),
      makeFinding('seo.b', { severity: 'minor' }),
      makeFinding('seo.c', { severity: 'serious' }),
    ]);
    expect(orderedGroups(r).map((g) => g.ruleId)).toEqual(['seo.a', 'seo.c', 'seo.b']);
    r.ai.priorities = [{ groupRuleId: 'seo.b', rank: 1, rationale: 'x' }];
    expect(orderedGroups(r).map((g) => g.ruleId)).toEqual(['seo.b', 'seo.a', 'seo.c']);
  });
});
