import { chromiumFlags } from '../browser/launchOptions';
import { browserExecutable } from '../browser/executable';
import { Mutex, withTimeout } from '../util/limiter';
import { fromLhr } from './lhr';
import type { PerfResult } from './types';

/** One Lighthouse run at a time across all scans: it is CPU-heavy and the free host is small. */
export const lighthouseMutex = new Mutex();

export interface LocalLighthouseOptions {
  proxyUrl: string;
  noSandbox: boolean;
  timeoutMs: number;
  userAgent: string;
}

/**
 * Lighthouse and chrome-launcher are loaded at runtime with non-literal specifiers so bundlers
 * leave them out. The Docker image installs them; the Vercel function doesn't ship them (it uses
 * PageSpeed Insights or the estimate), so the import fails there and the engine falls back.
 */
async function load<T>(name: string): Promise<T> {
  return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as T;
}

/**
 * Runs Lighthouse (performance only, mobile preset, default simulated throttling) against a fresh
 * headless Chromium, routed through the SSRF guard proxy. chrome-launcher creates a temporary
 * profile and deletes it on kill.
 */
export async function runLocalLighthouse(url: string, o: LocalLighthouseOptions): Promise<PerfResult> {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
    load<{ default: (url: string, flags: Record<string, unknown>) => Promise<{ lhr: unknown } | undefined> }>('lighthouse'),
    load<{ launch: (o: Record<string, unknown>) => Promise<{ port: number; kill: () => void }> }>('chrome-launcher'),
  ]);
  return lighthouseMutex.run(async () => {
    const started = Date.now();
    const exe = await browserExecutable();
    const chrome = await chromeLauncher.launch({
      chromePath: exe.path,
      chromeFlags: ['--headless=new', ...exe.args, ...chromiumFlags(o.proxyUrl, o.noSandbox)],
      logLevel: 'silent',
      connectionPollInterval: 250,
      maxConnectionRetries: 80,
    });
    try {
      const run = lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        formFactor: 'mobile',
        throttlingMethod: 'simulate',
        emulatedUserAgent: o.userAgent,
        maxWaitForLoad: 45_000,
        disableFullPageScreenshot: true,
      });
      const result = await withTimeout(run, o.timeoutMs, () => new Error('Lighthouse timed out'));
      if (!result?.lhr) throw new Error('Lighthouse returned no result');
      return fromLhr(result.lhr as never, 'lighthouse', Date.now() - started);
    } finally {
      try {
        chrome.kill();
      } catch {
        /* already gone */
      }
    }
  });
}
