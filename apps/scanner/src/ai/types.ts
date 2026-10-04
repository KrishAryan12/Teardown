import type { Category, Group, Report, Severity } from '@teardown/core';

/** What the scan hands to the AI layer: aggregated groups, never raw HTML. */
export interface AiGroupInput {
  ruleId: string;
  category: Category;
  severity: Severity;
  count: number;
  title: string;
  fixSummary: string;
  sample: { page?: string; selector?: string; snippet?: string; measured?: string; expected?: string };
}

export interface AiInput {
  host: string;
  mode: Report['mode'];
  pageCount: number;
  stack: string[];
  siteLine: string;
  brandLine: string;
  scores: Report['scores'];
  groups: AiGroupInput[];
  /** Groups beyond the ones sent in full: id + count only. */
  rest: { ruleId: string; count: number }[];
}

export interface AiResult {
  status: Report['ai']['status'];
  model?: string;
  summary: string;
  priorities: { groupRuleId: string; rank: number; rationale: string }[];
  instructions: { groupRuleId: string; instruction: string }[];
  notes?: string;
}

export interface AiService {
  /** Whether a call is likely to be made today (keys present, budget left, not all circuits open). */
  available(): boolean;
  /** Plain-language reason when available() is false. */
  unavailableReason?(): string;
  advise(input: AiInput, groups: Group[]): Promise<AiResult>;
}
