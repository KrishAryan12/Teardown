/** UTC day key, e.g. 2026-10-04. */
export function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Next UTC midnight as ISO string. */
export function nextUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * In-memory counters that reset at UTC midnight. Used for global daily budgets
 * (PSI calls, AI calls per provider). Reset on restart/sleep, which is acceptable for v1.
 */
export class DailyCounters {
  protected day = dayKey();
  protected counts = new Map<string, number>();

  protected roll(): void {
    const today = dayKey();
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
  }

  get(key: string): number {
    this.roll();
    return this.counts.get(key) ?? 0;
  }

  incr(key: string, by = 1): number {
    this.roll();
    const n = (this.counts.get(key) ?? 0) + by;
    this.counts.set(key, n);
    return n;
  }

  /** True when another unit fits under `cap` (cap <= 0 means disabled). */
  has(key: string, cap: number): boolean {
    return cap > 0 && this.get(key) < cap;
  }

  remaining(key: string, cap: number): number {
    return Math.max(0, cap - this.get(key));
  }
}
