/**
 * Fixed-window counters behind an interface so a shared store (e.g. Upstash Redis free tier) can
 * replace the in-memory one later. In-memory counters reset when the process restarts or the
 * host sleeps, which is acceptable for v1 (docs/DECISIONS.md D-14).
 */
export interface RateStore {
  /** Current count for key in the window that contains now. */
  get(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  /** Increments and returns the new count. */
  incr(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

/** Windows aligned to wall-clock boundaries (hour/day in UTC) so reset times are predictable. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

export class MemoryRateStore implements RateStore {
  private readonly map = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  private entry(key: string, windowMs: number) {
    const now = this.now();
    const start = windowStart(now, windowMs);
    const k = `${key}|${windowMs}`;
    let e = this.map.get(k);
    if (!e || e.start !== start) {
      e = { start, count: 0 };
      this.map.set(k, e);
    }
    this.sweep(now);
    return { e, resetAt: start + windowMs };
  }

  /** Drops expired windows so memory stays bounded. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.map) {
      const windowMs = Number(k.slice(k.lastIndexOf('|') + 1));
      if (v.start + windowMs <= now) this.map.delete(k);
    }
  }

  async get(key: string, windowMs: number) {
    const { e, resetAt } = this.entry(key, windowMs);
    return { count: e.count, resetAt };
  }

  async incr(key: string, windowMs: number) {
    const { e, resetAt } = this.entry(key, windowMs);
    e.count++;
    return { count: e.count, resetAt };
  }
}

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;
