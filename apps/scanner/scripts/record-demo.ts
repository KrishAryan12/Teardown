/**
 * Records the teardown reveal on the sample report as docs/demo.gif for the README.
 * Requires a built site: pnpm --filter @teardown/web build
 *   pnpm --filter @teardown/scanner exec tsx scripts/record-demo.ts
 */
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
// @ts-expect-error plain JS helper shared with the web app's checks
import { serve } from '../../web/scripts/serve.mjs';

const OUT = fileURLToPath(new URL('../../../docs/demo.gif', import.meta.url));
const PORT = 3131;
const server = await serve(PORT);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Slow the page clock 3x so screenshots (~150 ms each) catch the scan line and the pins dropping.
  await page.addInitScript(() => {
    const real = performance.now.bind(performance);
    const t0 = real();
    performance.now = () => t0 + (real() - t0) / 3;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
  });
  await page.goto(`http://127.0.0.1:${PORT}/sample`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bed img', { state: 'visible' });
  // Frame the sheet: rail, specimen and fixes.
  const box = await page.locator('.sheet-grid').boundingBox();
  if (!box) throw new Error('sheet not found');
  await page.evaluate((y) => window.scrollTo(0, y - 16), box.y);
  const clip = { x: box.x, y: 16, width: Math.min(box.width, 1340), height: 760 };
  const frames: Buffer[] = [];
  const start = Date.now();
  while (Date.now() - start < 8000) {
    frames.push(await page.screenshot({ clip, type: 'png' }));
    await page.waitForTimeout(60);
  }
  // Hold the final state.
  for (let i = 0; i < 8; i++) frames.push(frames.at(-1)!);
  const resized = await Promise.all(frames.map((f) => sharp(f).resize({ width: 960 }).png().toBuffer()));
  await sharp(resized, { join: { animated: true } }).gif({ delay: 90, loop: 0, effort: 7, colours: 128 }).toFile(OUT);
  const { size } = await sharp(OUT).metadata().then(() => import('node:fs').then((fs) => fs.statSync(OUT)));
  console.log(`wrote ${OUT} (${frames.length} frames, ${Math.round(size / 1024)} KB)`);
} finally {
  await browser.close();
  server.close();
}
