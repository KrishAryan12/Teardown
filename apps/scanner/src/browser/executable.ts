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

/**
 * Flags from @sparticuz/chromium we must not use. Proxy, headless, window and feature flags are ours.
 * `--single-process` makes closing one browser context kill the whole browser (each scan closes its
 * desktop context before the mobile pass). The web-security flags would let hostile pages read
 * cross-origin responses and load mixed content, which a scanner of untrusted sites must not allow.
 */
const DROPPED_FLAGS =
  /^--(proxy|headless|window-size|disable-features|single-process|disable-web-security|allow-running-insecure-content|disable-site-isolation-trials)\b/;

/** Keep only the serverless flags that make the binary run in a sandboxless, /tmp-only environment. */
export function serverlessArgs(args: readonly string[]): string[] {
  return args.filter((a) => !DROPPED_FLAGS.test(a));
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
    return { path: await sp.executablePath(), args: serverlessArgs(sp.args), serverless: true };
  })();
  return cached;
}
