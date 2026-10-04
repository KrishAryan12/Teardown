import type { ApiError, ErrorCode } from '@teardown/core';

/** Plain-language messages: what happened and what to do. Never stack traces. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: "That doesn't look like a web address. Enter a full URL such as https://example.com.",
  BLOCKED_TARGET:
    'Teardown only scans public websites on ports 80 and 443. Private, local and reserved addresses are refused.',
  RATE_LIMITED: "You've reached the scan limit for now. Try again after the reset time shown.",
  CAPACITY: "Today's capacity for this scan type is used up. Try a single-page scan, or come back tomorrow.",
  QUEUE_FULL: 'The scanner queue is full right now. Wait a minute and try again.',
  UNREACHABLE: "Teardown couldn't connect to that site. Check the address and that the site is online.",
  TIMEOUT: 'The site took too long to respond. Try again, or scan a lighter page.',
  NOT_HTML: "That address didn't return a web page (HTML). Scan a page URL rather than a file or API.",
  SCAN_FAILED: 'The scan failed part-way through. Try again; if it keeps failing, scan a different page of the site.',
  TURNSTILE_FAILED: 'The bot check failed. Reload the page and try again.',
  NOT_FOUND: 'That scan has expired or never existed. Start a new scan.',
  BAD_REQUEST: "The request wasn't in the expected format.",
};

export class ScanError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly extra: { resetAt?: string; suggestMode?: 'single' | 'site' } = {},
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'ScanError';
  }
}

/** Structural check: bundles can end up with two copies of this module, which breaks instanceof. */
export function isScanError(err: unknown): err is ScanError {
  return err instanceof ScanError || (err instanceof Error && err.name === 'ScanError' && typeof (err as ScanError).code === 'string');
}

export function toScanError(err: unknown): ScanError {
  if (isScanError(err)) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return new ScanError('TIMEOUT');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|EHOSTUNREACH|ENETUNREACH/i.test(msg))
    return new ScanError('UNREACHABLE');
  return new ScanError('SCAN_FAILED');
}

/** HTTP status for each error code (shared by the Fastify server and the serverless handlers). */
export const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_URL: 400,
  BAD_REQUEST: 400,
  BLOCKED_TARGET: 422,
  NOT_HTML: 422,
  UNREACHABLE: 422,
  TIMEOUT: 504,
  TURNSTILE_FAILED: 403,
  RATE_LIMITED: 429,
  CAPACITY: 429,
  QUEUE_FULL: 503,
  NOT_FOUND: 404,
  SCAN_FAILED: 500,
};

export function errorBody(err: ScanError): ApiError {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.extra.resetAt ? { resetAt: err.extra.resetAt } : {}),
      ...(err.extra.suggestMode ? { suggestMode: err.extra.suggestMode } : {}),
    },
  };
}

/** Seconds until resetAt, for Retry-After. */
export function retryAfter(err: ScanError): number | undefined {
  return err.extra.resetAt ? Math.max(1, Math.ceil((Date.parse(err.extra.resetAt) - Date.now()) / 1000)) : undefined;
}
