import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from 'playwright';
import { chromiumFlags } from '../browser/launchOptions';
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
 * Runs Lighthouse (performance only, mobile preset, default simulated throttling) against a fresh
 * headless Chromium from Playwright's install, routed through the SSRF guard proxy.
 * chrome-launcher creates a temporary profile and deletes it on kill.
 */
export async function runLocalLighthouse(url: string, o: LocalLighthouseOptions): Promise<PerfResult> {
  return lighthouseMutex.run(async () => {
    const started = Date.now();
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ['--headless=new', ...chromiumFlags(o.proxyUrl, o.noSandbox)],
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
