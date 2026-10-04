import { safeFetch } from '../security/safeFetch';
import type { SsrfGuard } from '../security/guard';
import type { SiteSignals } from '../rules/types';
import type { PageFacts } from '../capture/types';

export interface SignalOptions {
  guard: SsrfGuard;
  userAgent: string;
  /** Max internal links to HEAD-check. */
  linkSample?: number;
}

export interface RobotsInfo {
  status: number;
  body: string;
  sitemaps: string[];
}

export async function fetchRobots(origin: string, o: SignalOptions): Promise<RobotsInfo> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      guard: o.guard,
      maxBytes: 512 * 1024,
      timeoutMs: 8000,
      headers: { 'user-agent': o.userAgent, accept: 'text/plain,*/*;q=0.5' },
    });
    const ct = String(res.headers['content-type'] ?? '');
    // Some sites serve their HTML 404 page with status 200 at /robots.txt.
    const body = res.status < 400 && !/text\/html/i.test(ct) ? res.body.toString('utf8') : '';
    const sitemaps = [...body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!).slice(0, 10);
    return { status: body || res.status >= 400 ? res.status : 404, body, sitemaps };
  } catch {
    return { status: 0, body: '', sitemaps: [] };
  }
}

export async function checkSitemap(origin: string, robots: RobotsInfo, o: SignalOptions): Promise<{ found: boolean; url?: string; body?: string }> {
  const candidates = [...robots.sitemaps, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const url of [...new Set(candidates)].slice(0, 4)) {
    try {
      const res = await safeFetch(url, {
        guard: o.guard,
        maxBytes: 5 * 1024 * 1024,
        timeoutMs: 10_000,
        headers: { 'user-agent': o.userAgent, accept: 'application/xml,text/xml,*/*;q=0.5' },
      });
      const body = res.body.toString('utf8');
      if (res.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(body.slice(0, 5000))) return { found: true, url: res.url, body };
    } catch {
      /* try next */
    }
  }
  return { found: false };
}

/** HEAD-checks a capped, de-duplicated sample of internal links (GET fallback when HEAD isn't allowed). */
export async function checkLinks(facts: PageFacts, pageUrl: string, o: SignalOptions): Promise<SiteSignals['linkChecks']> {
  const self = new URL(pageUrl);
  self.hash = '';
  const seen = new Set<string>([self.href]);
  const sample: { url: string; selector: string }[] = [];
  for (const l of facts.links) {
    if (!l.internal || !/^https?:$/.test(l.protocol)) continue;
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    u.hash = '';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    sample.push({ url: u.href, selector: l.selector });
    if (sample.length >= (o.linkSample ?? 12)) break;
  }
  const results = await Promise.all(
    sample.map(async (s) => {
      const req = (method: 'HEAD' | 'GET') =>
        safeFetch(s.url, { guard: o.guard, method, maxBytes: 64 * 1024, timeoutMs: 6000, headers: { 'user-agent': o.userAgent } });
      try {
        let res = await req('HEAD');
        if (res.status === 405 || res.status === 501 || res.status === 403) res = await req('GET');
        return { url: s.url, status: res.status, selector: s.selector };
      } catch {
        return null; // network errors and blocked targets are not reported as broken links
      }
    }),
  );
  // Only clear "gone" statuses count as broken; 401/403/429 usually mean bot protection.
  return results.filter((r): r is NonNullable<typeof r> => !!r && (r.status === 404 || r.status === 410 || r.status >= 500));
}
