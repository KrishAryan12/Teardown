import { afterEach, describe, expect, it, vi } from 'vitest';
import { isServerless, serverlessArgs } from '../../src/browser/executable';

// @sparticuz/chromium 153 defaults, as printed by `chromium.args`.
const SPARTICUZ_ARGS = [
  '--ash-no-nudges',
  '--disable-domain-reliability',
  '--disable-print-preview',
  '--disk-cache-size=33554432',
  '--no-default-browser-check',
  '--no-pings',
  '--single-process',
  '--font-render-hinting=none',
  '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
  '--enable-features=SharedArrayBuffer',
  '--ignore-gpu-blocklist',
  '--in-process-gpu',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--allow-running-insecure-content',
  '--disable-setuid-sandbox',
  '--disable-site-isolation-trials',
  '--disable-web-security',
  "--headless='shell'",
  '--no-sandbox',
  '--no-zygote',
];

describe('serverlessArgs', () => {
  const args = serverlessArgs(SPARTICUZ_ARGS);

  it('drops --single-process, which kills the browser when a context closes', () => {
    expect(args).not.toContain('--single-process');
  });

  it('drops flags that weaken web security for hostile pages', () => {
    for (const f of ['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials']) {
      expect(args).not.toContain(f);
    }
  });

  it('drops headless and feature flags (ours win)', () => {
    expect(args.some((a) => a.startsWith('--headless') || a.startsWith('--disable-features'))).toBe(false);
  });

  it('keeps the flags the binary needs to run sandboxless with software GL', () => {
    for (const f of ['--no-sandbox', '--no-zygote', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--in-process-gpu']) {
      expect(args).toContain(f);
    }
  });
});

describe('isServerless', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is true on Vercel unless forced off', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('CHROMIUM_SERVERLESS', '');
    expect(isServerless()).toBe(true);
    vi.stubEnv('CHROMIUM_SERVERLESS', '0');
    expect(isServerless()).toBe(false);
  });

  it('is false locally unless forced on', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CHROMIUM_SERVERLESS', '');
    expect(isServerless()).toBe(false);
    vi.stubEnv('CHROMIUM_SERVERLESS', '1');
    expect(isServerless()).toBe(true);
  });
});
