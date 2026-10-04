import { chromium } from 'playwright';

export interface BrowserExecutable {
  path: string | undefined;
  /** Extra flags the binary needs (serverless Chromium ships its own). */
  args: string[];
  serverless: boolean;
}

/** True on Vercel (or when forced): use the slim serverless Chromium build. */
export function isServerless(): boolean {
  return process.env.CHROMIUM_SERVERLESS === '1' || (!!process.env.VERCEL && process.env.CHROMIUM_SERVERLESS !== '0');
}

let cached: Promise<BrowserExecutable> | null = null;

/**
 * Resolves the Chromium binary: Playwright's bundled Chromium locally and in Docker, or
 * @sparticuz/chromium (x64 Linux, extracted to /tmp on first use) on serverless hosts.
 */
export function browserExecutable(): Promise<BrowserExecutable> {
  cached ??= (async (): Promise<BrowserExecutable> => {
    if (!isServerless()) return { path: chromium.executablePath(), args: [], serverless: false };
    const mod = (await import('@sparticuz/chromium')) as unknown as { default: { executablePath(): Promise<string>; args: string[] } };
    const sp = mod.default;
    // Keep only the flags that make the binary run in a sandboxless, /tmp-only environment;
    // proxy, headless and feature flags are ours.
    const args = sp.args.filter((a) => !/^--(proxy|headless|window-size|disable-features)/.test(a));
    return { path: await sp.executablePath(), args, serverless: true };
  })();
  return cached;
}
