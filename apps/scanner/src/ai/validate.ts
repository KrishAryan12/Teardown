import { AiOutputSchema, sortGroupsDeterministic, type Group } from '@teardown/core';
import type { AiInput, AiResult } from './types';

export interface ValidationStats {
  jsonValid: boolean;
  schemaValid: boolean;
  invalidIds: number;
  lengthViolations: number;
  coverage: number;
}

export interface Validated {
  ok: boolean;
  result?: Omit<AiResult, 'status' | 'model'>;
  stats: ValidationStats;
  reason?: string;
}

const SAFE_LINK_HOSTS = /^(developer\.mozilla\.org|web\.dev|www\.w3\.org|w3c\.github\.io|developers\.google\.com|dequeuniversity\.com)$/i;

/** Pulls the JSON object out of a reply that may include code fences or chatter. */
export function extractJson(raw: string): unknown {
  const fenced = raw.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(fenced.slice(start, end + 1));
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

function clampWords(s: string, max: number): { text: string; violated: boolean } {
  const w = words(s);
  if (w.length <= max) return { text: s.trim(), violated: false };
  return { text: w.slice(0, max).join(' ').replace(/[,;:]$/, '') + '…', violated: true };
}

/** AI text is plain text: no HTML, no markdown links, no off-site URLs (except well-known docs). */
export function cleanAiText(s: string, targetHost: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/https?:\/\/[^\s)"']+/gi, (u) => {
        try {
          const h = new URL(u).hostname;
          return h === targetHost || h.endsWith('.' + targetHost) || SAFE_LINK_HOSTS.test(h) ? u : '[link removed]';
        } catch {
          return '[link removed]';
        }
      })
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Validates and repairs model output. The model can only reorder groups that were sent and reword
 * text: unknown ids are discarded, ranks are renumbered, missing groups are appended in
 * deterministic order, and lengths are enforced. Fails when too little of the output is usable.
 */
export function validateAiOutput(raw: string, input: AiInput, groups: Group[]): Validated {
  const stats: ValidationStats = { jsonValid: false, schemaValid: false, invalidIds: 0, lengthViolations: 0, coverage: 0 };
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
    stats.jsonValid = true;
  } catch {
    return { ok: false, stats, reason: 'invalid JSON' };
  }
  const res = AiOutputSchema.safeParse(parsed);
  if (!res.success) return { ok: false, stats, reason: 'schema mismatch' };
  stats.schemaValid = true;
  const out = res.data;

  const sent = new Set(input.groups.map((g) => g.ruleId));
  const seen = new Set<string>();
  const ranked: { groupRuleId: string; rank: number; rationale: string }[] = [];
  for (const p of [...out.priorities].sort((a, b) => a.rank - b.rank)) {
    if (!sent.has(p.groupRuleId)) {
      stats.invalidIds++;
      continue;
    }
    if (seen.has(p.groupRuleId)) continue;
    seen.add(p.groupRuleId);
    const r = clampWords(cleanAiText(p.rationale, input.host), 20);
    if (r.violated) stats.lengthViolations++;
    ranked.push({ groupRuleId: p.groupRuleId, rank: 0, rationale: r.text });
  }
  stats.coverage = sent.size ? ranked.length / sent.size : 1;
  if (stats.coverage < 0.5) return { ok: false, stats, reason: 'too few valid groups ranked' };

  // Groups the model skipped, then the groups never sent, both in deterministic order.
  const det = sortGroupsDeterministic(groups);
  for (const g of det) {
    if (seen.has(g.ruleId)) continue;
    seen.add(g.ruleId);
    ranked.push({ groupRuleId: g.ruleId, rank: 0, rationale: `${g.worstSeverity} ${g.category} issue${g.count > 1 ? `, ${g.count} instances` : ''}.` });
  }
  ranked.forEach((p, i) => (p.rank = i + 1));

  const top10 = new Set(ranked.slice(0, 10).map((p) => p.groupRuleId));
  const instructions: AiResult['instructions'] = [];
  const instrSeen = new Set<string>();
  for (const ins of out.instructions) {
    if (!sent.has(ins.groupRuleId)) {
      stats.invalidIds++;
      continue;
    }
    if (!top10.has(ins.groupRuleId) || instrSeen.has(ins.groupRuleId)) continue;
    instrSeen.add(ins.groupRuleId);
    const w = words(ins.instruction).length;
    if (w > 50) stats.lengthViolations++;
    const text = clampWords(cleanAiText(ins.instruction, input.host), 60).text;
    if (text.length >= 10) instructions.push({ groupRuleId: ins.groupRuleId, instruction: text });
  }

  let summary = cleanAiText(out.summary, input.host).replace(/^#+\s*/gm, '').replace(/\*\*/g, '');
  const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 5) {
    stats.lengthViolations++;
    summary = sentences.slice(0, 4).join(' ');
  }
  if (summary.length < 20) return { ok: false, stats, reason: 'summary too short' };

  return { ok: true, stats, result: { summary: summary.slice(0, 1200), priorities: ranked, instructions } };
}
