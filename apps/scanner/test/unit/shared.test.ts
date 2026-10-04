import { describe, expect, it } from 'vitest';
import type { Redis } from '@upstash/redis';
import { SharedDailyCounters, UpstashGate, UpstashRateStore, redisFromEnv } from '../../src/limits/shared';
import { HOUR } from '../../src/limits/rateStore';

/** Minimal in-memory stand-in for the Upstash commands the scanner uses. */
function fakeRedis() {
  const kv = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const z = (k: string) => (zsets.get(k) ?? zsets.set(k, new Map()).get(k)!);
  const api = {
    kv,
    async get(k: string) {
      return kv.has(k) ? String(kv.get(k)) : null;
    },
    async mget(...keys: string[]) {
      return keys.map((k) => (kv.has(k) ? String(kv.get(k)) : null));
    },
    async zremrangebyscore(k: string, min: number, max: number) {
      for (const [m, s] of z(k)) if (s >= min && s <= max) z(k).delete(m);
      return 0;
    },
    async zadd(k: string, { score, member }: { score: number; member: string }) {
      z(k).set(member, score);
      return 1;
    },
    async zrank(k: string, member: string) {
      const sorted = [...z(k).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([m]) => m);
      const i = sorted.indexOf(member);
      return i < 0 ? null : i;
    },
    async zrem(k: string, member: string) {
      return z(k).delete(member) ? 1 : 0;
    },
    async zcard(k: string) {
      return z(k).size;
    },
    pipeline() {
      const ops: (() => number)[] = [];
      const p = {
        incr(k: string) {
          ops.push(() => {
            kv.set(k, (kv.get(k) ?? 0) + 1);
            return kv.get(k)!;
          });
          return p;
        },
        incrby(k: string, by: number) {
          ops.push(() => {
            kv.set(k, (kv.get(k) ?? 0) + by);
            return kv.get(k)!;
          });
          return p;
        },
        pexpire() {
          ops.push(() => 1);
          return p;
        },
        expire() {
          ops.push(() => 1);
          return p;
        },
        async exec() {
          return ops.map((o) => o());
        },
      };
      return p;
    },
  };
  return api as unknown as Redis & { kv: Map<string, number> };
}

describe('UpstashRateStore', () => {
  it('counts per fixed window', async () => {
    const store = new UpstashRateStore(fakeRedis());
    expect((await store.get('ip:1', HOUR)).count).toBe(0);
    await store.incr('ip:1', HOUR);
    const r = await store.incr('ip:1', HOUR);
    expect(r.count).toBe(2);
    expect(r.resetAt % HOUR).toBe(0);
    expect((await store.get('ip:1', HOUR)).count).toBe(2);
    expect((await store.get('ip:2', HOUR)).count).toBe(0);
  });
});

describe('UpstashGate', () => {
  it('admits up to max, releases, and prunes stale slots', async () => {
    const redis = fakeRedis();
    const gate = new UpstashGate(redis, 2, 50);
    expect(await gate.tryAcquire('a')).toBe(true);
    expect(await gate.tryAcquire('b')).toBe(true);
    expect(await gate.tryAcquire('c')).toBe(false);
    expect(await gate.running()).toBe(2);
    await gate.release('a');
    expect(await gate.tryAcquire('c')).toBe(true);
    // Slots from killed functions expire after ttl.
    await new Promise((r) => setTimeout(r, 70));
    expect(await gate.running()).toBe(0);
    expect(await gate.tryAcquire('d')).toBe(true);
  });
});

describe('SharedDailyCounters', () => {
  it('reads a snapshot, increments locally and writes through', async () => {
    const redis = fakeRedis();
    const a = new SharedDailyCounters(redis, ['ai', 'psi']);
    const b = new SharedDailyCounters(redis, ['ai', 'psi']);
    await a.refresh();
    a.incr('ai');
    a.incr('ai');
    await a.flush();
    await b.refresh();
    expect(b.get('ai')).toBe(2);
    expect(b.has('ai', 3)).toBe(true);
    expect(b.has('ai', 2)).toBe(false);
  });
});

describe('redisFromEnv', () => {
  it('accepts Upstash and Vercel KV variable names, or returns null', () => {
    expect(redisFromEnv({})).toBeNull();
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })).not.toBeNull();
    expect(redisFromEnv({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' })).not.toBeNull();
  });
});
