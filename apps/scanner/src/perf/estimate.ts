import { categoryScore, type Group } from '@teardown/core';
import type { NetworkSummary, PageFacts } from '../capture/types';

/**
 * Last-resort performance score from local measurements (documented in docs/RULES.md):
 *   resource = 100 - weightPenalty - requestPenalty - blockingPenalty - domPenalty
 *     weightPenalty   = min(50, 10 x max(0, MB - 1))
 *     requestPenalty  = min(20, max(0, requests - 60) / 4)
 *     blockingPenalty = min(20, 5 x render-blocking resources)
 *     domPenalty      = min(10, max(0, elements - 1500) / 300)
 *   estimate = round(0.5 x resource + 0.5 x categoryScore(performance rule groups))
 */
export function estimatePerformance(network: NetworkSummary | null, facts: PageFacts | null, perfGroups: Pick<Group, 'worstSeverity' | 'count'>[]): number {
  const mb = (network?.transferBytes ?? 0) / 1024 / 1024;
  const requests = network?.requests ?? 0;
  const blocking = facts?.renderBlocking.length ?? 0;
  const dom = facts?.domNodes ?? 0;
  const resource =
    100 -
    Math.min(50, 10 * Math.max(0, mb - 1)) -
    Math.min(20, Math.max(0, requests - 60) / 4) -
    Math.min(20, 5 * blocking) -
    Math.min(10, Math.max(0, dom - 1500) / 300);
  const rules = categoryScore(perfGroups.map((g) => ({ severity: g.worstSeverity, count: g.count })));
  return Math.round(Math.max(0, Math.min(100, 0.5 * resource + 0.5 * rules)));
}
