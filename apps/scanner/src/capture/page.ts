import type { BrowserContext, CDPSession, Page, Response } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { ScanError } from '../errors';
import type { SsrfGuard } from '../security/guard';
import type { BrowserPool } from '../browser/pool';
import { userAgent, type Config } from '../config';
import { inpageCall } from './inpage';
import { siteOf } from '../util/site';
import { withTimeout } from '../util/limiter';
import type { AxeViolation, BrandRaw, MobileFacts, NetworkEntry, NetworkSummary, PageCapture, PageFacts, Screenshot } from './types';

export interface CaptureOptions {
  pool: BrowserPool;
  guard: SsrfGuard;
  cfg: Config;
  /** Run the mobile pass (viewport 390x844, touch). */
  mobile: boolean;
  /** Capture the mobile screenshot (only the first page in site mode). */
  mobileScreenshot: boolean;
  desktopScreenshot: boolean;
  /** JPEG quality for screenshots. */
  quality: number;
  signal?: AbortSignal;
  onStep?: (name: string, status: 'running' | 'done' | 'skipped' | 'failed', ms?: number, note?: string) => void;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MAX_SHOT_H = 8000;
const MOBILE_SHOT_H = 2500;
/** Time kept back for the mobile pass when bounding axe-core. */
const MOBILE_RESERVE_MS = 12_000;

/* Plain-string scripts: functions passed to evaluate can pick up bundler helpers (see D-03). */
const AUTOSCROLL = `(async () => {
  const max = Math.min(document.documentElement.scrollHeight, ${MAX_SHOT_H});
  for (let y = 0; y < max; y += Math.round(innerHeight * 0.8)) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 150));
})()`;
const FONTS_READY = `Promise.race([document.fonts ? document.fonts.ready.then(() => true) : true, new Promise((r) => setTimeout(() => r(false), 3000))])`;
const DOC_HEIGHT = `Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)`;

interface Counters {
  requests: number;
  blocked: number;
  capped: boolean;
}

/** Defence in depth on top of the proxy: every request URL is validated before it leaves. */
async function guardContext(ctx: BrowserContext, guard: SsrfGuard, maxRequests: number, counters: Counters) {
  await ctx.route('**/*', async (route) => {
    let url: URL;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.abort('blockedbyclient');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.abort('blockedbyclient');
    counters.requests++;
    if (counters.requests > maxRequests) {
      counters.capped = true;
      return route.abort('blockedbyclient');
    }
    try {
      await guard.assertUrl(url);
    } catch {
      counters.blocked++;
      return route.abort('blockedbyclient');
    }
    return route.continue().catch(() => undefined);
  });
  // WebSockets: validate the destination, then let the browser connect (still via the proxy).
  await ctx.routeWebSocket(/.*/, async (ws) => {
    try {
      const u = new URL(ws.url());
      await guard.assertUrl(new URL(u.href.replace(/^ws/, 'http')));
      ws.connectToServer();
    } catch {
      counters.blocked++;
      await ws.close({ code: 1008, reason: 'blocked' }).catch(() => undefined);
    }
  });
}

function hardenPage(page: Page) {
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
  page.on('popup', (p) => void p.close().catch(() => undefined));
  page.on('download', (d) => void d.cancel().catch(() => undefined));
}

function mapNavError(e: unknown): ScanError {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ScanError) return e;
  if (/Timeout|ERR_TIMED_OUT/i.test(msg)) return new ScanError('TIMEOUT');
  if (/ERR_BLOCKED_BY_CLIENT|ERR_TUNNEL_CONNECTION_FAILED|ERR_ACCESS_DENIED/i.test(msg)) return new ScanError('BLOCKED_TARGET');
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_SSL|ERR_CERT|ERR_EMPTY_RESPONSE|ERR_PROXY|ERR_INTERNET|ERR_NETWORK/i.test(msg))
    return new ScanError('UNREACHABLE');
  if (/ERR_ABORTED|Download is starting/i.test(msg)) return new ScanError('NOT_HTML');
  return new ScanError('SCAN_FAILED');
}

