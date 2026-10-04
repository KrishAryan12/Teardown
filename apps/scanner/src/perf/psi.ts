import { fromLhr } from './lhr';
import type { PerfResult } from './types';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** PageSpeed Insights v5, mobile strategy, four categories. 60s timeout, one retry. */
export async function runPsi(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<PerfResult> {
  const qs = new URLSearchParams({ url, strategy: 'mobile', key: apiKey });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) qs.append('category', c);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetchImpl(`${PSI_ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        // 4xx other than 429 won't improve on retry.
        const err = new Error(`PSI HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { final: true });
        throw err;
      }
      const body = (await res.json()) as { lighthouseResult?: unknown };
      if (!body.lighthouseResult) throw new Error('PSI returned no lighthouseResult');
      return fromLhr(body.lighthouseResult as never, 'psi', Date.now() - started);
    } catch (e) {
      lastErr = e;
      if ((e as { final?: boolean }).final) break;
    }
  }
  throw lastErr;
}
