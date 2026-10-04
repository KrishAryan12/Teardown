export interface PerfAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
  numericValue?: number;
  savingsMs?: number;
  savingsBytes?: number;
  kind: 'metric' | 'opportunity' | 'diagnostic';
}

export interface PerfResult {
  source: 'psi' | 'lighthouse';
  /** 0-100 */
  score: number;
  metrics: Record<string, number>;
  categories?: { seo?: number; accessibility?: number; bestPractices?: number };
  audits: PerfAudit[];
  durationMs: number;
}
