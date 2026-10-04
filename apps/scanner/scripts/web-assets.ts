/**
 * Generates static assets for the web app:
 *   apps/web/public/schema/report-v1.json  JSON Schema of the Report (from the zod source of truth)
 *   apps/web/public/og.png                 1200x630 social preview, rendered with Playwright
 *   docs/social-preview.png                same image for the GitHub social preview
 *
 *   pnpm --filter @teardown/scanner exec tsx scripts/web-assets.ts
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { chromium } from 'playwright';
import { ReportSchema } from '@teardown/core';

const require = createRequire(import.meta.url);
const web = fileURLToPath(new URL('../../web/public/', import.meta.url));
const docs = fileURLToPath(new URL('../../../docs/', import.meta.url));

mkdirSync(join(web, 'schema'), { recursive: true });
const schema = z.toJSONSchema(ReportSchema, { target: 'draft-2020-12', io: 'input' });
writeFileSync(join(web, 'schema', 'report-v1.json'), JSON.stringify({ $id: 'teardown.report/v1', title: 'Teardown report v1', ...schema }, null, 2));
console.log('wrote schema/report-v1.json');

const font = (pkg: string, file: string) => readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file)).toString('base64');
const sample = JSON.parse(readFileSync(join(web, 'sample', 'report.json'), 'utf8'));
const shot = readFileSync(join(web, 'sample', 'desktop.webp')).toString('base64');
const pins = (sample.pages[0].findings as { severity: string; evidence: { bbox?: { x: number; y: number; viewport: string } } }[])
  .filter((f) => f.evidence.bbox?.viewport === 'desktop' && f.evidence.bbox.y < 900)
  .slice(0, 9);
const color: Record<string, string> = { critical: '#FF5043', serious: '#FF8A3D', moderate: '#F2C94C', minor: '#8FB8DE' };
const html = `<!doctype html><html><head><style>
@font-face{font-family:BS;font-weight:800;src:url(data:font/woff2;base64,${font('@fontsource/big-shoulders-display', 'big-shoulders-display-latin-800-normal.woff2')})}
@font-face{font-family:MM;src:url(data:font/woff2;base64,${font('@fontsource/martian-mono', 'martian-mono-latin-400-normal.woff2')})}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#0D2B4B;color:#CFE3F2;font-family:MM;overflow:hidden;
background-image:linear-gradient(rgba(207,227,242,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(207,227,242,.08) 1px,transparent 1px);background-size:24px 24px}
.frame{position:absolute;inset:20px;border:1.5px solid rgba(207,227,242,.4)}
h1{position:absolute;left:64px;top:70px;margin:0;font:800 132px/0.9 BS;text-transform:uppercase;color:#fff;letter-spacing:.01em}
p{position:absolute;left:68px;top:330px;width:440px;font-size:19px;line-height:1.55;margin:0}
.lab{position:absolute;left:68px;bottom:56px;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#9DB9D1}
.spec{position:absolute;right:56px;top:64px;width:560px;height:500px;border:2px solid #CFE3F2;overflow:hidden;background:#081C33}
.spec img{width:100%;display:block}
.pin{position:absolute;width:26px;height:26px;transform:translate(-50%,-50%);border:2px solid #081C33}
.leader{position:absolute;height:1.5px;background:#CFE3F2;opacity:.7;transform-origin:left center}
</style></head><body><div class="frame"></div><h1>Take any<br>website<br>apart</h1>
<p>Real-browser audits, the brand system, and a prioritised fix list your AI coding agent can execute.</p>
<div class="lab">Teardown · free · open source</div>
<div class="spec"><img src="data:image/webp;base64,${shot}">${pins
  .map((f) => {
    const x = (f.evidence.bbox!.x / 1440) * 560 + 8;
    const y = (f.evidence.bbox!.y / 1440) * 560 + 8;
    const r = f.severity === 'critical' ? 'border-radius:50%' : f.severity === 'serious' ? 'transform:translate(-50%,-50%) rotate(45deg) scale(.85)' : '';
    return `<span class="pin" style="left:${x}px;top:${y}px;background:${color[f.severity]};${r}"></span>`;
  })
  .join('')}</div></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: join(web, 'og.png') });
await browser.close();
copyFileSync(join(web, 'og.png'), join(docs, 'social-preview.png'));
console.log('wrote og.png and docs/social-preview.png');
