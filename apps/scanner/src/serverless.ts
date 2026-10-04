/**
 * Serverless entry (Vercel Functions via Next.js route handlers, or any Web-standard runtime).
 *
 * The long-lived Fastify server keeps scans in a queue and streams them over a separate SSE
 * connection. Serverless functions can't hold state between calls, so here one request does it
 * all: validate, admit, run the scan and stream its events back in the response body (the same
 * `event:`/`data:` framing as SSE). Limits, daily budgets and the running-scan gate live in
 * Upstash Redis when configured, in memory otherwise (local development).
 */
import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { RULESET_VERSION, ReportSchema, ScanRequestSchema, type Report, type ScanEvent } from '@teardown/core';
import { VERSION, loadConfig, type Config } from './config';
import { HTTP_STATUS, ScanError, errorBody, retryAfter, toScanError } from './errors';
import { normalizeUrl } from './security/guard';
import { LimitPolicy } from './limits/policy';
import { MemoryRateStore } from './limits/rateStore';
import { verifyTurnstile } from './limits/turnstile';
import { DAILY_KEYS, MemoryGate, SharedDailyCounters, UpstashGate, UpstashRateStore, redisFromEnv, type ScanGate } from './limits/shared';
import { createServices, type Services } from './services';
import { CancelledError, runScan } from './scan/run';
import { renderPdf } from './pdf/render';
import { DailyCounters } from './util/daily';
import { log } from './util/log';

interface State {
  cfg: Config;
  services: Services;
  policy: LimitPolicy;
  gate: ScanGate;
  counters: DailyCounters;
  cache: LRUCache<string, { report: Report; at: number }>;
}

let state: State | null = null;

/** Lazily built once per instance; warm instances reuse the browser and caches. */
function init(): State {
  if (state) return state;
  const cfg = loadConfig();
  const redis = redisFromEnv();
  const counters = redis ? new SharedDailyCounters(redis, DAILY_KEYS) : new DailyCounters();
  const services = createServices(cfg, { counters });
  state = {
    cfg,
    services,
    counters,
    policy: new LimitPolicy(cfg, redis ? new UpstashRateStore(redis) : new MemoryRateStore()),
    gate: redis ? new UpstashGate(redis, cfg.MAX_CONCURRENT_SCANS, cfg.SCAN_DEADLINE_MS + 30_000) : new MemoryGate(cfg.MAX_CONCURRENT_SCANS),
    // Per instance only: reports with screenshots are too big for the free Redis request limit.
    cache: new LRUCache({
      max: Math.max(1, cfg.CACHE_MAX_ENTRIES),
      maxSize: Math.max(1, Math.min(cfg.CACHE_MAX_BYTES, 64 * 1024 * 1024)),
      sizeCalculation: (v) => Math.max(1, Buffer.byteLength(JSON.stringify(v.report))),
      ttl: Math.max(1, cfg.CACHE_TTL_MS),
    }),
  };
  if (!redis && cfg.NODE_ENV === 'production') log.warn({ event: 'no_shared_store', note: 'Upstash not configured: limits are per instance' });
  return state;
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers } });
}

function errorResponse(e: unknown): Response {
  const err = toScanError(e);
  const ra = retryAfter(err);
  return json(errorBody(err), HTTP_STATUS[err.code] ?? 400, ra ? { 'retry-after': String(ra) } : {});
}

/** Client IP. Vercel overwrites X-Forwarded-For with the real client address, so its first entry is trustworthy there. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

async function refreshCounters(s: State) {
  if (s.counters instanceof SharedDailyCounters) await s.counters.refresh().catch(() => undefined);
}

async function flushCounters(s: State) {
  if (s.counters instanceof SharedDailyCounters) await s.counters.flush().catch(() => undefined);
}

export async function healthHandler(): Promise<Response> {
  try {
    const s = init();
    return json({ ok: true, version: VERSION, queue: { running: await s.gate.running(), waiting: 0 } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function quotaHandler(req: Request): Promise<Response> {
  try {
    const s = init();
    await refreshCounters(s);
    return json(await s.policy.quota(clientIp(req), s.services.ai.available(), s.services.perf.active()));
  } catch (e) {
    return errorResponse(e);
  }
}

const encoder = new TextEncoder();
function frameText(e: ScanEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
function frame(e: ScanEvent): Uint8Array {
  return encoder.encode(frameText(e));
}

/**
 * POST /api/scan → validates and admits, then streams `event:`/`data:` frames until `done`.
 * Errors before the stream starts are plain JSON with an HTTP status, like the Fastify API.
 */
