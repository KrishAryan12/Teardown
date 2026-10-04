import type { LaunchOptions } from 'playwright';

/**
 * Chromium flags shared by the Playwright browser and the Lighthouse Chromium.
 * All traffic goes through the SSRF-guarding proxy; `<-loopback>` stops Chromium's implicit
 * loopback bypass so localhost requests also reach (and are refused by) the proxy.
 */
export function chromiumFlags(proxyUrl: string, noSandbox: boolean): string[] {
  return [
    `--proxy-server=${proxyUrl}`,
    '--proxy-bypass-list=<-loopback>',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--metrics-recording-only',
    '--mute-audio',
    '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions,DnsOverHttps',
    '--dns-prefetch-disable',
    '--disable-quic',
    ...(noSandbox ? ['--no-sandbox'] : []),
  ];
}

export function playwrightLaunchOptions(proxyUrl: string, noSandbox: boolean): LaunchOptions {
  return {
    headless: true,
    // Passed as raw flags (not Playwright's `proxy` option) so the bypass list is exactly ours.
    args: chromiumFlags(proxyUrl, noSandbox),
    chromiumSandbox: !noSandbox,
    timeout: 30_000,
  };
}
