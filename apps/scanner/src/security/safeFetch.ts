import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';
import { ScanError } from '../errors';
import type { SsrfGuard } from './guard';
import { HostLimiter } from '../util/limiter';

export interface SafeFetchOptions {
  guard: SsrfGuard;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Abort if the final content-type doesn't match (checked before reading the body). */
  requireHtml?: boolean;
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  redirects: { url: string; status: number }[];
  /** Bytes on the wire (before decompression). */
  transferBytes: number;
}

/** Never more than 2 simultaneous requests from the scanner's own fetches to one host. */
export const hostLimiter = new HostLimiter(2);

/**
 * Fetches a URL with SSRF protection: every hop's URL shape, port and DNS answers are validated,
 * and the socket connects only to validated addresses (via `guard.lookup`).
 */
export async function safeFetch(input: string | URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const redirects: { url: string; status: number }[] = [];
  let current = new URL(input);
  for (let hop = 0; ; hop++) {
    await opts.guard.assertUrl(current);
    const res = await hostLimiter.run(current.hostname, () => requestOnce(current, opts));
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= maxRedirects) throw new ScanError('UNREACHABLE', 'The site redirected too many times (more than 5).');
      redirects.push({ url: current.toString(), status: res.status });
      let next: URL;
      try {
        next = new URL(res.headers.location, current);
      } catch {
        throw new ScanError('UNREACHABLE', 'The site sent an invalid redirect.');
      }
      next.hash = '';
      current = next;
      continue;
    }
    return { ...res, redirects };
  }
}

function requestOnce(url: URL, opts: SafeFetchOptions): Promise<Omit<SafeFetchResult, 'redirects'>> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(e instanceof ScanError ? e : classify(e));
    };
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        lookup: opts.guard.lookup as never,
        headers: {
          'accept-encoding': 'gzip, deflate, br',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...opts.headers,
        },
        // Redirects are followed manually so each hop is validated.
        agent: false,
        signal: opts.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const isRedirect = status >= 300 && status < 400 && !!res.headers.location;
        if (opts.requireHtml && !isRedirect && status < 400) {
          const ct = String(res.headers['content-type'] ?? '');
          if (ct && !/text\/html|application\/xhtml\+xml/i.test(ct)) {
            res.destroy();
            return fail(new ScanError('NOT_HTML'));
          }
        }
        if (opts.method === 'HEAD' || isRedirect) {
          res.resume();
          settled = true;
          clearTimeout(timer);
          return resolve({ url: url.toString(), status, headers: res.headers, body: Buffer.alloc(0), truncated: false, transferBytes: 0 });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes * 4) {
          res.destroy();
          return fail(new ScanError('SCAN_FAILED', 'The page is larger than 5 MB, which is over the scan limit.'));
        }
        let transferBytes = 0;
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        res.on('data', (c: Buffer) => (transferBytes += c.length));
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        stream.on('data', (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            res.destroy();
            done();
            return;
          }
          chunks.push(c);
        });
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ url: url.toString(), status, headers: res.headers, body: Buffer.concat(chunks), truncated, transferBytes });
        };
        stream.on('end', done);
        stream.on('error', (e) => (truncated ? done() : fail(e)));
        res.on('error', (e) => (truncated ? done() : fail(e)));
      },
    );
    const timer = setTimeout(() => fail(new ScanError('TIMEOUT')), timeoutMs);
    req.on('error', fail);
    req.end();
  });
}

function classify(e: unknown): ScanError {
  const err = e as NodeJS.ErrnoException;
  if (err?.code === 'EBLOCKED') return new ScanError('BLOCKED_TARGET');
  if (err?.name === 'AbortError') return new ScanError('TIMEOUT');
  if (err?.code === 'ETIMEDOUT') return new ScanError('TIMEOUT');
  return new ScanError('UNREACHABLE');
}
