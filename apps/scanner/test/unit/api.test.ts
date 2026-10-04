import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Report } from '@teardown/core';
import { loadConfig } from '../../src/config';
import { createServices } from '../../src/services';
import { buildServer } from '../../src/server';
import type { Runner } from '../../src/scan/manager';
import { MemoryRateStore } from '../../src/limits/rateStore';
import { makeReportFromFixture } from './reportFixture';

const report: Report = makeReportFromFixture();

/** A runner that emits a couple of steps and returns a fixed report after `ms`. */
const fakeRunner =
  (ms = 30): Runner =>
  async (_req, _deps, hooks) => {
    hooks.emit({ type: 'step', data: { name: 'Load page', status: 'running' } });
    await new Promise((r) => setTimeout(r, ms));
    if (hooks.signal?.aborted) throw new (await import('../../src/scan/run')).CancelledError();
    hooks.emit({ type: 'step', data: { name: 'Load page', status: 'done', ms } });
    return structuredClone(report);
  };

const apps: FastifyInstance[] = [];
async function server(env: Record<string, string> = {}, runner: Runner = fakeRunner(), extra: Parameters<typeof buildServer>[1] = {}) {
  const cfg = loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: 'https://teardown.example', TRUST_PROXY_HOPS: '1', ...env });
  const services = createServices(cfg);
  // DNS for test hosts: a public address so the guard admits them without network access.
  vi.spyOn(services.guard, 'resolve').mockImplementation(async (h: string) => {
    if (/internal|localhost/.test(h)) throw new (await import('../../src/errors')).ScanError('BLOCKED_TARGET');
    return [{ address: '93.184.215.14', family: 4 }];
  });
  const { app, manager } = await buildServer(services, { runner, rateStore: new MemoryRateStore(), ...extra });
  apps.push(app);
  return { app, manager, services };
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  vi.restoreAllMocks();
});

