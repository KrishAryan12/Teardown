import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { SsrfGuard } from '../../src/security/guard';
import { BrowserPool } from '../../src/browser/pool';
import { capturePage } from '../../src/capture/page';
import type { PageCapture } from '../../src/capture/types';
import { startFixtureServer, type FixtureServer } from '../../scripts/fixtureServer';

describe('page capture (M2)', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let bad: PageCapture;
  const cfg = loadConfig({ ...process.env, ALLOW_PRIVATE_TARGETS: 'true', NODE_ENV: 'test' });

  beforeAll(async () => {
    server = await startFixtureServer();
    const guard = new SsrfGuard({ allowPrivate: true });
    pool = new BrowserPool({ guard, noSandbox: true, maxContexts: 2 });
    bad = await capturePage(`${server.origin}/bad.html`, Date.now() + 60_000, {
      pool,
      guard,
      cfg,
      mobile: true,
      mobileScreenshot: true,
      desktopScreenshot: true,
      quality: 65,
    });
  });

  afterAll(async () => {
    await pool?.close();
    await server?.close();
  });

  it('produces desktop and mobile screenshots', () => {
    expect(bad.screenshots.desktop?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(bad.screenshots.desktop!.w).toBe(1440);
    expect(bad.screenshots.mobile?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(bad.screenshots.mobile!.w).toBe(390);
  });

  it('produces a network summary', () => {
    const n = bad.network!;
    expect(n.requests).toBeGreaterThanOrEqual(4);
    expect(n.transferBytes).toBeGreaterThan(200_000);
    expect(n.imageFormats.png).toBeGreaterThanOrEqual(1);
    expect(n.uncompressed.length).toBeGreaterThanOrEqual(1);
  });

  it('collects facts, brand data, mobile facts and axe results', () => {
    expect(bad.status).toBe(200);
    expect(bad.facts.head.title).toBe('Hi');
    expect(bad.facts.headings.filter((h) => h.level === 1)).toHaveLength(0);
    expect(bad.facts.images.some((i) => i.alt === null)).toBe(true);
    expect(bad.brand!.contrast.some((c) => c.ratio < 4.5)).toBe(true);
    expect(bad.mobile!.overflow).toBe(true);
    expect(bad.axe!.length).toBeGreaterThan(0);
    expect(bad.facts.renderBlocking.length).toBeGreaterThanOrEqual(2);
  });
});
