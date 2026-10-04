import { describe, expect, it } from 'vitest';
import { FindingSchema } from '@teardown/core';
import { RULE_BY_ID, RULES, runRules, sanitizeSnippet, MAX_INSTANCES } from '../../src/rules';
import { axeToFindings } from '../../src/rules/axe';
import { analyzePage } from '../../src/scan/analyze';
import type { RuleContext } from '../../src/rules/types';
import { ctxFor, loadCapture, mutate, noSignals } from './helpers';

const hits = (ruleId: string, ctx: RuleContext) => {
  const out = RULE_BY_ID.get(ruleId)!.check(ctx);
  return !out ? [] : Array.isArray(out) ? out : [out];
};

const bad = ctxFor(loadCapture('bad'));
const good = ctxFor(loadCapture('good'));

/** Rules the bad fixture must trip and the good fixture must pass. */
const FIXTURE_PAIRS = [
  'seo.title.short',
  'seo.meta-description.missing',
  'seo.h1.missing',
  'seo.heading.skip',
  'seo.canonical.missing',
  'seo.viewport.missing',
  'seo.social.missing',
  'seo.structured-data.missing',
  'seo.link.generic',
  'a11y.lang.missing',
  'a11y.img.alt',
  'a11y.form.label',
  'a11y.focus.invisible',
  'a11y.landmark.main',
  'ux.tap-target.small',
  'ux.text.small',
  'ux.line-length',
  'ux.mobile.overflow',
  'ux.img.dimensions',
  'ux.overlay.intrusive',
  'ux.media.autoplay',
  'sec.version.exposed',
  'brand.colors.near-duplicates',
  'brand.fonts.too-many',
  'brand.spacing.off-grid',
  'brand.radii.inconsistent',
  'brand.tokens.none',
  'perf.img.format',
  'perf.img.oversized',
  'perf.render-blocking',
];