const post = (app: FastifyInstance, body: unknown, ip = '203.0.113.9', headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/scan', payload: body as object, headers: { 'x-forwarded-for': ip, origin: 'https://teardown.example', ...headers } });

/** Reads an SSE stream over real HTTP until `done`. */
async function readEvents(app: FastifyInstance, id: string, lastEventId?: number): Promise<{ id: number; type: string; data: unknown }[]> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/api/scan/${id}/events`, headers: lastEventId ? { 'last-event-id': String(lastEventId) } : {} }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        const events = buf
          .split('\n\n')
          .filter((b) => b.includes('event:'))
          .map((b) => {
            const get = (k: string) => b.split('\n').find((l) => l.startsWith(k + ': '))?.slice(k.length + 2) ?? '';
            return { id: Number(get('id')), type: get('event'), data: JSON.parse(get('data')) };
          });
        resolve(events);
      });
    });
    req.on('error', reject);
  });
}

describe('API', () => {
  it('GET /health reports version and queue', async () => {
    const { app } = await server();
    const res = await app.inject('/health');
    expect(res.json()).toMatchObject({ ok: true, version: '1.0.0', queue: { running: 0, waiting: 0 } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('GET /api/quota reports allowances, AI availability and the perf engine', async () => {
    const { app } = await server();
    const q = (await app.inject({ url: '/api/quota', headers: { 'x-forwarded-for': '203.0.113.1' } })).json();
    expect(q.single).toMatchObject({ remainingHour: 5, remainingDay: 15 });
    expect(q.site.remainingDay).toBe(1);
    expect(q.aiAvailable).toBe(false);
    expect(q.perfEngine).toBe('lighthouse');
    expect(q.limits.siteMaxPages).toBe(15);
  });

  it('rejects invalid and blocked targets with plain messages', async () => {
    const { app } = await server();
    const bad = await post(app, { url: 'javascript:alert(1)' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_URL');
    const blocked = await post(app, { url: 'http://127.0.0.1/' });
    expect(blocked.json().error.code).toBe('BLOCKED_TARGET');
    const port = await post(app, { url: 'https://example.com:8080/' });
    expect(port.json().error.code).toBe('BLOCKED_TARGET');
    const name = await post(app, { url: 'https://internal.example/' });
    expect(name.json().error.code).toBe('BLOCKED_TARGET');
    expect(JSON.stringify(name.json())).not.toMatch(/at \w+ \(|node_modules/);
  });

  it('runs a scan and streams events, including the report, over SSE', async () => {
    const { app } = await server();
    const res = await post(app, { url: 'example.com', mode: 'single' });
    expect(res.statusCode).toBe(202);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
    const events = await readEvents(app, res.json().scanId);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('started');
    expect(types).toEqual(expect.arrayContaining(['step', 'report', 'done']));
    expect(types.at(-1)).toBe('done');
    expect((events.find((e) => e.type === 'report')!.data as { report: Report }).report.schema).toBe('teardown.report/v1');
  });

  it('replays only events after Last-Event-ID', async () => {
    const { app } = await server();
    const id = (await post(app, { url: 'example.com' })).json().scanId;
    const all = await readEvents(app, id);
    expect(all.length).toBeGreaterThan(3);
    const replay = await readEvents(app, id, 2);
    expect(replay[0]!.id).toBe(3);
    expect(replay.map((e) => e.id)).toEqual(all.filter((e) => e.id > 2).map((e) => e.id));
  });

  it('serves repeat scans from cache without spending limits, and fresh re-scans count', async () => {
    const runner = vi.fn(fakeRunner());
    const { app } = await server({}, runner as Runner);
    const first = await post(app, { url: 'example.com' });
    await readEvents(app, first.json().scanId);
    const second = await post(app, { url: 'https://example.com/' });
    expect(second.json().cached).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
    const q = (await app.inject({ url: '/api/quota', headers: { 'x-forwarded-for': '203.0.113.9' } })).json();
    expect(q.single.remainingHour).toBe(4);
    const fresh = await post(app, { url: 'example.com', fresh: true });
    expect(fresh.json().cached).toBe(false);
  });

  it('enforces per-IP hourly limits with a reset time', async () => {
    const { app } = await server({ SINGLE_PER_HOUR: '2', CACHE_TTL_MS: '0' });
    expect((await post(app, { url: 'a.example.com' })).statusCode).toBe(202);
    expect((await post(app, { url: 'b.example.com' })).statusCode).toBe(202);
    const third = await post(app, { url: 'c.example.com' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
    expect(Date.parse(third.json().error.resetAt)).toBeGreaterThan(Date.now());
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    // Another IP is unaffected.
    expect((await post(app, { url: 'c.example.com' }, '198.51.100.7')).statusCode).toBe(202);
  });

  it('limits full-site scans per IP and offers single-page instead', async () => {
    const { app } = await server({ CACHE_TTL_MS: '0' });
    expect((await post(app, { url: 'a.example.com', mode: 'site' })).statusCode).toBe(202);
    const second = await post(app, { url: 'b.example.com', mode: 'site' });
    expect(second.json().error).toMatchObject({ code: 'RATE_LIMITED', suggestMode: 'single' });
  });

  it('returns CAPACITY when the global site budget is used up', async () => {
    const { app } = await server({ GLOBAL_SITE_PER_DAY: '0' });
    const res = await post(app, { url: 'example.com', mode: 'site' });
    expect(res.json().error).toMatchObject({ code: 'CAPACITY', suggestMode: 'single' });
  });

  it('limits scans per target domain', async () => {
    const { app } = await server({ DOMAIN_PER_DAY: '1', CACHE_TTL_MS: '0' });
    expect((await post(app, { url: 'example.com/a' })).statusCode).toBe(202);
    const res = await post(app, { url: 'example.com/b' }, '198.51.100.8');
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(res.json().error.message).toMatch(/example\.com/);
  });

  it('returns QUEUE_FULL when the queue is full and reports positions', async () => {
    const { app, manager } = await server({ MAX_CONCURRENT_SCANS: '1', MAX_QUEUE: '1', CACHE_TTL_MS: '0', SINGLE_PER_HOUR: '50', SINGLE_PER_DAY: '50' }, fakeRunner(400));
    expect((await post(app, { url: 'a.example.com' })).statusCode).toBe(202);
    const queued = await post(app, { url: 'b.example.com' });
    expect(queued.statusCode).toBe(202);
    expect(manager.stats()).toEqual({ running: 1, waiting: 1 });
    const full = await post(app, { url: 'c.example.com' });
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe('QUEUE_FULL');
    const events = await readEvents(app, queued.json().scanId);
    expect(events.find((e) => e.type === 'queued')!.data).toEqual({ position: 1 });
  });

  it('cancels a scan', async () => {
    const { app, manager } = await server({}, fakeRunner(300));
    const id = (await post(app, { url: 'example.com' })).json().scanId;
    expect((await app.inject({ method: 'DELETE', url: `/api/scan/${id}` })).statusCode).toBe(204);
    const events = await readEvents(app, id);
    expect(events.map((e) => e.type)).not.toContain('report');
    expect(manager.isFinished(id)).toBe(true);
  });

  it('turns scan failures into plain error events', async () => {
    const { ScanError } = await import('../../src/errors');
    const { app } = await server({}, async () => {
      throw new ScanError('NOT_HTML');
    });
    const id = (await post(app, { url: 'example.com/file.pdf' })).json().scanId;
    const events = await readEvents(app, id);
    const err = events.find((e) => e.type === 'error')!.data as { code: string; message: string };
    expect(err.code).toBe('NOT_HTML');
    expect(err.message).toMatch(/didn't return a web page/);
  });

  it('404s unknown scans', async () => {
    const { app } = await server();
    const res = await app.inject('/api/scan/00000000-0000-0000-0000-000000000000/events');
    expect(res.statusCode).toBe(404);
  });

  it('applies CORS from ALLOWED_ORIGINS only', async () => {
    const { app } = await server();
    const ok = await app.inject({ method: 'OPTIONS', url: '/api/scan', headers: { origin: 'https://teardown.example', 'access-control-request-method': 'POST' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://teardown.example');
    const bad = await app.inject({ method: 'OPTIONS', url: '/api/scan', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requires a valid Turnstile token when TURNSTILE_SECRET is set', async () => {
    const turnstile = vi.fn(async (_s: string, token?: string) => token === 'good');
    const { app } = await server({ TURNSTILE_SECRET: 's' }, fakeRunner(), { turnstile });
    expect((await post(app, { url: 'example.com' })).json().error.code).toBe('TURNSTILE_FAILED');
    expect((await post(app, { url: 'example.com', turnstileToken: 'good' })).statusCode).toBe(202);
  });

  it('validates PDF export input and rate limits it', async () => {
    const pdf = vi.fn(async () => Buffer.from('%PDF-1.7 test'));
    const { app } = await server({ PDF_PER_HOUR: '1' }, fakeRunner(), { pdf });
    const bad = await app.inject({ method: 'POST', url: '/api/export/pdf', payload: { schema: 'nope' } });
    expect(bad.json().error.code).toBe('BAD_REQUEST');
    const limited = await app.inject({ method: 'POST', url: '/api/export/pdf', payload: report as unknown as object });
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });

  it('returns a PDF for a valid report', async () => {
    const pdf = vi.fn(async () => Buffer.from('%PDF-1.7 test'));
    const { app } = await server({}, fakeRunner(), { pdf });
    const res = await app.inject({ method: 'POST', url: '/api/export/pdf', payload: report as unknown as object });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="teardown-/);
  });

  it('refuses to start with ALLOW_PRIVATE_TARGETS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ALLOW_PRIVATE_TARGETS: 'true', ALLOWED_ORIGINS: 'https://a.example' })).toThrow(/forbidden/);
    expect(() => loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: '*' })).toThrow(/explicit origins/);
  });
});

