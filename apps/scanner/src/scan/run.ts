import type { BrandProfile, Finding, Report, ScanEvent, ScanMode, StepStatus } from '@teardown/core';
import { groupFindings, orderedGroups, scoresByCategory } from '@teardown/core';
import { userAgent, type Config } from '../config';
import { ScanError } from '../errors';
import { normalizeUrl, type SsrfGuard } from '../security/guard';
import type { BrowserPool } from '../browser/pool';
import { capturePage } from '../capture/page';
import { captureStatic } from '../capture/static';
import type { BrandRaw, PageCapture } from '../capture/types';
import { processBrand, emptyBrand } from '../brand/process';
import { RULE_BY_ID, toFinding } from '../rules';
import type { SiteSignals } from '../rules/types';
import { analyzePage } from './analyze';
import { checkLinks, checkSitemap, fetchRobots } from './siteSignals';
import { discoverPages } from './discover';
import { detectStack } from './stack';
import { buildReport, enforcePayloadCap, type PageOutcome } from './report';
import type { PerfEngine } from '../perf/engine';
import type { PerfResult } from '../perf/types';
import { lighthouseFindings } from '../perf/findings';
import { estimatePerformance } from '../perf/estimate';
import { deterministicAdvice } from '../ai/fallback';
import { buildAiInput } from '../ai/input';
import type { AiResult, AiService } from '../ai/types';
import { Semaphore } from '../util/limiter';
import { log } from '../util/log';

export interface ScanDeps {
  cfg: Config;
  guard: SsrfGuard;
  pool: BrowserPool;
  perf: PerfEngine;
  ai: AiService;
}

