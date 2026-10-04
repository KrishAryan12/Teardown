import { parseHTML } from 'linkedom';
import { ScanError } from '../errors';
import { safeFetch } from '../security/safeFetch';
import type { SsrfGuard } from '../security/guard';
import { userAgent, type Config } from '../config';
import { inpageSource } from './inpage';
import type { PageCapture, PageFacts } from './types';

/**
 * Reduced-accuracy capture used when Chromium can't launch or keeps crashing: the HTML is
 * fetched through the SSRF guard and the same collector runs against a linkedom DOM with
 * layout disabled. No screenshots, computed styles, axe or mobile pass.
 */
export async function captureStatic(url: string, guard: SsrfGuard, cfg: Config): Promise<PageCapture> {
  const t0 = Date.now();
  const res = await safeFetch(url, {
    guard,
    requireHtml: true,
    maxBytes: cfg.MAX_HTML_BYTES,
    timeoutMs: cfg.NAV_TIMEOUT_MS,
    headers: { 'user-agent': userAgent(cfg) },
  });
  if (res.truncated) throw new ScanError('SCAN_FAILED', 'The page is larger than 5 MB of HTML, which is over the scan limit.');
  const html = res.body.toString('utf8');
  const { window, document } = parseHTML(html);
  const location = new URL(res.url);
  // Our own collector source (not page content) evaluated with a fake browser global scope.
  // Parenthesised: the source starts with a comment, and a bare `return` + newline would return undefined.
  const collect = new Function('window', 'document', 'location', `return (${inpageSource('collect')});`)(window, document, location) as (o: unknown) => {
    facts: PageFacts;
  };
  const { facts } = collect({ noLayout: true, url: res.url, brand: false });
  facts.url = res.url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  return {
    requestedUrl: url,
    finalUrl: res.url,
    status: res.status,
    headers,
    redirects: res.redirects,
    rawHtml: html,
    title: facts.head.title,
    facts,
    brand: null,
    mobile: null,
    network: null,
    axe: null,
    screenshots: {},
    timings: { total: Date.now() - t0 },
    reduced: true,
    notes: ['Reduced accuracy: the browser was unavailable, so this page was analysed from its HTML only (no screenshots, computed styles, brand data or axe checks).'],
  };
}
