/** Per provider/model circuit breaker so a failing model isn't retried on every scan. */
export const COOLDOWN = {
  rateLimited: 30 * 60_000, // 429
  gone: 6 * 60 * 60_000, // 402 credits exhausted, 404 / retired model, 401/403 bad key
  invalid: 30 * 60_000, // repeated invalid output
  transient: 2 * 60_000, // 5xx / timeout
};

export class CircuitBreaker {
  private readonly openUntil = new Map<string, number>();
  private readonly invalidStreak = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  isOpen(key: string): boolean {
    const t = this.openUntil.get(key);
    if (t === undefined) return false;
    if (t <= this.now()) {
      this.openUntil.delete(key);
      return false;
    }
    return true;
  }

  trip(key: string, ms: number): void {
    this.openUntil.set(key, Math.max(this.openUntil.get(key) ?? 0, this.now() + ms));
  }

  /** Records an invalid output; trips after 2 in a row. */
  invalid(key: string): void {
    const n = (this.invalidStreak.get(key) ?? 0) + 1;
    this.invalidStreak.set(key, n);
    if (n >= 2) {
      this.trip(key, COOLDOWN.invalid);
      this.invalidStreak.set(key, 0);
    }
  }

  success(key: string): void {
    this.invalidStreak.delete(key);
  }

  /** Maps an HTTP status to a cool-down, or null when the error shouldn't open the circuit. */
  static cooldownFor(status: number, modelGone: boolean): number | null {
    if (status === 429) return COOLDOWN.rateLimited;
    if (status === 402 || status === 401 || status === 403 || modelGone) return COOLDOWN.gone;
    if (status >= 500 || status === 408 || status === 0) return COOLDOWN.transient;
    return null;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.openUntil.entries()].filter(([, t]) => t > this.now()));
  }
}