export async function scanHandler(req: Request): Promise<Response> {
  let s: State;
  let input: { url: string; mode: 'single' | 'site'; fresh?: boolean; turnstileToken?: string };
  let target: URL;
  try {
    s = init();
    const body = await req.json().catch(() => {
      throw new ScanError('BAD_REQUEST');
    });
    const parsed = ScanRequestSchema.safeParse(body);
    if (!parsed.success) throw new ScanError('INVALID_URL');
    input = parsed.data;
    target = normalizeUrl(input.url);
    s.services.guard.assertUrlShape(target);
    await s.services.guard.resolve(target.hostname);
    if (s.cfg.TURNSTILE_SECRET && !(await verifyTurnstile(s.cfg.TURNSTILE_SECRET, input.turnstileToken, clientIp(req)))) throw new ScanError('TURNSTILE_FAILED');
  } catch (e) {
    return errorResponse(e);
  }

  const key = `${target.href}|${input.mode}|${RULESET_VERSION}`;
  const hit = input.fresh || s.cfg.CACHE_TTL_MS <= 0 ? undefined : s.cache.get(key);
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
    ...SECURITY_HEADERS,
  };

  if (hit) {
    const cachedAt = new Date(hit.at).toISOString();
    const body = [
      frameText({ type: 'started', data: { mode: input.mode, cached: true, cachedAt } }),
      frameText({ type: 'report', data: { report: hit.report, cached: true, cachedAt } }),
      frameText({ type: 'done', data: {} }),
    ].join('');
    log.info({ event: 'scan', host: target.hostname, mode: input.mode, outcome: 'cache_hit', ms: 0 });
    return new Response(body, { headers });
  }

  try {
    const rl = await s.policy.admit(clientIp(req), target.hostname, input.mode);
    headers['x-ratelimit-limit'] = String(rl.limit);
    headers['x-ratelimit-remaining'] = String(rl.remaining);
    headers['x-ratelimit-reset'] = String(Math.ceil(rl.resetAt / 1000));
  } catch (e) {
    return errorResponse(e);
  }

  const id = randomUUID();
  const abort = new AbortController();
  req.signal?.addEventListener('abort', () => abort.abort());
  const t0 = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: ScanEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(e));
        } catch {
          closed = true;
        }
      };
      // Comments keep proxies from closing an idle stream during long steps.
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(': heartbeat\n\n')), 15_000);
      const deadline = setTimeout(() => abort.abort(new ScanError('TIMEOUT', 'The scan ran out of time (the host allows about 5 minutes). Try a single page, or a lighter page.')), s.cfg.SCAN_DEADLINE_MS);
      let acquired = false;
      try {
        // Wait up to ~60 s for a free slot, reporting the position.
        for (let waited = 0; ; waited += 2000) {
          if (await s.gate.tryAcquire(id)) {
            acquired = true;
            break;
          }
          if (waited >= 60_000 || abort.signal.aborted) throw new ScanError('QUEUE_FULL');
          const running = await s.gate.running();
          send({ type: 'queued', data: { position: Math.max(1, running - s.cfg.MAX_CONCURRENT_SCANS + 1) } });
          await new Promise((r) => setTimeout(r, 2000));
        }
        await refreshCounters(s);
        send({ type: 'started', data: { mode: input.mode } });
        const report = await runScan({ url: target.href, mode: input.mode }, s.services, { emit: send, signal: abort.signal });
        if (s.cfg.CACHE_TTL_MS > 0) s.cache.set(key, { report, at: Date.now() });
        send({ type: 'report', data: { report, cached: false } });
        log.info({ event: 'scan', host: target.hostname, mode: input.mode, outcome: 'ok', ms: Date.now() - t0, ai: report.ai.status, perf: report.scores.performance.source });
      } catch (caught) {
        const reason = abort.signal.reason;
        // A deadline abort surfaces as CancelledError; report it as the timeout it is.
        const e = caught instanceof CancelledError && reason instanceof ScanError ? reason : caught;
        if (e instanceof CancelledError || (req.signal?.aborted && !(reason instanceof ScanError))) {
          log.info({ event: 'scan', host: target.hostname, mode: input.mode, outcome: 'cancelled', ms: Date.now() - t0 });
        } else {
          const err = toScanError(e);
          send({ type: 'error', data: { code: err.code, message: err.message } });
          log.info({ event: 'scan', host: target.hostname, mode: input.mode, outcome: 'error', code: err.code, ms: Date.now() - t0 });
        }
      } finally {
        clearInterval(heartbeat);
        clearTimeout(deadline);
        if (acquired) await s.gate.release(id).catch(() => undefined);
        await flushCounters(s);
        send({ type: 'done', data: {} });
        closed = true;
        try {
          controller.close();
        } catch {
          /* client already gone */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers });
}

/** POST /api/export/pdf → validated report in, A4 PDF out. */
export async function pdfHandler(req: Request): Promise<Response> {
  try {
    const s = init();
    const length = Number(req.headers.get('content-length') ?? 0);
    if (length > s.cfg.REPORT_MAX_BYTES) throw new ScanError('BAD_REQUEST', 'That report is too large to turn into a PDF.');
    await s.policy.admitPdf(clientIp(req));
    const text = await req.text();
    if (Buffer.byteLength(text) > s.cfg.REPORT_MAX_BYTES) throw new ScanError('BAD_REQUEST', 'That report is too large to turn into a PDF.');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ScanError('BAD_REQUEST', "That report isn't valid JSON.");
    }
    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) throw new ScanError('BAD_REQUEST', "That report isn't in the expected format, so it can't be turned into a PDF.");
    const pdf = await renderPdf(parsed.data, s.services.pool);
    const name = `teardown-${parsed.data.target.host.replace(/[^a-z0-9.-]/gi, '')}-${parsed.data.generatedAt.slice(0, 10)}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"`, ...SECURITY_HEADERS },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Test hook: drop the cached state (config, browser) so the next call re-initialises. */
export async function resetForTests(): Promise<void> {
  await state?.services.close();
  state = null;
}
