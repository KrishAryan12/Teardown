import type { ErrorCode } from '@teardown/core';

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

export function toScanError(err: unknown): ScanError {
  if (err instanceof ScanError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return new ScanError('TIMEOUT');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|EHOSTUNREACH|ENETUNREACH/i.test(msg))
    return new ScanError('UNREACHABLE');
  return new ScanError('SCAN_FAILED');
}
