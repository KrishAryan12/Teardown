import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { playwrightLaunchOptions } from './launchOptions';
import { startGuardProxy, type GuardProxy } from '../security/proxy';
import type { SsrfGuard } from '../security/guard';
import { Semaphore } from '../util/limiter';
import { log } from '../util/log';

export interface PoolOptions {
  guard: SsrfGuard;
  noSandbox: boolean;
  maxContexts: number;
}

/**
 * One persistent Chromium, restarted if it disconnects. Each scan gets fresh isolated contexts
 * (no shared storage). A semaphore caps concurrently open contexts.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private proxy: GuardProxy | null = null;
  private closed = false;
  readonly contexts: Semaphore;

  constructor(private readonly opts: PoolOptions) {
    this.contexts = new Semaphore(opts.maxContexts);
  }

  /** The guard proxy URL, started on demand. Lighthouse's Chromium uses it too. */
  async proxyUrl(): Promise<string> {
    if (!this.proxy) this.proxy = await startGuardProxy(this.opts.guard);
    return this.proxy.url;
  }

  async getBrowser(): Promise<Browser> {
    if (this.closed) throw new Error('Browser pool is closed');
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      const proxyUrl = await this.proxyUrl();
      let lastErr: unknown;
      // Retry once, per the fallback matrix.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const b = await chromium.launch(playwrightLaunchOptions(proxyUrl, this.opts.noSandbox));
          b.on('disconnected', () => {
            if (this.browser === b) this.browser = null;
            if (!this.closed) log.warn({ event: 'browser_disconnected' });
          });
          this.browser = b;
          return b;
        } catch (e) {
          lastErr = e;
          log.warn({ event: 'browser_launch_failed', attempt, error: e instanceof Error ? e.message.split('\n')[0] : String(e) });
        }
      }
      throw lastErr;
    })();
    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  /** Opens an isolated context with locked-down defaults. Caller must close it. */
  async newContext(options: BrowserContextOptions): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    return browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      timezoneId: 'UTC',
      javaScriptEnabled: true,
      ...options,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.browser?.close().catch(() => undefined);
    await this.proxy?.close().catch(() => undefined);
    this.browser = null;
    this.proxy = null;
  }
}
