import { describe, expect, it } from 'vitest';
import { discoverPages, normalizeForCrawl, templateKey } from '../../src/scan/discover';
import { SsrfGuard } from '../../src/security/guard';

const guard = new SsrfGuard({ allowPrivate: true });
const base = { guard, userAgent: 'TeardownBot test', robotsUrl: 'https://site.example/robots.txt' };

describe('normalizeForCrawl', () => {
  it('drops fragments and tracking params, sorts the rest, folds index files', () => {
    expect(normalizeForCrawl('https://site.example/a?utm_source=x&b=2&a=1#top')).toBe('https://site.example/a?a=1&b=2');
    expect(normalizeForCrawl('/index.html', 'https://site.example/x/')).toBe('https://site.example/');
    expect(normalizeForCrawl('mailto:hi@site.example')).toBeNull();
  });
});

describe('templateKey', () => {
  it('collapses slugs and ids under the same section', () => {
    expect(templateKey('https://site.example/blog/one')).toBe(templateKey('https://site.example/blog/two'));
    expect(templateKey('https://site.example/blog/one')).not.toBe(templateKey('https://site.example/about'));
    expect(templateKey('https://site.example/p/123')).toBe(templateKey('https://site.example/p/456'));
  });
});

describe('discoverPages', () => {
  const sitemap = `<?xml version="1.0"?><urlset>
    ${['/', '/about', '/pricing?utm_source=x', '/blog/a', '/blog/b', '/blog/c', '/private/x', '/files/doc.pdf', 'https://other.example/x']
      .map((p) => `<url><loc>${p.startsWith('http') ? p : `https://site.example${p}`}</loc></url>`)
      .join('')}</urlset>`;

  it('uses the sitemap, respects robots.txt, skips other origins and files, and prefers diverse templates', async () => {
    const r = await discoverPages('https://site.example/', {
      ...base,
      maxPages: 4,
      robotsTxt: 'User-agent: *\nDisallow: /private/',
      sitemapBody: sitemap,
      homeLinks: [],
    });
    expect(r.urls[0]).toBe('https://site.example/');
    expect(r.urls).toEqual(expect.arrayContaining(['https://site.example/about', 'https://site.example/pricing']));
    expect(r.urls).toHaveLength(4);
    expect(r.urls.filter((u) => u.includes('/blog/'))).toHaveLength(1); // one per template first
    expect(r.urls.some((u) => u.includes('/private/') || u.endsWith('.pdf') || u.includes('other.example'))).toBe(false);
    expect(r.disallowed).toBe(1);
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.source).toBe('sitemap');
  });

  it('honours TeardownBot-specific disallows', async () => {
    const r = await discoverPages('https://site.example/', {
      ...base,
      maxPages: 10,
      robotsTxt: 'User-agent: TeardownBot\nDisallow: /blog/',
      homeLinks: ['https://site.example/blog/a', 'https://site.example/about'],
    });
    expect(r.urls).toEqual(['https://site.example/', 'https://site.example/about']);
    expect(r.source).toBe('links');
  });

  it('falls back to home-page links when there is no sitemap', async () => {
    const r = await discoverPages('https://site.example/', { ...base, maxPages: 15, robotsTxt: '', homeLinks: ['/a', '/b#x', '/b', 'https://site.example/c'] });
    expect(r.urls).toEqual(['https://site.example/', 'https://site.example/a', 'https://site.example/b', 'https://site.example/c']);
  });
});
