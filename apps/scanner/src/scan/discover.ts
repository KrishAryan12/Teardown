import { XMLParser } from 'fast-xml-parser';
import robotsParser from 'robots-parser';
import { safeFetch } from '../security/safeFetch';
import type { SsrfGuard } from '../security/guard';

const TRACKING = /^(utm_\w+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|_ga|igshid|msclkid)$/i;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|gz|rar|7z|mp4|mp3|mov|avi|webm|woff2?|ttf|css|js|json|xml|txt|csv|docx?|xlsx?|pptx?)$/i;

/** Strips fragments and tracking parameters, sorts the rest, and drops trailing index files. */
export function normalizeForCrawl(u: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(u, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  url.search = params.length ? '?' + new URLSearchParams(params).toString() : '';
  url.pathname = url.pathname.replace(/\/index\.(html?|php)$/i, '/');
  return url.href;
}

/** Template key: first path segment + depth, with ids/slugs collapsed, so /blog/a and /blog/b match. */
export function templateKey(u: string): string {
  const { pathname, search } = new URL(u);
  const segs = pathname.split('/').filter(Boolean);
  const shape = segs.map((s, i) => (i === 0 ? s.toLowerCase() : /^\d+$/.test(s) ? ':id' : '*'));
  return `${shape.join('/')}|${segs.length}|${search ? 'q' : ''}`;
}

export interface DiscoverOptions {
  guard: SsrfGuard;
  userAgent: string;
  maxPages: number;
  robotsTxt: string;
  robotsUrl: string;
  sitemapBody?: string;
  /** Links found on the home page (fallback / supplement to the sitemap). */
  homeLinks: string[];
}

export interface DiscoverResult {
  urls: string[];
  /** Candidates found but not scanned (cap, robots or duplicates of a template). */
  skipped: number;
  source: 'sitemap' | 'links' | 'both';
  disallowed: number;
}

async function sitemapUrls(body: string, o: DiscoverOptions, depth = 0): Promise<string[]> {
  const parser = new XMLParser({ ignoreAttributes: true, isArray: (name) => name === 'url' || name === 'sitemap' });
  let doc: { urlset?: { url?: { loc?: string }[] }; sitemapindex?: { sitemap?: { loc?: string }[] } };
  try {
    doc = parser.parse(body);
  } catch {
    return [];
  }
  const urls = (doc.urlset?.url ?? []).map((u) => String(u.loc ?? '').trim()).filter(Boolean);
  if (doc.sitemapindex?.sitemap && depth < 1) {
    for (const sm of doc.sitemapindex.sitemap.slice(0, 3)) {
      const loc = String(sm.loc ?? '').trim();
      if (!loc) continue;
      try {
        const res = await safeFetch(loc, { guard: o.guard, maxBytes: 5 * 1024 * 1024, timeoutMs: 10_000, headers: { 'user-agent': o.userAgent } });
        if (res.status === 200) urls.push(...(await sitemapUrls(res.body.toString('utf8'), o, depth + 1)));
      } catch {
        /* skip broken child sitemap */
      }
      if (urls.length > 2000) break;
    }
  }
  return urls.slice(0, 5000);
}

/**
 * Picks up to `maxPages` same-origin URLs (home page first): sitemap entries plus home-page links,
 * minus robots.txt disallows, preferring shallow paths and one page per URL template.
 */
export async function discoverPages(home: string, o: DiscoverOptions): Promise<DiscoverResult> {
  const origin = new URL(home).origin;
  const robots = robotsParser(o.robotsUrl, o.robotsTxt);
  const allowed = (u: string) => robots.isAllowed(u, 'TeardownBot') !== false && robots.isAllowed(u, '*') !== false;

  const fromSitemap = o.sitemapBody ? await sitemapUrls(o.sitemapBody, o) : [];
  const candidates = new Map<string, 'sitemap' | 'links'>();
  const add = (raw: string, src: 'sitemap' | 'links') => {
    const n = normalizeForCrawl(raw, home);
    if (!n || new URL(n).origin !== origin || SKIP_EXT.test(new URL(n).pathname)) return;
    if (!candidates.has(n)) candidates.set(n, src);
  };
  fromSitemap.forEach((u) => add(u, 'sitemap'));
  o.homeLinks.forEach((u) => add(u, 'links'));

  const homeNorm = normalizeForCrawl(home)!;
  candidates.delete(homeNorm);
  let disallowed = 0;
  const pool = [...candidates.keys()].filter((u) => {
    const ok = allowed(u);
    if (!ok) disallowed++;
    return ok;
  });
  const depth = (u: string) => new URL(u).pathname.split('/').filter(Boolean).length + (new URL(u).search ? 1 : 0);
  pool.sort((a, b) => depth(a) - depth(b) || a.length - b.length || a.localeCompare(b));

  const picked = [homeNorm];
  const seenTemplates = new Set([templateKey(homeNorm)]);
  const leftovers: string[] = [];
  for (const u of pool) {
    if (picked.length >= o.maxPages) break;
    const key = templateKey(u);
    if (seenTemplates.has(key)) leftovers.push(u);
    else {
      seenTemplates.add(key);
      picked.push(u);
    }
  }
  for (const u of leftovers) {
    if (picked.length >= o.maxPages) break;
    picked.push(u);
  }
  const srcs = new Set(picked.slice(1).map((u) => candidates.get(u)));
  return {
    urls: picked,
    skipped: Math.max(0, pool.length - (picked.length - 1)),
    source: srcs.has('sitemap') && srcs.has('links') ? 'both' : srcs.has('sitemap') ? 'sitemap' : 'links',
    disallowed,
  };
}
