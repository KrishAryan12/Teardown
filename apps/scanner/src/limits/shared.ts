import { Redis } from '@upstash/redis';
import { DailyCounters, dayKey } from '../util/daily';
import { windowStart, type RateStore } from './rateStore';

/**
 * Shared state for serverless hosts, where instances don't share memory: rate limits, daily
 * budgets and the running-scan gate live in Upstash Redis (free tier, REST API).
 * Vercel's Upstash integration names the variables KV_REST_API_*; both forms are accepted.
 */
export function redisFromEnv(env: NodeJS.ProcessEnv = process.env): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
}

const PREFIX = 'td:';

/** Fixed-window counters in Redis, same semantics as MemoryRateStore. */
export class UpstashRateStore implements RateStore {
  constructor(private readonly redis: Redis) {}

  private key(key: string, windowMs: number, start: number) {
    return `${PREFIX}rl:${key}:${windowMs}:${start}`;
  }

  async get(key: string, windowMs: number) {
    const start = windowStart(Date.now(), windowMs);
    const v = await this.redis.get<string>(this.key(key, windowMs, start));
    return { count: Number(v ?? 0), resetAt: start + windowMs };
  }

  async incr(key: string, windowMs: number) {
    const start = windowStart(Date.now(), windowMs);
    const k = this.key(key, windowMs, start);
    const [count] = await this.redis.pipeline().incr(k).pexpire(k, windowMs + 60_000).exec<[number, number]>();
    return { count: Number(count), resetAt: start + windowMs };
  }
}

/** Caps scans running at once across all instances. */
export interface ScanGate {
  /** True when a slot was taken for `id`. */
  tryAcquire(id: string): Promise<boolean>;
  release(id: string): Promise<void>;
  running(): Promise<number>;
}

export class MemoryGate implements ScanGate {
  private readonly ids = new Set<string>();
  constructor(private readonly max: number) {}
  async tryAcquire(id: string) {
    if (this.ids.size >= this.max) return false;
    this.ids.add(id);
    return true;
  }
  async release(id: string) {
    this.ids.delete(id);
  }
  async running() {
    return this.ids.size;
  }
}

/**
 * Sorted set of running scan ids scored by start time. Entries older than `ttlMs` are pruned
 * first, so a function that was killed mid-scan can't hold a slot forever.
 */
export class UpstashGate implements ScanGate {
  private readonly key = `${PREFIX}running`;
  constructor(
    private readonly redis: Redis,
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  private async prune() {
    await this.redis.zremrangebyscore(this.key, 0, Date.now() - this.ttlMs);
  }

  async tryAcquire(id: string) {
    await this.prune();
    await this.redis.zadd(this.key, { score: Date.now(), member: id });
    // Rank by start time: only the first `max` entries may run.
    const rank = await this.redis.zrank(this.key, id);
    if (rank !== null && rank < this.max) return true;
    await this.redis.zrem(this.key, id);
    return false;
  }

  async release(id: string) {
    await this.redis.zrem(this.key, id);
  }

  async running() {
    await this.prune();
    return this.redis.zcard(this.key);
  }
}

/**
 * Daily budgets (AI calls, PSI calls) shared through Redis. Reads are synchronous against a
 * snapshot taken by `refresh()` at the start of each request; increments update the snapshot
 * and are written through, awaited by `flush()`.
 */
export class SharedDailyCounters extends DailyCounters {
  private pending: Promise<unknown>[] = [];

  constructor(
    private readonly redis: Redis,
    private readonly keys: string[],
  ) {
    super();
  }

  private rkey(key: string) {
    return `${PREFIX}daily:${dayKey()}:${key}`;
  }

  async refresh(): Promise<void> {
    this.roll();
    const values = await this.redis.mget<(string | null)[]>(...this.keys.map((k) => this.rkey(k)));
    this.keys.forEach((k, i) => this.counts.set(k, Number(values[i] ?? 0)));
  }

  override incr(key: string, by = 1): number {
    const n = super.incr(key, by);
    const k = this.rkey(key);
    this.pending.push(
      this.redis
        .pipeline()
        .incrby(k, by)
        .expire(k, 2 * 24 * 3600)
        .exec()
        .catch(() => undefined),
    );
    return n;
  }

  async flush(): Promise<void> {
    const p = this.pending;
    this.pending = [];
    await Promise.all(p);
  }
}

/** Every counter key the scanner uses, so refresh() can read them in one round-trip. */
export const DAILY_KEYS = ['ai', 'ai:gemini', 'ai:groq', 'ai:huggingface', 'ai:openrouter', 'psi'];