export interface ScanHooks {
  emit: (e: ScanEvent) => void;
  signal?: AbortSignal;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

interface Captured {
  index: number;
  capture: PageCapture;
  outcome: PageOutcome;
  perf?: Promise<{ result: PerfResult | null; notes: string[] }>;
}

/** Runs one scan end to end and returns a validated-shape Report. Emits progress events. */
export async function runScan(req: { url: string; mode: ScanMode }, d: ScanDeps, h: ScanHooks): Promise<Report> {
  const { cfg } = d;
  const ua = userAgent(cfg);
  const notes: string[] = [];
  const checkAbort = () => {
    if (h.signal?.aborted) throw new CancelledError();
  };
  const step = async <T>(name: string, fn: () => Promise<T>, quietFail = false): Promise<T> => {
    checkAbort();
    const s = Date.now();
    const emit = (status: StepStatus, note?: string) => h.emit({ type: 'step', data: { name, status, ...(status !== 'running' ? { ms: Date.now() - s } : {}), ...(note ? { note } : {}) } });
    emit('running');
    try {
      const v = await fn();
      emit('done');
      return v;
    } catch (e) {
      emit(quietFail ? 'skipped' : 'failed');
      throw e;
    }
  };

  /* 1. Address */
  const target = await step('Check the address', async () => {
    const u = normalizeUrl(req.url);
    await d.guard.assertUrl(u);
    return u;
  });
  const origin = target.origin;

  /* 2. robots.txt + sitemap */
  const signalOpts = { guard: d.guard, userAgent: ua };
  const { robots, sitemap } = await step('Read robots.txt and sitemap', async () => {
    const robots = await fetchRobots(origin, signalOpts);
    const sitemap = await checkSitemap(origin, robots, signalOpts);
    return { robots, sitemap };
  });
  const baseSignals: SiteSignals = { robots: { status: robots.status, body: '' }, sitemap: { found: sitemap.found, url: sitemap.url }, linkChecks: [] };

  /* 3. Capture helpers */
  let reduced = false;
  const capture = async (url: string, index: number, total: number): Promise<PageCapture> => {
    const single = req.mode === 'single';
    const opts = {
      pool: d.pool,
      guard: d.guard,
      cfg,
      mobile: true,
      mobileScreenshot: index === 0,
      desktopScreenshot: true,
      quality: single ? 65 : 50,
      signal: h.signal,
      onStep: single ? (name: string, status: StepStatus, ms?: number) => h.emit({ type: 'step', data: { name: capitalise(name), status, ...(ms !== undefined ? { ms } : {}) } }) : undefined,
    };
    if (!single) h.emit({ type: 'page_started', data: { url, index, total } });
    for (let attempt = 0; attempt < 2; attempt++) {
      checkAbort();
      try {
        return await capturePage(url, Date.now() + cfg.PAGE_BUDGET_MS, opts);
      } catch (e) {
        if (e instanceof ScanError) throw e;
        log.warn({ event: 'capture_browser_error', attempt, error: e instanceof Error ? e.message.split('\n')[0]!.slice(0, 160) : 'unknown' });
      }
    }
    // Chromium failed twice: HTML-only analysis.
    reduced = true;
    return captureStatic(url, d.guard, cfg);
  };

  const finishPage = async (cap: PageCapture, index: number): Promise<Captured> => {
    const primary = index === 0;
    const links = await checkLinks(cap.facts, cap.finalUrl, { ...signalOpts, linkSample: req.mode === 'single' ? 12 : 4 }).catch(() => []);
    const analysis = analyzePage(cap, { ...baseSignals, linkChecks: links }, primary);
    const outcome: PageOutcome = {
      url: cap.finalUrl,
      title: cap.title,
      status: cap.status,
      timings: cap.timings,
      screenshots: { desktop: cap.screenshots.desktop?.dataUrl, mobile: cap.screenshots.mobile?.dataUrl },
      screenshotSize: {
        ...(cap.screenshots.desktop ? { desktop: { w: cap.screenshots.desktop.w, h: cap.screenshots.desktop.h } } : {}),
        ...(cap.screenshots.mobile ? { mobile: { w: cap.screenshots.mobile.w, h: cap.screenshots.mobile.h } } : {}),
      },
      findings: analysis.findings,
      counts: analysis.counts,
    };
    notes.push(...cap.notes.filter((n) => !notes.includes(n)));
    const perfEligible = index === 0 || (req.mode === 'site' && index <= cfg.PERF_MAX_PAGES_FULL);
    const perf = perfEligible && !cap.reduced ? d.perf.run(cap.finalUrl) : undefined;
    return { index, capture: cap, outcome, perf };
  };

  /* 4. Primary page */
  // total 0 = not known yet (discovery runs after the home page).
  const first = await capture(target.href, 0, 0).then((c) => finishPage(c, 0));
  const pages: Captured[] = [first];
  let pagesSkipped = 0;
  let truncated = false;

  /* 5. Site mode: discover and scan the rest */
  if (req.mode === 'site') {
    const discovered = await step('Find pages to scan', () =>
      discoverPages(first.capture.finalUrl, {
        guard: d.guard,
        userAgent: ua,
        maxPages: cfg.SITE_MAX_PAGES,
        robotsTxt: robots.body,
        robotsUrl: `${origin}/robots.txt`,
        sitemapBody: sitemap.body,
        homeLinks: first.capture.facts.links.filter((l) => l.internal).map((l) => l.href),
      }),
    );
    const rest = discovered.urls.slice(1);
    pagesSkipped += discovered.skipped;
    if (discovered.skipped > 0) truncated = true;
    if (discovered.disallowed) notes.push(`${discovered.disallowed} page(s) were skipped because robots.txt disallows them.`);
    h.emit({ type: 'page_done', data: { url: first.outcome.url, scores: pageScores(first.outcome), findingCount: first.outcome.findings.length } });
    const deadline = Date.now() + cfg.SITE_BUDGET_MS;
    const sem = new Semaphore(cfg.SITE_CONCURRENCY);
    const total = discovered.urls.length;
    await Promise.all(
      rest.map((url, i) =>
        sem.run(async () => {
          if (Date.now() > deadline || h.signal?.aborted) {
            pagesSkipped++;
            truncated = true;
            return;
          }
          try {
            const cap = await capture(url, i + 1, total);
            if (pages.some((p) => p.capture.finalUrl === cap.finalUrl)) {
              pagesSkipped++;
              return;
            }
            const done = await finishPage(cap, i + 1);
            pages.push(done);
            h.emit({ type: 'page_done', data: { url: done.outcome.url, scores: pageScores(done.outcome), findingCount: done.outcome.findings.length } });
          } catch (e) {
            if (e instanceof CancelledError) throw e;
            pagesSkipped++;
            const code = e instanceof ScanError ? e.code : 'SCAN_FAILED';
            notes.push(`${new URL(url).pathname} was skipped (${code.toLowerCase().replace(/_/g, ' ')}).`);
            h.emit({ type: 'page_done', data: { url, scores: {}, findingCount: 0 } });
          }
        }),
      ),
    );
    if (Date.now() > deadline) notes.push(`The scan stopped at its ${Math.round(cfg.SITE_BUDGET_MS / 60000)}-minute time budget.`);
    pages.sort((a, b) => a.index - b.index);
    addDuplicateTitles(pages);
  }
  checkAbort();

  /* 6. Performance */
  const perfResults = await step('Measure performance', async () => {
    const out: { page: Captured; result: PerfResult | null }[] = [];
    for (const p of pages) {
      if (!p.perf) continue;
      const r = await p.perf;
      notes.push(...r.notes.filter((n) => !notes.includes(n)));
      out.push({ page: p, result: r.result });
    }
    return out;
  });
  for (const { page, result } of perfResults) {
    if (!result) continue;
    const lh = lighthouseFindings(result, page.outcome.url);
    page.outcome.findings.push(...lh);
    for (const f of lh) page.outcome.counts[f.ruleId] = (page.outcome.counts[f.ruleId] ?? 0) + 1;
    page.outcome.perfScore = result.score;
    page.outcome.metrics = result.metrics;
  }
  const ran = perfResults.filter((r): r is { page: Captured; result: PerfResult } => !!r.result);
  let perf: { score: number; source: 'psi' | 'lighthouse' | 'estimated' };
  if (ran.length) {
    perf = { score: Math.round(ran.reduce((s, r) => s + r.result.score, 0) / ran.length), source: ran[0]!.result.source };
  } else {
    const estimates = pages.map((p) => {
      const perfGroups = groupFindings(p.outcome.findings.filter((f) => f.category === 'performance'), p.outcome.counts);
      return estimatePerformance(p.capture.network, p.capture.facts, perfGroups);
    });
    perf = { score: Math.round(estimates.reduce((a, b) => a + b, 0) / estimates.length), source: 'estimated' };
  }
  const home = ran.find((r) => r.page.index === 0)?.result ?? ran[0]?.result;
  const lighthouse: Report['lighthouse'] = home
    ? {
        source: home.source === 'psi' ? 'psi' : 'local',
        performance: home.score,
        ...(home.categories?.seo !== undefined ? { seo: home.categories.seo } : {}),
        ...(home.categories?.accessibility !== undefined ? { accessibility: home.categories.accessibility } : {}),
        ...(home.categories?.bestPractices !== undefined ? { bestPractices: home.categories.bestPractices } : {}),
        metrics: home.metrics,
      }
    : undefined;

  /* 7. Brand (merged across pages by re-clustering the union) */
  const raws = pages.map((p) => p.capture.brand).filter((b): b is BrandRaw => !!b);
  const brand: BrandProfile = raws.length
    ? processBrand(raws).profile
    : emptyBrand({ favicon: first.capture.facts.head.favicon ?? undefined, themeColor: first.capture.facts.head.themeColor ?? undefined, ogImage: first.capture.facts.head.og.image ?? undefined });

  /* 8. Assemble, then AI */
  const placeholder: Report['ai'] = { status: 'skipped', summary: '', priorities: [] };
  let report = buildReport({
    mode: req.mode,
    inputUrl: req.url,
    finalUrl: first.capture.finalUrl,
    stack: detectStack(first.capture.facts, first.capture.headers),
    pages: pages.map((p) => p.outcome),
    brand,
    perf,
    lighthouse,
    ai: placeholder,
    limits: { pagesScanned: pages.length, pagesSkipped, truncated, ...(notes.length ? { notes: notes.slice(0, 20).map((n) => n.slice(0, 300)) } : {}) },
    reducedAccuracy: reduced || undefined,
  });

  checkAbort();
  const summaryCtx = { scores: report.scores, host: report.target.host, pageCount: report.pages.length };
  let advice: AiResult;
  if (!report.groups.length) {
    advice = deterministicAdvice(summaryCtx, report.groups, 'skipped', 'No issues to prioritise.');
  } else if (d.ai.available()) {
    h.emit({ type: 'ai_started', data: {} });
    advice = await step('Write prioritised advice', () => d.ai.advise(buildAiInput(report, report.groups), report.groups));
  } else {
    advice = deterministicAdvice(summaryCtx, report.groups, 'skipped', d.ai.unavailableReason?.() ?? "AI-written advice isn't available right now, so tasks use Teardown's built-in order and fix text.");
  }
  report = applyAdvice(report, advice);
  return enforcePayloadCap(report, cfg.REPORT_MAX_BYTES);
}

/** Copies AI ranks and instructions onto the report. AI never touches severity, findings or acceptance. */
export function applyAdvice(report: Report, advice: AiResult): Report {
  report.ai = {
    status: advice.status,
    ...(advice.model ? { model: advice.model.slice(0, 200) } : {}),
    summary: advice.summary.slice(0, 2000),
    priorities: advice.priorities.map((p) => ({ ...p, rationale: p.rationale.slice(0, 300) })),
    ...(advice.notes ? { notes: advice.notes.slice(0, 600) } : {}),
  };
  if (advice.status !== 'ok') return report;
  const rank = new Map(advice.priorities.map((p) => [p.groupRuleId, p]));
  const instr = new Map(advice.instructions.map((i) => [i.groupRuleId, i.instruction]));
  const ordered = orderedGroups(report);
  const top = new Set(ordered.slice(0, 10).map((g) => g.ruleId));
  for (const page of report.pages) {
    for (const f of page.findings) {
      const p = rank.get(f.ruleId);
      if (!p) continue;
      const instruction = top.has(f.ruleId) ? (instr.get(f.ruleId) ?? f.fix.summary) : f.fix.summary;
      f.ai = { priority: p.rank, rationale: p.rationale.slice(0, 300), instruction: instruction.slice(0, 600) };
    }
  }
  return report;
}

function addDuplicateTitles(pages: Captured[]) {
  const rule = RULE_BY_ID.get('seo.title.duplicate')!;
  const byTitle = new Map<string, Captured[]>();
  for (const p of pages) {
    const t = p.capture.facts.head.title.trim().toLowerCase();
    if (!t) continue;
    byTitle.set(t, [...(byTitle.get(t) ?? []), p]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      const others = group.filter((o) => o !== p).map((o) => o.outcome.url);
      const out = rule.check({
        url: p.outcome.url,
        capture: p.capture,
        brand: null,
        site: { robots: null, sitemap: null, linkChecks: [], duplicateTitleOf: others },
        primary: false,
        axeRan: false,
        axeIds: new Set(),
      });
      if (!out || Array.isArray(out)) continue;
      const f: Finding = toFinding(rule, out, p.outcome.url);
      p.outcome.findings.push(f);
      p.outcome.counts[rule.id] = 1;
    }
  }
}

function pageScores(o: PageOutcome): Record<string, number> {
  return scoresByCategory(groupFindings(o.findings, o.counts));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
