import type { Config } from './config';
import { SsrfGuard } from './security/guard';
import { BrowserPool } from './browser/pool';
import { PerfEngine } from './perf/engine';
import { DailyCounters } from './util/daily';
import { AiChain } from './ai/chain';

/** Long-lived singletons shared by the API and CLI scripts. */
export function createServices(cfg: Config, opts: { counters?: DailyCounters } = {}) {
  const guard = new SsrfGuard({ allowPrivate: cfg.ALLOW_PRIVATE_TARGETS });
  const pool = new BrowserPool({ guard, noSandbox: cfg.BROWSER_NO_SANDBOX, maxContexts: cfg.MAX_CONCURRENT_SCANS * 2 });
  const counters = opts.counters ?? new DailyCounters();
  const perf = new PerfEngine({ cfg, counters, proxyUrl: () => pool.proxyUrl() });
  const ai = new AiChain(cfg, counters);
  return {
    cfg,
    guard,
    pool,
    counters,
    perf,
    ai,
    close: () => pool.close(),
  };
}

export type Services = ReturnType<typeof createServices>;