async function shot(page: Page, width: number, height: number, outWidth: number, quality: number): Promise<Screenshot> {
  const buf = await page.screenshot({
    type: 'jpeg',
    quality: 85,
    fullPage: true,
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
    caret: 'hide',
    timeout: 15_000,
  });
  const out = await sharp(buf).resize({ width: outWidth, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
  return { dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`, w: width, h: height, bytes: out.length };
}

function networkRecorder(cdp: CDPSession, pageHost: string) {
  const entries = new Map<string, NetworkEntry>();
  let failed = 0;
  const site = siteOf(pageHost);
  cdp.on('Network.responseReceived', (e) => {
    let host: string;
    try {
      host = new URL(e.response.url).hostname;
    } catch {
      return;
    }
    if (!/^https?:/.test(e.response.url)) return;
    const headers = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    entries.set(e.requestId, {
      url: e.response.url.slice(0, 400),
      type: (e.type ?? 'Other').toLowerCase(),
      mime: e.response.mimeType,
      status: e.response.status,
      bytes: 0,
      encoding: headers['content-encoding'] ?? '',
      host,
      thirdParty: siteOf(host) !== site,
    });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const en = entries.get(e.requestId);
    if (en) en.bytes = e.encodedDataLength;
  });
  cdp.on('Network.loadingFailed', () => failed++);
  return {
    summary(counters: Counters): NetworkSummary {
      const list = [...entries.values()];
      const byType: NetworkSummary['byType'] = {};
      const third = new Map<string, { host: string; requests: number; bytes: number }>();
      const imageFormats: Record<string, number> = {};
      let total = 0;
      let thirdBytes = 0;
      for (const en of list) {
        total += en.bytes;
        const t = (byType[en.type] ??= { count: 0, bytes: 0 });
        t.count++;
        t.bytes += en.bytes;
        if (en.thirdParty) {
          thirdBytes += en.bytes;
          const th = third.get(en.host) ?? { host: en.host, requests: 0, bytes: 0 };
          th.requests++;
          th.bytes += en.bytes;
          third.set(en.host, th);
        }
        if (en.type === 'image') {
          const fmt = en.mime.replace(/^image\//, '').replace('svg+xml', 'svg').replace('x-icon', 'ico') || 'unknown';
          imageFormats[fmt] = (imageFormats[fmt] ?? 0) + 1;
        }
      }
      const textual = /^(text\/|application\/(javascript|json|xml|x-javascript|ld\+json)|image\/svg)/;
      return {
        requests: list.length,
        transferBytes: total,
        byType,
        thirdParty: [...third.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 15),
        thirdPartyBytes: thirdBytes,
        imageFormats,
        uncompressed: list
          .filter((en) => textual.test(en.mime) && !en.encoding && en.bytes > 2048 && en.status === 200)
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 10)
          .map((en) => ({ url: en.url, bytes: en.bytes, type: en.type })),
        largestImages: list
          .filter((en) => en.type === 'image')
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 10)
          .map((en) => ({ url: en.url, bytes: en.bytes, mime: en.mime })),
        blockedRequests: counters.blocked,
        failedRequests: failed,
        capped: counters.capped,
      };
    },
  };
}

/** Maps each sampled element's declared first font family to the font Chromium actually rendered. */
async function platformFonts(cdp: CDPSession): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    for (const sel of ['h1', 'h2', 'h3', 'p', 'li', 'a', 'button', 'nav', 'code', 'pre', 'body']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }).catch(() => ({ nodeId: 0 }));
      if (!nodeId) continue;
      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId });
      const family = computedStyle.find((p) => p.name === 'font-family')?.value ?? '';
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const top = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
      const declared = family.split(',')[0]?.replace(/["']/g, '').trim();
      if (declared && top && !out[declared]) out[declared] = top.familyName;
    }
  } catch {
    /* CDP font lookup is best-effort */
  }
  return out;
}

function headerRecord(res: Response): Promise<Record<string, string>> {
  return res.allHeaders().catch(() => res.headers());
}

export async function capturePage(url: string, deadline: number, o: CaptureOptions): Promise<PageCapture> {
  const timings: Record<string, number> = {};
  const notes: string[] = [];
  const t0 = Date.now();
  const remaining = () => deadline - Date.now();
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    o.onStep?.(name, 'running');
    try {
      const v = await fn();
      timings[name] = Date.now() - s;
      o.onStep?.(name, 'done', timings[name]);
      return v;
    } catch (e) {
      timings[name] = Date.now() - s;
      o.onStep?.(name, 'failed', timings[name]);
      throw e;
    }
  };

  const release = await o.pool.contexts.acquire();
  const counters: Counters = { requests: 0, blocked: 0, capped: false };
  let ctx: BrowserContext | null = null;
  let mctx: BrowserContext | null = null;
  try {
    ctx = await o.pool.newContext({ viewport: DESKTOP, userAgent: userAgent(o.cfg), deviceScaleFactor: 1 });
    await guardContext(ctx, o.guard, o.cfg.MAX_SUBREQUESTS, counters);
    const page = await ctx.newPage();
    hardenPage(page);
    page.setDefaultTimeout(Math.max(5000, Math.min(15_000, remaining())));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const net = networkRecorder(cdp, new URL(url).hostname);

    // 1. Navigate
    const response = await step('load page', async () => {
      try {
        const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(o.cfg.NAV_TIMEOUT_MS, remaining()) });
        if (!r) throw new ScanError('UNREACHABLE');
        return r;
      } catch (e) {
        throw mapNavError(e);
      }
    });
    const headers = await headerRecord(response);
    const ct = headers['content-type'] ?? '';
    if (ct && !/text\/html|application\/xhtml\+xml/i.test(ct)) throw new ScanError('NOT_HTML');
    const declaredLength = Number(headers['content-length'] ?? 0);
    if (declaredLength > o.cfg.MAX_HTML_BYTES) throw new ScanError('SCAN_FAILED', 'The page is larger than 5 MB of HTML, which is over the scan limit.');
    let rawHtml = '';
    try {
      rawHtml = await response.text();
    } catch {
      notes.push('The original HTML response body was unavailable; rules used the rendered DOM.');
    }
    if (Buffer.byteLength(rawHtml) > o.cfg.MAX_HTML_BYTES) {
      throw new ScanError('SCAN_FAILED', 'The page is larger than 5 MB of HTML, which is over the scan limit.');
    }
    const redirects: { url: string; status: number }[] = [];
    for (let req = response.request().redirectedFrom(); req; req = req.redirectedFrom()) {
      const r = await req.response().catch(() => null);
      redirects.unshift({ url: req.url(), status: r?.status() ?? 0 });
    }

    // 2. Settle: network idle (bounded), lazy content, fonts
    await step('wait for content', async () => {
      await page.waitForLoadState('networkidle', { timeout: Math.max(1000, Math.min(5000, remaining() - 20_000)) }).catch(() => undefined);
      await page.evaluate(AUTOSCROLL).catch(() => undefined);
      await page.evaluate(FONTS_READY).catch(() => undefined);
    });

    // 3. Facts + brand
    const collected = await step('read page structure', () =>
      page.evaluate(inpageCall('collect', { brand: true, checkFocus: true, maxElements: 3000 })) as Promise<{ facts: PageFacts; brand: BrandRaw | null }>,
    );
    if (collected.brand) collected.brand.platformFonts = await platformFonts(cdp);

    // axe-core run plus pin positions (document coordinates) for each violation node.
    const runAxe = async (): Promise<AxeViolation[]> => {
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .disableRules(['color-contrast-enhanced'])
        .analyze();
      const violations: AxeViolation[] = res.violations.map((v) => ({
        id: v.id,
        impact: (v.impact ?? null) as AxeViolation['impact'],
        help: v.help,
        description: v.description,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodeCount: v.nodes.length,
        nodes: v.nodes.slice(0, 10).map((n) => {
          const data = (n.any?.[0]?.data ?? {}) as { contrastRatio?: number; expectedContrastRatio?: string; fgColor?: string; bgColor?: string };
          return {
            target: Array.isArray(n.target) ? n.target.map(String).join(' ') : String(n.target),
            html: n.html.slice(0, 300),
            failureSummary: n.failureSummary?.slice(0, 300),
            ...(v.id === 'color-contrast' && data.contrastRatio
              ? { measured: `${data.contrastRatio}:1 (${data.fgColor} on ${data.bgColor})`, expected: `>= ${data.expectedContrastRatio ?? '4.5:1'}` }
              : {}),
          };
        }),
      }));
      const targets = violations.flatMap((v) => v.nodes.map((n) => n.target));
      const rects = (await page
        .evaluate(
          `(${String.raw`(sels) => sels.map((s) => {
            try {
              const el = document.querySelector(s);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) return null;
              return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
            } catch (e) { return null; }
          })`})(${JSON.stringify(targets)})`,
        )
        .catch(() => [])) as (AxeViolation['nodes'][number]['bbox'])[];
      let i = 0;
      for (const v of violations) for (const n of v.nodes) n.bbox = rects[i++] ?? null;
      return violations;
    };

    // 4. Desktop screenshot. Taken before axe so a slow accessibility run (software rendering on a
    // small serverless CPU) can't use up the page budget and starve the annotated specimen.
    const screenshots: PageCapture['screenshots'] = {};
    const docH = Math.max(1, Math.min(MAX_SHOT_H, Number(await page.evaluate(DOC_HEIGHT).catch(() => DESKTOP.height))));
    if (o.desktopScreenshot && remaining() > 3000) {
      screenshots.desktop = await step('screenshot', () =>
        withTimeout(shot(page, DESKTOP.width, docH, 1280, o.quality), Math.max(2000, remaining() - 2000), () => new Error('screenshot timeout')),
      ).catch(() => {
        notes.push('Desktop screenshot could not be captured in time.');
        return undefined;
      });
    } else if (o.desktopScreenshot) notes.push('Skipped the desktop screenshot: page budget nearly used up.');

    // 5. Axe, bounded as a whole (analysis plus pin positions), leaving time for the mobile pass.
    const axeBudget = Math.min(25_000, remaining() - (o.mobile ? MOBILE_RESERVE_MS : 2000));
    let axe: AxeViolation[] | null = null;
    if (axeBudget > 4000) {
      axe = await step('accessibility checks', () => withTimeout(runAxe(), axeBudget, () => new Error('axe timeout'))).catch(() => {
        notes.push('Accessibility engine (axe-core) did not finish in time; own accessibility checks still ran.');
        return null;
      });
    } else notes.push('Skipped axe-core: page budget nearly used up.');

    const network = net.summary(counters);
    const title = collected.facts.head.title || (await page.title().catch(() => ''));
    const finalUrl = page.url();
    await ctx.close().catch(() => undefined);
    ctx = null;

    // 6. Mobile pass
    let mobile: MobileFacts | null = null;
    if (o.mobile && remaining() > 8000) {
      try {
        mobile = await step('mobile pass', async () => {
          mctx = await o.pool.newContext({
            viewport: MOBILE,
            userAgent: userAgent(o.cfg, true),
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 1,
          });
          await guardContext(mctx, o.guard, o.cfg.MAX_SUBREQUESTS, { requests: 0, blocked: 0, capped: false });
          const mp = await mctx.newPage();
          hardenPage(mp);
          await mp.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(o.cfg.NAV_TIMEOUT_MS, remaining() - 2000) });
          await mp.waitForLoadState('networkidle', { timeout: Math.max(500, Math.min(3000, remaining() - 6000)) }).catch(() => undefined);
          await mp.evaluate(FONTS_READY).catch(() => undefined);
          const facts = (await mp.evaluate(inpageCall('mobile'))) as MobileFacts;
          if (o.mobileScreenshot && remaining() > 2500) {
            const h = Math.max(1, Math.min(MOBILE_SHOT_H, facts.docH));
            screenshots.mobile = await shot(mp, MOBILE.width, h, MOBILE.width, o.quality).catch(() => undefined);
          }
          return facts;
        });
      } catch {
        notes.push('The mobile pass did not complete; mobile checks were skipped.');
      }
    } else if (o.mobile) notes.push('Skipped the mobile pass: page budget nearly used up.');

    timings.total = Date.now() - t0;
    return {
      requestedUrl: url,
      finalUrl,
      status: response.status(),
      headers,
      redirects,
      rawHtml,
      title,
      facts: collected.facts,
      brand: collected.brand,
      mobile,
      network,
      axe,
      screenshots,
      timings,
      reduced: false,
      notes,
    };
  } finally {
    await (ctx as BrowserContext | null)?.close().catch(() => undefined);
    await (mctx as BrowserContext | null)?.close().catch(() => undefined);
    release();
  }
}
