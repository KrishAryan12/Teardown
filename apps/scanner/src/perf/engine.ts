import type { Config } from '../config';
import { userAgent } from '../config';
import type { DailyCounters } from '../util/daily';
import { log, logHost } from '../util/log';
import { runLocalLighthouse } from './lighthouse';
import { runPsi } from './psi';
import type { PerfResult } from './types';

export type PerfEngineName = 'psi' | 'lighthouse' | 'estimated';

export interface PerfRunOutcome {
  result: PerfResult | null;
  /** Human-readable notes about fallbacks, for report.limits.notes. */
  notes: string[];
}

export interface PerfDeps {
  cfg: Config;
  counters: DailyCounters;
  proxyUrl: () => Promise<string>;
  /** Injectable for tests. */
  psi?: typeof runPsi;
  lighthouse?: typeof runLocalLighthouse;
}

/** Chooses PSI -> local Lighthouse -> estimate (null), per PERF_ENGINE. */
export class PerfEngine {
  constructor(private readonly d: PerfDeps) {}

  private psiAvailable(): boolean {
    const { cfg } = this.d;
    return !!cfg.PSI_API_KEY && (cfg.PERF_ENGINE === 'auto' || cfg.PERF_ENGINE === 'psi') && this.d.counters.has('psi', cfg.PSI_DAILY_CAP);
  }

  /** Engine that will be tried first right now (for /api/quota). */
  active(): PerfEngineName {
    if (this.d.cfg.PERF_ENGINE === 'estimate') return 'estimated';
    if (this.psiAvailable()) return 'psi';
    return 'lighthouse';
  }

  async run(url: string): Promise<PerfRunOutcome> {
    const { cfg } = this.d;
    const notes: string[] = [];
    if (cfg.PERF_ENGINE === 'estimate') return { result: null, notes: ['Performance is estimated (lab engines are switched off on this server).'] };

    if (this.psiAvailable()) {
      this.d.counters.incr('psi');
      try {
        return { result: await (this.d.psi ?? runPsi)(url, cfg.PSI_API_KEY!), notes };
      } catch (e) {
        log.warn({ event: 'psi_failed', host: logHost(url), error: e instanceof Error ? e.message.slice(0, 120) : 'unknown' });
        notes.push('PageSpeed Insights was unavailable, so local Lighthouse measured performance instead.');
      }
    } else if (cfg.PSI_API_KEY && cfg.PERF_ENGINE !== 'lighthouse') {
      notes.push("Today's PageSpeed Insights budget is used up, so local Lighthouse measured performance instead.");
    }

    try {
      const result = await (this.d.lighthouse ?? runLocalLighthouse)(url, {
        proxyUrl: await this.d.proxyUrl(),
        noSandbox: cfg.BROWSER_NO_SANDBOX,
        timeoutMs: cfg.LIGHTHOUSE_TIMEOUT_MS,
        userAgent: userAgent(cfg, true),
      });
      return { result, notes };
    } catch (e) {
      log.warn({ event: 'lighthouse_failed', host: logHost(url), error: e instanceof Error ? e.message.slice(0, 120) : 'unknown' });
      notes.push('Lighthouse could not finish, so the performance score is an estimate from page weight and requests.');
      return { result: null, notes };
    }
  }
}
