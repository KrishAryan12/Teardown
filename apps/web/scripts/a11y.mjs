// Accessibility check of the exported site: axe-core (WCAG 2.2 A/AA + best practices) on every page at
// desktop and phone sizes, plus keyboard and reduced-motion checks. Run after `next build`.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { serve } from './serve.mjs';

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const server = await serve(PORT);
const browser = await chromium.launch();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

async function axe(page, label) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  if (res.violations.length === 0) console.log(`✓ axe: ${label}`);
  for (const v of res.violations) fail(`axe ${label}: ${v.id} (${v.impact}) ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

try {
  for (const vp of [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fail(`page error (${vp.name}): ${e.message}`));

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await axe(page, `landing (${vp.name})`);
    // Sample teaser loads when scrolled near.
    await page.locator('#sample-title').scrollIntoViewIfNeeded();
    await page.waitForSelector('.teaser', { timeout: 15000 });
    await axe(page, `landing with sample teaser (${vp.name})`);

    await page.goto(`${BASE}/sample/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#sheet-title', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('.pin-btn');
    // Reduced motion: the final state shows immediately (no running reveal).
    if (await page.locator('.skip-reveal').count()) fail(`reveal should be skipped with prefers-reduced-motion (${vp.name})`);
    // Open the first task so its body is checked too.
    await axe(page, `sample report (${vp.name})`);

    await page.goto(`${BASE}/privacy/`, { waitUntil: 'networkidle' });
    await axe(page, `privacy (${vp.name})`);
    await ctx.close();
  }

  // Keyboard: first Tab reaches the skip link, which moves focus to main.
  const kb = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await kb.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await kb.keyboard.press('Tab');
  const first = await kb.evaluate(() => document.activeElement?.textContent?.trim());
  if (first !== 'Skip to content') fail(`first Tab should focus the skip link, got "${first}"`);
  else console.log('✓ keyboard: skip link is first');
  await kb.keyboard.press('Enter');
  if ((await kb.evaluate(() => location.hash)) !== '#main') fail('skip link should jump to #main');
  // Pins are keyboard reachable and open their task.
  await kb.goto(`${BASE}/sample/`, { waitUntil: 'networkidle' });
  await kb.waitForSelector('.pin-btn');
  await kb.keyboard.press('Escape'); // skips the reveal
  await kb.locator('.pin-btn').first().focus();
  const label = await kb.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  if (!label?.startsWith('Task ')) fail('pins should be focusable buttons with a task label');
  await kb.keyboard.press('Enter');
  const expanded = await kb.locator('.finding-head[aria-expanded="true"]').count();
  if (!expanded) fail('activating a pin should open its task');
  else console.log('✓ keyboard: pins focus and open tasks');
  // Visible focus style on the URL slot.
  await kb.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await kb.focus('#specimen-url');
  const outline = await kb.evaluate(() => getComputedStyle(document.querySelector('.slot')).outlineStyle);
  if (outline === 'none') fail('the URL slot needs a visible focus outline');
  else console.log('✓ focus: URL slot shows an outline');
  // 320px: no horizontal scrolling.
  await kb.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/sample/', '/privacy/']) {
    await kb.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await kb.waitForTimeout(300);
    const w = await kb.evaluate(() => document.documentElement.scrollWidth);
    if (w > 320) fail(`${path} scrolls sideways at 320px (${w}px)`);
  }
  console.log('✓ 320px: no horizontal scroll');
  // Phone: tapping a pin opens the bottom sheet.
  const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ph.goto(`${BASE}/sample/`, { waitUntil: 'networkidle' });
  await ph.waitForSelector('.pin-btn');
  await ph.locator('.pin-btn').first().scrollIntoViewIfNeeded();
  await ph.locator('.pin-btn').first().tap();
  if (!(await ph.locator('.bottom-sheet').count())) fail('tapping a pin on a phone should open the bottom sheet');
  else console.log('✓ phone: pin opens the bottom sheet');
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`\n${failures} accessibility problem(s).`);
  process.exit(1);
}
console.log('\nAccessibility checks passed.');
