import type { ApiError, ErrorCode, Health, Quota, Report, ScanEvent, ScanMode } from '@teardown/core';

/** Empty = same origin (the Vercel project serves the scanner under /api). Set it to use a separate Docker scanner. */
export const SCANNER_URL = (process.env.NEXT_PUBLIC_SCANNER_URL || '').replace(/\/+$/, '');

export class ApiFailure extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly resetAt?: string,
    public readonly suggestMode?: ScanMode,
  ) {
    super(message);
  }
}

const NETWORK_MESSAGE = "Teardown couldn't reach its scanner. It may be starting up or offline; wait a minute and try again.";

async function call<T>(path: string, init?: RequestInit): Promise<{ data: T; res: Response }> {
  let res: Response;
  try {
    res = await fetch(`${SCANNER_URL}${path}`, init);
  } catch {
    throw new ApiFailure('NETWORK', NETWORK_MESSAGE);
  }
  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* not JSON */
    }
    if (body?.error) throw new ApiFailure(body.error.code, body.error.message, body.error.resetAt, body.error.suggestMode);
    throw new ApiFailure('SCAN_FAILED', `The scanner answered with HTTP ${res.status}. Try again in a minute.`);
  }
  return { data: res.status === 204 ? (undefined as T) : ((await res.json()) as T), res };
}

/** Warm-up ping. Resolves with health, or rejects after `timeoutMs`. */
export async function health(timeoutMs = 60_000): Promise<Health> {
  return (await call<Health>('/api/health', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })).data;
}

export async function quota(): Promise<Quota> {
  return (await call<Quota>('/api/quota', { cache: 'no-store' })).data;
}

/**
 * Starts a scan and streams its events from the same response (`event:` / `data:` frames).
 * Errors before the scan starts (invalid URL, rate limit) come back as JSON and throw ApiFailure.
 * Aborting `signal` cancels the scan on the server.
 */
export async function streamScan(url: string, mode: ScanMode, fresh: boolean, signal: AbortSignal, onEvent: (e: ScanEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${SCANNER_URL}/api/scan/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, mode, ...(fresh ? { fresh: true } : {}) }),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    throw new ApiFailure('NETWORK', NETWORK_MESSAGE);
  }
  if (!res.ok || !res.body || !/event-stream/.test(res.headers.get('content-type') ?? '')) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    if (body?.error) throw new ApiFailure(body.error.code, body.error.message, body.error.resetAt, body.error.suggestMode);
    throw new ApiFailure('SCAN_FAILED', `The scanner answered with HTTP ${res.status}. Try again in a minute.`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch {
      if (signal.aborted) return;
      throw new ApiFailure('NETWORK', 'The connection to the scanner dropped before the report arrived. Start the scan again.');
    }
    if (chunk.done) break;
    buf += chunk.value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let type = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (type && data) onEvent({ type, data: JSON.parse(data) } as ScanEvent);
    }
  }
}

async function toDataUrl(src: string): Promise<string | undefined> {
  if (src.startsWith('data:')) return src;
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(undefined);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** The PDF is rendered by the scanner. Screenshot URLs (sample report) are inlined first. */
export async function exportPdf(report: Report): Promise<Blob> {
  const copy: Report = structuredClone(report);
  for (const p of copy.pages) {
    for (const k of ['desktop', 'mobile'] as const) {
      const s = p.screenshots[k];
      if (s && !s.startsWith('data:')) {
        const d = await toDataUrl(s);
        if (d && /^data:image\/(jpeg|png|webp);base64,/.test(d)) p.screenshots[k] = d;
        else delete p.screenshots[k];
      }
    }
  }
  let res: Response;
  try {
    res = await fetch(`${SCANNER_URL}/api/export/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(copy) });
  } catch {
    throw new ApiFailure('NETWORK', NETWORK_MESSAGE);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiFailure(body?.error.code ?? 'SCAN_FAILED', body?.error.message ?? 'The PDF could not be created. Try again in a minute.', body?.error.resetAt);
  }
  return res.blob();
}

/** Starts a browser download of a Blob. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatReset(iso?: string): string {
  if (!iso) return 'later';
  const d = new Date(iso);
  const mins = Math.max(1, Math.round((d.getTime() - Date.now()) / 60_000));
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return mins < 90 ? `in ${mins} minute${mins === 1 ? '' : 's'} (${time})` : `at ${time}${d.toDateString() !== new Date().toDateString() ? ' tomorrow' : ''}`;
}