describe('rules against the bad and good fixtures', () => {
  it.each(FIXTURE_PAIRS)('%s fires on bad.html and not on good.html', (id) => {
    expect(hits(id, bad).length, `bad: ${id}`).toBeGreaterThan(0);
    expect(hits(id, good), `good: ${id}`).toEqual([]);
  });

  it('every rule has a complete deterministic fix template', () => {
    for (const r of RULES) {
      expect(r.fix.summary.length, r.id).toBeGreaterThan(10);
      expect(r.fix.steps.length, r.id).toBeGreaterThan(0);
      expect(r.fix.acceptance.length, r.id).toBeGreaterThan(0);
      expect(r.id).toMatch(/^(seo|a11y|ux|sec|brand|perf)\.[a-z0-9.-]+$/);
    }
  });

  it('rule ids are unique', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('produces schema-valid findings with stable ids', () => {
    const a = runRules(bad);
    const b = runRules(ctxFor(loadCapture('bad')));
    expect(a.errors).toEqual([]);
    for (const f of a.findings) expect(FindingSchema.safeParse(f).success, f.ruleId).toBe(true);
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
    expect(new Set(a.findings.map((f) => f.id)).size).toBe(a.findings.length);
  });

  it('caps instances per rule but keeps the true count', () => {
    const c = mutate('bad', (cap) => {
      const img = cap.facts.images[0]!;
      cap.facts.images = Array.from({ length: 40 }, (_, i) => ({ ...img, selector: `img:nth-of-type(${i + 1})` }));
    });
    const run = runRules(ctxFor(c));
    expect(run.findings.filter((f) => f.ruleId === 'a11y.img.alt')).toHaveLength(MAX_INSTANCES);
    expect(run.counts['a11y.img.alt']).toBe(40);
  });

  it('attaches bounding boxes with the right viewport', () => {
    const run = runRules(bad);
    const tap = run.findings.find((f) => f.ruleId === 'ux.tap-target.small');
    expect(tap?.evidence.bbox?.viewport).toBe('mobile');
    const alt = run.findings.find((f) => f.ruleId === 'a11y.img.alt');
    expect(alt?.evidence.bbox?.viewport).toBe('desktop');
  });
});

describe('rules on targeted mutations', () => {
  const run = (id: string, c: ReturnType<typeof loadCapture>, over: Partial<RuleContext> = {}) => hits(id, ctxFor(c, over));

  it('seo.status.error', () => {
    expect(run('seo.status.error', mutate('good', (c) => (c.status = 404)))[0]?.measured).toBe('HTTP 404');
  });
  it('seo.redirect.chain', () => {
    const c = mutate('good', (c) => (c.redirects = [{ url: 'http://a/', status: 301 }, { url: 'https://a/', status: 302 }]));
    expect(run('seo.redirect.chain', c)).toHaveLength(1);
    expect(run('seo.redirect.chain', mutate('good', (c) => (c.redirects = [{ url: 'http://a/', status: 301 }])))).toEqual([]);
  });
  it('seo.title.missing and seo.title.long', () => {
    expect(run('seo.title.missing', mutate('good', (c) => (c.facts.head.title = '')))).toHaveLength(1);
    expect(run('seo.title.long', mutate('good', (c) => (c.facts.head.title = 'x'.repeat(80))))).toHaveLength(1);
  });
  it('seo.meta-description.length', () => {
    expect(run('seo.meta-description.length', mutate('good', (c) => (c.facts.head.metaDescription = 'Too short.')))).toHaveLength(1);
  });
  it('seo.h1.multiple', () => {
    const c = mutate('good', (c) => c.facts.headings.push({ ...c.facts.headings[0]!, selector: 'h1.second' }));
    expect(run('seo.h1.multiple', c)).toHaveLength(1);
  });
  it('seo.canonical.mismatch', () => {
    expect(run('seo.canonical.mismatch', mutate('good', (c) => (c.facts.head.canonical = 'https://other.example/')))).toHaveLength(1);
    expect(run('seo.canonical.mismatch', mutate('good', (c) => (c.facts.head.canonical = c.finalUrl + '/')))).toEqual([]);
  });
  it('seo.robots.noindex from meta or header', () => {
    expect(run('seo.robots.noindex', mutate('good', (c) => (c.facts.head.metaRobots = 'noindex, nofollow')))).toHaveLength(1);
    expect(run('seo.robots.noindex', mutate('good', (c) => (c.headers['x-robots-tag'] = 'noindex')))).toHaveLength(1);
  });
  it('seo.viewport.missing flags zoom-blocking viewports', () => {
    const h = run('seo.viewport.missing', mutate('good', (c) => (c.facts.head.viewport = 'width=device-width, user-scalable=no')));
    expect(h[0]?.detail).toMatch(/disables zoom/);
  });
  it('seo.structured-data.invalid', () => {
    expect(run('seo.structured-data.invalid', mutate('good', (c) => c.facts.head.jsonLd.push({ valid: false, types: [], error: 'Unexpected token' })))).toHaveLength(1);
  });
  it('seo.links.broken', () => {
    const c = loadCapture('good');
    expect(hits('seo.links.broken', ctxFor(c, { site: { ...noSignals, linkChecks: [{ url: 'https://fixture.test/x', status: 404 }] } }))).toHaveLength(1);
  });
  it('seo.robots-txt.missing and seo.sitemap.missing only on the primary page', () => {
    const c = loadCapture('good');
    const site = { robots: { status: 404, body: '' }, sitemap: { found: false }, linkChecks: [] };
    expect(hits('seo.robots-txt.missing', ctxFor(c, { site }))).toHaveLength(1);
    expect(hits('seo.sitemap.missing', ctxFor(c, { site }))).toHaveLength(1);
    expect(hits('seo.sitemap.missing', ctxFor(c, { site, primary: false }))).toEqual([]);
  });
  it('seo.hreflang.invalid', () => {
    const c = mutate('good', (c) => (c.facts.head.hreflang = [{ lang: 'english', href: 'https://fixture.test/en' }]));
    expect(run('seo.hreflang.invalid', c)[0]?.measured).toMatch(/invalid codes: english; no self-reference/);
    const ok = mutate('good', (c) => (c.facts.head.hreflang = [{ lang: 'en-GB', href: c.finalUrl }, { lang: 'x-default', href: c.finalUrl }]));
    expect(run('seo.hreflang.invalid', ok)).toEqual([]);
  });
  it('a11y.lang.invalid', () => {
    expect(run('a11y.lang.invalid', mutate('good', (c) => (c.facts.head.lang = 'english language')))).toHaveLength(1);
  });
  it('a11y.link.empty', () => {
    const c = mutate('good', (c) => (c.facts.links[0]!.accessibleName = ''));
    expect(run('a11y.link.empty', c)).toHaveLength(1);
  });
  it('a11y.skip-link.missing needs enough links to matter', () => {
    expect(run('a11y.skip-link.missing', mutate('good', (c) => ((c.facts.skipLink = { found: false }), (c.facts.linkCount = 20))))).toHaveLength(1);
    expect(run('a11y.skip-link.missing', mutate('good', (c) => ((c.facts.skipLink = { found: false }), (c.facts.linkCount = 3))))).toEqual([]);
  });
  it('ux.primary-action.missing', () => {
    expect(run('ux.primary-action.missing', mutate('good', (c) => (c.facts.primaryAction = { checked: true, found: false })))).toHaveLength(1);
  });
  it('ux.contrast.low only when axe did not run', () => {
    expect(hits('ux.contrast.low', ctxFor(loadCapture('bad'), { axeRan: false })).length).toBeGreaterThan(0);
    expect(hits('ux.contrast.low', bad)).toEqual([]);
  });
  it('security rules', () => {
    const http = loadCapture('good');
    expect(hits('sec.https.missing', ctxFor(http, { url: 'http://fixture.test/' }))).toHaveLength(1);
    expect(hits('sec.hsts.missing', ctxFor(http, { url: 'https://fixture.test/' }))).toHaveLength(1);
    const hsts = mutate('good', (c) => (c.headers['strict-transport-security'] = 'max-age=31536000'));
    expect(hits('sec.hsts.missing', ctxFor(hsts, { url: 'https://fixture.test/' }))).toEqual([]);
    expect(run('sec.mixed-content', mutate('good', (c) => c.facts.mixedContent.push({ url: 'http://x/a.js', selector: 'script' })))).toHaveLength(1);
    expect(run('sec.version.exposed', mutate('good', (c) => (c.headers['x-powered-by'] = 'PHP/8.1.2')))).toHaveLength(1);
    const secure = mutate('good', (c) =>
      Object.assign(c.headers, {
        'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      }),
    );
    for (const id of ['sec.headers.csp', 'sec.headers.nosniff', 'sec.headers.referrer', 'sec.headers.framing']) expect(run(id, secure), id).toEqual([]);
  });
  it('perf rules on network numbers', () => {
    const heavy = mutate('good', (c) => {
      c.network!.transferBytes = 6 * 1024 * 1024;
      c.network!.requests = 150;
      c.network!.thirdPartyBytes = 900 * 1024;
      c.network!.thirdParty = [{ host: 'ads.example', requests: 40, bytes: 900 * 1024 }];
      c.facts.domNodes = 4000;
    });
    expect(run('perf.weight.total', heavy)[0]?.severity).toBe('serious');
    expect(run('perf.requests.many', heavy)).toHaveLength(1);
    expect(run('perf.third-party.heavy', heavy)).toHaveLength(1);
    expect(run('perf.dom.large', heavy)).toHaveLength(1);
  });
  it('brand.fonts.weights and brand.buttons.inconsistent', () => {
    const b = ctxFor(loadCapture('good'));
    b.brand!.weightCount = 7;
    b.brand!.buttonVariants = Array.from({ length: 5 }, (_, i) => ({ count: 1, selector: `.b${i}`, text: 'Go' }));
    expect(hits('brand.fonts.weights', b)).toHaveLength(1);
    expect(hits('brand.buttons.inconsistent', b)).toHaveLength(5);
  });
});

describe('axe mapping', () => {
  it('maps impact to severity, keeps the axe id and skips rules we supersede', () => {
    const { findings, counts } = axeToFindings(loadCapture('bad').axe!, 'https://fixture.test/bad.html');
    const ids = new Set(findings.map((f) => f.evidence.ref));
    expect(ids.has('color-contrast')).toBe(true);
    for (const superseded of ['image-alt', 'html-has-lang', 'label', 'select-name', 'target-size', 'heading-order', 'page-has-heading-one', 'landmark-one-main'])
      expect(ids.has(superseded), superseded).toBe(false);
    const cc = findings.find((f) => f.evidence.ref === 'color-contrast')!;
    expect(cc.severity).toBe('serious');
    expect(cc.source).toBe('axe');
    expect(cc.evidence.measured).toMatch(/:1 \(#/);
    expect(counts['a11y.axe.color-contrast']).toBeGreaterThan(0);
  });
});

describe('analyzePage', () => {
  it('gives the bad fixture much lower scores than the good one', async () => {
    const { groupFindings, scoresByCategory } = await import('@teardown/core');
    const score = (name: 'bad' | 'good') => {
      const a = analyzePage(loadCapture(name), noSignals, true);
      return scoresByCategory(groupFindings(a.findings, a.counts));
    };
    const b = score('bad');
    const g = score('good');
    expect(b.accessibility).toBeLessThan(40);
    expect(b.ux).toBeLessThan(60);
    expect(g.accessibility).toBe(100);
    expect(g.ux).toBe(100);
    for (const k of Object.keys(g) as (keyof typeof g)[]) expect(g[k], k).toBeGreaterThanOrEqual(b[k]);
  });
});

describe('sanitizeSnippet', () => {
  it('empties script bodies, strips control characters and caps length', () => {
    expect(sanitizeSnippet('<div>ok<script>steal()</script></div>')).toBe('<div>ok<script></script></div>');
    expect(sanitizeSnippet('a\u0000b\u0007c')).toBe('abc');
    expect(sanitizeSnippet('x'.repeat(500))!.length).toBe(300);
  });
});
