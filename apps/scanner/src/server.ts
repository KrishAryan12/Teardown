import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { ReportSchema, ScanRequestSchema } from '@teardown/core';
import { VERSION, type Config } from './config';
import { HTTP_STATUS, ScanError, errorBody, retryAfter } from './errors';
import { normalizeUrl } from './security/guard';
import { LimitPolicy } from './limits/policy';
import { MemoryRateStore, type RateStore } from './limits/rateStore';
import { verifyTurnstile } from './limits/turnstile';
import { ScanManager, type Runner } from './scan/manager';
import type { Services } from './services';
import { renderPdf } from './pdf/render';
import { log } from './util/log';

export interface ServerOptions {
  rateStore?: RateStore;
  runner?: Runner;
  /** Injectable for tests. */
  turnstile?: typeof verifyTurnstile;
  pdf?: typeof renderPdf;
}

interface ReplyLike {
  code(n: number): ReplyLike;
  header(k: string, v: unknown): ReplyLike;
  send(body: unknown): unknown;
}

function sendError(reply: ReplyLike | FastifyReply, err: ScanError) {
  const r = reply as ReplyLike;
  const ra = retryAfter(err);
  if (ra) r.header('retry-after', ra);
  return r.code(HTTP_STATUS[err.code] ?? 400).send(errorBody(err));
}

export async function buildServer(services: Services, opts: ServerOptions = {}): Promise<{ app: FastifyInstance; manager: ScanManager }> {
  const cfg: Config = services.cfg;
  const app = Fastify({
    logger: false,
    // Trust exactly TRUST_PROXY_HOPS reverse proxies (HF Spaces: 1) when reading X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < cfg.TRUST_PROXY_HOPS,
    bodyLimit: 16 * 1024,
  });
  const manager = new ScanManager(cfg, services, opts.runner);
  const policy = new LimitPolicy(cfg, opts.rateStore ?? new MemoryRateStore());
  const turnstile = opts.turnstile ?? verifyTurnstile;
  const pdf = opts.pdf ?? renderPdf;

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (curl, health checks) send no Origin; CORS doesn't apply to them.
      if (!origin) return cb(null, true);
      cb(null, cfg.ALLOWED_ORIGINS.includes('*') || cfg.ALLOWED_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['content-type', 'last-event-id'],
    exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'],
    maxAge: 600,
  });

  const securityHeaders: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(securityHeaders)) if (!reply.hasHeader(k)) reply.header(k, v);
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ScanError) return sendError(reply, err);
    const e = err as { statusCode?: number; code?: string };
    if (e.statusCode === 413 || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, new ScanError('BAD_REQUEST', 'The request body is too large.'));
    if (e.statusCode && e.statusCode < 500) return sendError(reply, new ScanError('BAD_REQUEST'));
    log.error({ event: 'unhandled', error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
    return sendError(reply, new ScanError('SCAN_FAILED', 'Something went wrong on the scanner. Try again in a moment.'));
  });
  app.setNotFoundHandler((_req, reply) => sendError(reply, new ScanError('NOT_FOUND', 'Not found.')));

  const ip = (req: FastifyRequest) => req.ip || 'unknown';

  app.get('/', async () => ({ name: 'Teardown scanner', version: VERSION, docs: 'GET /health, GET /api/quota, POST /api/scan' }));

  const health = async () => ({ ok: true, version: VERSION, queue: manager.stats() });
  app.get('/health', health);
  app.get('/api/health', health);

  app.get('/api/quota', async (req) => policy.quota(ip(req), services.ai.available(), services.perf.active()));

  /** Validation, cache and admission shared by POST /api/scan and POST /api/scan/stream. */
  const admit = async (req: FastifyRequest, reply: FastifyReply): Promise<{ scanId: string; cached: boolean }> => {
    const parsed = ScanRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new ScanError('INVALID_URL');
    const { url, mode, turnstileToken, fresh } = parsed.data;
    const target = normalizeUrl(url);
    // Cheap shape checks before spending anything; DNS validation happens again inside the scan.
    services.guard.assertUrlShape(target);
    await services.guard.resolve(target.hostname);

    if (cfg.TURNSTILE_SECRET && !(await turnstile(cfg.TURNSTILE_SECRET, turnstileToken, ip(req)))) throw new ScanError('TURNSTILE_FAILED');

    const key = ScanManager.cacheKey(target.href, mode);
    const hit = fresh ? undefined : manager.cached(key);
    if (hit) return { scanId: manager.fromCache(url, target.hostname, mode, key, hit), cached: true };

    if (manager.queueFull() || !manager.isAccepting()) throw new ScanError('QUEUE_FULL');
    const rl = await policy.admit(ip(req), target.hostname, mode);
    reply.header('x-ratelimit-limit', rl.limit).header('x-ratelimit-remaining', rl.remaining).header('x-ratelimit-reset', Math.ceil(rl.resetAt / 1000));
    return { scanId: manager.enqueue(target.href, target.hostname, mode, key), cached: false };
  };

  app.post('/api/scan', async (req, reply) => reply.code(202).send(await admit(req, reply)));

  /**
   * One-request variant (same protocol as the serverless API): admits the scan, then streams its
   * events in the response body until `done`. Closing the request cancels the scan.
   */
  app.post('/api/scan/stream', async (req, reply) => {
    const { scanId } = await admit(req, reply);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      ...securityHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    let finished = false;
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const unsubscribe = manager.subscribe(scanId, 0, (e) => {
      res.write(`event: ${e.event.type}\ndata: ${JSON.stringify(e.event.data)}\n\n`);
      if (e.event.type === 'done') {
        finished = true;
        clearInterval(heartbeat);
        setImmediate(() => res.end());
      }
    });
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!finished) manager.cancel(scanId);
    });
  });

  app.delete<{ Params: { id: string } }>('/api/scan/:id', async (req, reply) => {
    if (!manager.exists(req.params.id)) throw new ScanError('NOT_FOUND');
    manager.cancel(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/scan/:id/events', (req, reply) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(id) || !manager.exists(id)) return sendError(reply, new ScanError('NOT_FOUND'));
    const lastId = Number(req.headers['last-event-id'] ?? (req.query as { lastEventId?: string }).lastEventId ?? 0) || 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      ...securityHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      res.end();
    };
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const unsubscribe = manager.subscribe(id, lastId, (e) => {
      if (closed) return;
      res.write(`id: ${e.id}\nevent: ${e.event.type}\ndata: ${JSON.stringify(e.event.data)}\n\n`);
      if (e.event.type === 'done') setImmediate(close);
    });
    req.raw.on('close', close);
  });

  app.post('/api/export/pdf', { bodyLimit: cfg.REPORT_MAX_BYTES }, async (req, reply) => {
    await policy.admitPdf(ip(req));
    const parsed = ReportSchema.safeParse(req.body);
    if (!parsed.success) throw new ScanError('BAD_REQUEST', "That report isn't in the expected format, so it can't be turned into a PDF.");
    const buf = await pdf(parsed.data, services.pool);
    const name = `teardown-${parsed.data.target.host.replace(/[^a-z0-9.-]/gi, '')}-${parsed.data.generatedAt.slice(0, 10)}.pdf`;
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${name}"`).send(buf);
  });

  return { app, manager };
}

