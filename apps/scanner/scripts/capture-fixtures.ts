/**
 * Captures fixtures/pages/{bad,good}.html with the real browser pipeline and stores the result
 * (minus screenshots) in test/fixtures/captures/. Rule unit tests run against these files, so
 * they exercise real collector output without launching a browser.
 *
 *   pnpm --filter @teardown/scanner exec tsx scripts/capture-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config';
import { SsrfGuard } from '../src/security/guard';
import { BrowserPool } from '../src/browser/pool';
import { capturePage } from '../src/capture/page';
import { startFixtureServer } from './fixtureServer';

export const FIXTURE_ORIGIN = 'https://fixture.test';

const outDir = fileURLToPath(new URL('../test/fixtures/captures/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const cfg = loadConfig({ ...process.env, ALLOW_PRIVATE_TARGETS: 'true', NODE_ENV: 'test' });
const server = await startFixtureServer();
const guard = new SsrfGuard({ allowPrivate: true });
const pool = new BrowserPool({ guard, noSandbox: true, maxContexts: 2 });
try {
  for (const name of ['bad', 'good']) {
    const c = await capturePage(`${server.origin}/${name}.html`, Date.now() + 90_000, {
      pool,
      guard,
      cfg,
      mobile: true,
      mobileScreenshot: false,
      desktopScreenshot: false,
      quality: 60,
    });
    const json = JSON.stringify({ ...c, rawHtml: c.rawHtml.slice(0, 2000), screenshots: {} }, null, 1).replaceAll(server.origin, FIXTURE_ORIGIN);
    writeFileSync(`${outDir}${name}.json`, json + '\n');
    console.log(`captured ${name}: ${c.timings.total}ms`);
  }
} finally {
  await pool.close();
  await server.close();
}
