import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Report } from '@teardown/core';
import { makeReportFromFixture } from './reportFixture';
import type * as RunModule from '../../src/scan/run';
import type * as GuardModule from '../../src/security/guard';
import type * as ServerlessModule from '../../src/serverless';

const report: Report = makeReportFromFixture();
let runDelay = 20;
let runError: Error | null = null;

// The serverless handlers run real admission and streaming; only the scan itself is faked.
vi.mock('../../src/scan/run', async (orig) => {
  const actual = await orig<typeof RunModule>();
  return {
    ...actual,
    runScan: vi.fn(async (_req: unknown, _deps: unknown, hooks: { emit: (e: unknown) => void; signal?: AbortSignal }) => {
      hooks.emit({ type: 'step', data: { name: 'Load page', status: 'running' } });
      await new Promise((r) => setTimeout(r, runDelay));
      if (hooks.signal?.aborted) throw new actual.CancelledError();
      if (runError) throw runError;
      hooks.emit({ type: 'step', data: { name: 'Load page', status: 'done', ms: runDelay } });
      return structuredClone(report);
    }),
  };
});

vi.mock('../../src/security/guard', async (orig) => {
  const actual = await orig<typeof GuardModule>();
  class TestGuard extends actual.SsrfGuard {
    override async resolve(host: string) {
      if (/internal/.test(host)) throw new (await import('../../src/errors')).ScanError('BLOCKED_TARGET');
      return [{ address: '93.184.215.14', family: 4 }];
    }
  }
  return { ...actual, SsrfGuard: TestGuard };
});

const ENV_KEYS = ['SINGLE_PER_HOUR', 'MAX_CONCURRENT_SCANS', 'CACHE_TTL_MS', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'VERCEL'];
let mod: typeof ServerlessModule;

async function fresh(env: Record<string, string> = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { NODE_ENV: 'test', ...env });
  vi.resetModules();
  mod = await import('../../src/serverless');
}

const post = (body: unknown, ip = '203.0.113.5') =>
  new Request('http://localhost/api/scan', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } });

async function events(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [ev, data] = b.split('\n');
      return { type: ev!.slice(7), data: JSON.parse(data!.slice(6)) };
    });
}

beforeEach(() => {
  runDelay = 20;
  runError = null;
});
afterEach(async () => {
  await mod?.resetForTests();
});

describe('serverless handlers', () => {
  it('health and quota', async () => {
    await fresh();
    const h = await (await mod.healthHandler()).json();
    expect(h).toMatchObject({ ok: true, queue: { running: 0, waiting: 0 } });
    const q = await (await mod.quotaHandler(new Request('http://localhost/api/quota'))).json();
    expect(q.single.remainingHour).toBe(5);
    expect(q.aiAvailable).toBe(false);
  });

  it('streams a scan in one request: started, steps, report, done', async () => {
    await fresh();
    const res = await mod.scanHandler(post({ url: 'example.com' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('x-ratelimit-remaining')).toBe('4');
    const ev = await events(res);
    expect(ev.map((e) => e.type)).toEqual(['started', 'step', 'step', 'report', 'done']);
    expect(ev[3]!.data.report.schema).toBe('teardown.report/v1');
  });

  it('serves repeats from the instance cache without spending limits', async () => {
    await fresh();
    await events(await mod.scanHandler(post({ url: 'example.com' })));
    const ev = await events(await mod.scanHandler(post({ url: 'https://example.com/' })));
    expect(ev[0]).toMatchObject({ type: 'started', data: { cached: true } });
    const q = await (await mod.quotaHandler(new Request('http://localhost/api/quota', { headers: { 'x-forwarded-for': '203.0.113.5' } }))).json();
    expect(q.single.remainingHour).toBe(4);
  });

  it('returns JSON errors before streaming: invalid, blocked, rate limited', async () => {
    await fresh({ SINGLE_PER_HOUR: '1', CACHE_TTL_MS: '0' });
    expect((await (await mod.scanHandler(post({ url: 'javascript:alert(1)' }))).json()).error.code).toBe('INVALID_URL');
    expect((await (await mod.scanHandler(post({ url: 'http://127.0.0.1/' }))).json()).error.code).toBe('BLOCKED_TARGET');
    expect((await (await mod.scanHandler(post({ url: 'https://internal.example/' }))).json()).error.code).toBe('BLOCKED_TARGET');
    await events(await mod.scanHandler(post({ url: 'a.example.com' })));
    const limited = await mod.scanHandler(post({ url: 'b.example.com' }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('turns scan failures into an error event', async () => {
    await fresh();
    runError = new (await import('../../src/errors')).ScanError('NOT_HTML');
    const ev = await events(await mod.scanHandler(post({ url: 'example.com/file.pdf' })));
    expect(ev.find((e) => e.type === 'error')!.data.code).toBe('NOT_HTML');
    expect(ev.at(-1)!.type).toBe('done');
  });

  it('caps concurrent scans and reports queue position while waiting', async () => {
    await fresh({ MAX_CONCURRENT_SCANS: '1', CACHE_TTL_MS: '0' });
    runDelay = 2500;
    const first = mod.scanHandler(post({ url: 'a.example.com' }, '198.51.100.1'));
    await new Promise((r) => setTimeout(r, 50));
    const second = mod.scanHandler(post({ url: 'b.example.com' }, '198.51.100.2'));
    const ev2 = await events(await second);
    expect(ev2[0]).toMatchObject({ type: 'queued', data: { position: 1 } });
    expect(ev2.map((e) => e.type)).toContain('report');
    await events(await first);
  }, 15_000);

  it('applies serverless defaults on Vercel', async () => {
    await fresh({ VERCEL: '1' });
    const { loadConfig } = await import('../../src/config');
    const cfg = loadConfig();
    expect(cfg.REPORT_MAX_BYTES).toBe(4_000_000);
    expect(cfg.SITE_MAX_PAGES).toBe(5);
    expect(cfg.SCAN_DEADLINE_MS).toBe(270_000);
    const explicit = loadConfig({ ...process.env, SITE_MAX_PAGES: '3' });
    expect(explicit.SITE_MAX_PAGES).toBe(3);
  });
});
