import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { allFindings, brandToTokens, defaultVerify, orderedGroups, type Finding, type Report, type Severity } from '@teardown/core';

const require = createRequire(import.meta.url);

/* ------------------------------- fonts ---------------------------------- */

let fontCss: string | null = null;
function fonts(): string {
  if (fontCss) return fontCss;
  const face = (pkg: string, family: string, file: string, weight: number) => {
    const dir = dirname(require.resolve(`${pkg}/package.json`));
    const b64 = readFileSync(join(dir, 'files', file)).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  };
  fontCss = [
    face('@fontsource/big-shoulders-display', 'Big Shoulders Display', 'big-shoulders-display-latin-700-normal.woff2', 700),
    face('@fontsource/big-shoulders-display', 'Big Shoulders Display', 'big-shoulders-display-latin-800-normal.woff2', 800),
    face('@fontsource/public-sans', 'Public Sans', 'public-sans-latin-400-normal.woff2', 400),
    face('@fontsource/public-sans', 'Public Sans', 'public-sans-latin-600-normal.woff2', 600),
    face('@fontsource/martian-mono', 'Martian Mono', 'martian-mono-latin-400-normal.woff2', 400),
  ].join('\n');
  return fontCss;
}

/* ------------------------------- helpers -------------------------------- */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!);
}

/** Only strict base64 JPEG/PNG data URLs are allowed into src attributes. */
export function safeImage(u: string | undefined): string | null {
  return u && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(u) ? u : null;
}

const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };
const CAT_LABEL: Record<string, string> = { performance: 'Performance', accessibility: 'Accessibility', seo: 'SEO', ux: 'UX', brand: 'Brand', security: 'Security' };
const safeHex = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? h : '#999999');

function perfSource(r: Report): string {
  const s = r.scores.performance.source;
  return s === 'psi' ? 'PageSpeed Insights' : s === 'lighthouse' ? 'Local lab (Lighthouse, indicative)' : 'Estimate';
}

function pin(sev: Severity, n: number | string): string {
  return `<span class="pin pin-${sev}" aria-hidden="true"><span>${esc(n)}</span></span>`;
}

/* ------------------------------- sections ------------------------------- */

function cover(r: Report): string {
  const stack = r.stack.map((s) => s.name).join(', ') || 'Not detected';
  return `<section class="cover">
  <div class="grid"></div>
  <p class="eyebrow">Teardown report</p>
  <h1>${esc(r.target.host)}</h1>
  <p class="cover-score"><span class="big">${r.scores.overall}</span><span class="of">/100 overall</span></p>
  <table class="titleblock">
    <tr><th>URL</th><td>${esc(r.target.finalUrl)}</td></tr>
    <tr><th>Date</th><td>${esc(r.generatedAt.slice(0, 16).replace('T', ' '))} UTC</td></tr>
    <tr><th>Mode</th><td>${r.mode === 'site' ? `Full site, ${r.limits.pagesScanned} pages` : 'Single page'}</td></tr>
    <tr><th>Stack</th><td>${esc(stack)}</td></tr>
    <tr><th>Ruleset</th><td>${esc(r.rulesetVersion)} · ${esc(r.schema)}</td></tr>
  </table>
</section>`;
}

function scores(r: Report): string {
  const rows: [string, number, string?][] = [
    ['Performance', r.scores.performance.score, perfSource(r)],
    ['Accessibility', r.scores.accessibility],
    ['SEO', r.scores.seo],
    ['UX', r.scores.ux],
    ['Brand', r.scores.brand],
    ['Security', r.scores.security],
  ];
  const band = (v: number) => (v >= 90 ? 'good' : v >= 50 ? 'fair' : 'poor');
  return `<section class="block">
  <h2>Scores</h2>
  <div class="readouts">${rows
    .map(
      ([label, v, note]) => `<div class="readout band-${band(v)}"><span class="r-label">${label}</span><span class="r-value">${v}</span><span class="r-bar"><i style="width:${v}%"></i></span>${note ? `<span class="r-note">${esc(note)}</span>` : ''}</div>`,
    )
    .join('')}</div>
  <h3>Summary</h3>
  <p class="summary">${esc(r.ai.summary)}</p>
  ${r.ai.status !== 'ok' ? `<p class="note">Task order and wording come from Teardown's built-in rules${r.ai.notes ? `: ${esc(r.ai.notes)}` : '.'}</p>` : `<p class="note">Task order and instructions written by ${esc(r.ai.model ?? 'an AI model')} from Teardown's rule findings.</p>`}
  ${r.reducedAccuracy ? '<p class="note warn">Reduced accuracy: the browser was unavailable, so this report comes from the page HTML only.</p>' : ''}
</section>`;
}

function specimen(r: Report, taskNo: Map<string, number>): string {
  const page = r.pages[0]!;
  const img = safeImage(page.screenshots.desktop);
  if (!img) return '';
  const size = page.screenshotSize?.desktop ?? { w: 1440, h: 900 };
  const cropH = Math.min(size.h, 2200);
  const pins = page.findings
    .filter((f) => f.evidence.bbox?.viewport === 'desktop' && f.evidence.bbox.y < cropH && taskNo.has(f.ruleId))
    .slice(0, 30);
  const seen = new Set<string>();
  const legend: Finding[] = [];
  const marks = pins
    .map((f) => {
      const b = f.evidence.bbox!;
      // Clamp so pins on the very edge stay fully inside the frame.
      const x = Math.min(98, Math.max(2, ((b.x + Math.min(b.w, 40) / 2) / size.w) * 100));
      const y = Math.min(98, Math.max(1.5, ((b.y + Math.min(b.h, 30) / 2) / cropH) * 100));
      if (!seen.has(f.ruleId)) {
        seen.add(f.ruleId);
        legend.push(f);
      }
      return `<span class="mark" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">${pin(f.severity, taskNo.get(f.ruleId)!)}</span>`;
    })
    .join('');
  return `<section class="block page-break">
  <h2>Specimen</h2>
  <p class="note">Desktop at 1440px, top ${cropH}px. Numbers match the task numbers in the fix list. Pin shape shows severity: circle critical, diamond serious, triangle moderate, square minor.</p>
  <div class="specimen" style="aspect-ratio:${size.w}/${cropH}"><img src="${img}" alt=""><div class="marks">${marks}</div></div>
  <ol class="legend">${legend
    .sort((a, b) => taskNo.get(a.ruleId)! - taskNo.get(b.ruleId)!)
    .map((f) => `<li>${pin(f.severity, taskNo.get(f.ruleId)!)} ${esc(f.title)}</li>`)
    .join('')}</ol>
</section>`;
}

function brandSheet(r: Report): string {
  const b = r.brand;
  if (!b.colors.length && !b.fonts.length) return '';
  const tokens = brandToTokens(b);
  const maxSpace = Math.max(1, ...b.spacing.values.map((v) => v.px));
  return `<section class="block page-break">
  <h2>Brand sheet</h2>
  <h3>Palette</h3>
  <div class="swatches">${b.colors
    .slice(0, 12)
    .map((c) => `<div class="swatch"><i style="background:${safeHex(c.hex)}"></i><span class="mono">${esc(c.hex)}</span><span>${esc(c.role ?? 'other')} · ${c.share < 0.01 ? '<1' : Math.round(c.share * 100)}%</span></div>`)
    .join('')}</div>
  <h3>Type</h3>
  <div class="specimens">${b.fonts
    .slice(0, 4)
    .map((f) => `<div class="fontcard"><p class="sample" style="font-family:${esc(f.fallbackStack.replace(/[;{}]/g, ''))}">Aa Bb Cc 123</p><p><strong>${esc(f.family)}</strong> · ${esc(f.source)} · ${esc(f.usedFor.join(', '))} · weights ${esc(f.weights.join(', '))}</p></div>`)
    .join('')}</div>
  ${b.typeScale.length ? `<p class="mono small">Sizes: ${b.typeScale.map((t) => `${t.px}px`).join(' · ')}${b.typeScaleRatio ? ` (ratio ~${b.typeScaleRatio})` : ''}</p>` : ''}
  <h3>Spacing${b.spacing.baseUnit ? ` (base ${b.spacing.baseUnit}px, ${Math.round(b.spacing.onGridRatio * 100)}% on grid)` : ' (no consistent grid)'}</h3>
  <div class="ruler">${b.spacing.values
    .slice(0, 14)
    .map((v) => `<div><i style="width:${Math.max(1, (v.px / maxSpace) * 110).toFixed(1)}mm"></i><span class="mono">${v.px}px × ${v.count}</span></div>`)
    .join('')}</div>
  ${b.radii.length ? `<h3>Radii</h3><div class="radii">${b.radii.slice(0, 8).map((x) => `<div><i style="border-radius:${Math.min(x.px, 40)}px"></i><span class="mono">${x.px >= 9999 ? 'pill' : x.px + 'px'}</span></div>`).join('')}</div>` : ''}
  ${
    b.contrast.some((c) => !c.passAA)
      ? `<h3>Contrast pairs failing AA</h3><table class="data"><tr><th>Text</th><th>Background</th><th>Ratio</th><th>Uses</th></tr>${b.contrast
          .filter((c) => !c.passAA)
          .slice(0, 8)
          .map((c) => `<tr><td><i class="chip" style="background:${safeHex(c.fg)}"></i>${esc(c.fg)}</td><td><i class="chip" style="background:${safeHex(c.bg)}"></i>${esc(c.bg)}</td><td class="mono">${c.ratio}:1</td><td>${c.count}</td></tr>`)
          .join('')}</table>`
      : ''
  }
  <h3>Tokens</h3>
  <pre class="code">${esc(Object.entries(tokens.color).slice(0, 8).map(([k, v]) => `--color-${k}: ${v.value};`).join('\n'))}</pre>
</section>`;
}

function fixes(r: Report, taskNo: Map<string, number>): string {
  const byId = new Map(allFindings(r).map((f) => [f.id, f]));
  const groups = orderedGroups(r);
  return `<section class="block page-break">
  <h2>Fixes, in priority order</h2>
  ${groups
    .map((g) => {
      const items = g.findingIds.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
      const f = items[0];
      if (!f) return '';
      const n = taskNo.get(g.ruleId)!;
      return `<article class="task">
    <h3>${pin(g.worstSeverity, n)} T${n}. ${esc(g.title)}</h3>
    <p class="meta">${SEV_LABEL[g.worstSeverity]} · ${CAT_LABEL[g.category]} · effort ${esc(f.fix.effort)} · ${g.count} instance${g.count > 1 ? 's' : ''}</p>
    <p>${esc(f.detail)}</p>
    ${f.evidence.measured || f.evidence.expected ? `<p class="mono small">Now: ${esc(f.evidence.measured ?? 'n/a')} → target: ${esc(f.evidence.expected ?? 'n/a')}</p>` : ''}
    <p><strong>Do this:</strong> ${esc(f.ai?.instruction ?? f.fix.summary)}</p>
    ${f.fix.steps.length ? `<ol class="steps">${f.fix.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <p class="label">Acceptance criteria</p>
    <ul class="checks">${f.fix.acceptance.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    <p class="small"><strong>Verify:</strong> ${esc(defaultVerify(f))}</p>
    ${items.some((i) => i.evidence.selector) ? `<p class="mono small where">${items.slice(0, 4).map((i) => esc(i.evidence.selector ?? new URL(i.pageUrl).pathname)).join('<br>')}${g.count > 4 ? `<br>and ${g.count - 4} more` : ''}</p>` : ''}
  </article>`;
    })
    .join('')}
</section>`;
}

function caveats(r: Report): string {
  return `<section class="block page-break">
  <h2>Scan limits and caveats</h2>
  <ul>
    <li>${r.limits.pagesScanned} page${r.limits.pagesScanned === 1 ? '' : 's'} scanned${r.limits.pagesSkipped ? `, ${r.limits.pagesSkipped} skipped` : ''}${r.limits.truncated ? ' (stopped at the page or time cap)' : ''}.</li>
    <li>Performance: ${esc(perfSource(r))}.${r.scores.performance.source !== 'psi' ? ' Lab numbers from shared hardware are indicative, not field data.' : ''}</li>
    ${(r.limits.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('')}
    <li>Automated checks find only part of WCAG. Test with a keyboard and a screen reader too.</li>
    <li>Teardown can't judge copy quality, business logic, content accuracy or anything behind a login.</li>
  </ul>
  <p class="note">The same report is available as JSON (machine-readable, schema ${esc(r.schema)}) and as a Markdown agent brief that an AI coding agent can execute task by task. Export them from the report page.</p>
</section>`;
}

/* -------------------------------- styles -------------------------------- */

const CSS = `
@page{size:A4;margin:20mm 18mm 18mm}@page :first{margin:0}
:root{--ink:#0D2B4B;--deep:#081C33;--chalk:#CFE3F2;--paper:#ffffff;--muted:#4a5d72;--line:#c9d6e3;
--critical:#C7362B;--serious:#C55A12;--moderate:#9A7400;--minor:#3E6E9C;--pass:#1F7A52}
*{box-sizing:border-box}
html{font:10pt/1.5 'Public Sans',Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0}
h1,h2,h3{font-family:'Big Shoulders Display','Arial Narrow',sans-serif;font-weight:800;letter-spacing:.01em;margin:0 0 6pt}
h2{font-size:22pt;border-bottom:2px solid var(--ink);padding-bottom:3pt;margin-bottom:10pt}
h3{font-size:14pt;margin-top:12pt}
.mono,pre,code{font-family:'Martian Mono',Consolas,monospace;font-size:7.5pt}
.small{font-size:8pt}
.note{color:var(--muted);font-size:8.5pt}
.warn{color:var(--critical)}
.page-break{break-before:page}
.block{padding:0}
.cover{position:relative;height:297mm;background:var(--ink);color:var(--chalk);padding:24mm 20mm;overflow:hidden;break-after:page}
.cover .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(207,227,242,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(207,227,242,.08) 1px,transparent 1px);background-size:8mm 8mm}
.cover>*{position:relative}
.eyebrow{font-family:'Martian Mono',monospace;font-size:9pt;letter-spacing:.2em;text-transform:uppercase;margin:0 0 8mm}
.cover h1{font-size:44pt;line-height:1.05;word-break:break-all;color:#fff}
.cover-score{margin:14mm 0}
.cover-score .big{font-family:'Big Shoulders Display',sans-serif;font-weight:800;font-size:96pt;line-height:1;color:#fff}
.cover-score .of{font-family:'Martian Mono',monospace;font-size:11pt;margin-left:4mm}
.titleblock{position:absolute;left:20mm;right:20mm;bottom:24mm;border:1.5px solid var(--chalk);border-collapse:collapse;width:auto}
.titleblock th,.titleblock td{border:1px solid rgba(207,227,242,.5);padding:5pt 8pt;text-align:left;vertical-align:top;font-size:9pt}
.titleblock th{font-family:'Martian Mono',monospace;font-weight:400;width:24mm;text-transform:uppercase;letter-spacing:.1em;font-size:7.5pt}
.titleblock td{word-break:break-all}
.readouts{display:grid;grid-template-columns:repeat(3,1fr);gap:6pt;margin-bottom:10pt}
.readout{border:1.5px solid var(--ink);padding:6pt 8pt;display:flex;flex-direction:column;gap:2pt}
.r-label{font-family:'Martian Mono',monospace;font-size:7pt;text-transform:uppercase;letter-spacing:.1em}
.r-value{font-family:'Big Shoulders Display',sans-serif;font-weight:800;font-size:28pt;line-height:1}
.r-bar{height:4pt;background:var(--line)}.r-bar i{display:block;height:100%;background:var(--ink)}
.band-good .r-bar i{background:var(--pass)}.band-fair .r-bar i{background:var(--moderate)}.band-poor .r-bar i{background:var(--critical)}
.r-note{font-size:7pt;color:var(--muted)}
.summary{font-size:11pt;max-width:160mm}
.specimen{position:relative;width:100%;overflow:hidden;border:1.5px solid var(--ink)}
.specimen img{position:absolute;top:0;left:0;width:100%;height:auto}
.marks{position:absolute;inset:0}
.mark{position:absolute;transform:translate(-50%,-50%)}
.pin{display:inline-flex;align-items:center;justify-content:center;width:14pt;height:14pt;color:#fff;font-family:'Martian Mono',monospace;font-size:6.5pt;vertical-align:middle;position:relative}
.pin span{position:relative;z-index:1}
.pin::before{content:'';position:absolute;inset:0;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.pin-critical::before{background:var(--critical);border-radius:50%}
.pin-serious::before{background:var(--serious);transform:rotate(45deg) scale(.82)}
.pin-moderate::before{background:var(--moderate);clip-path:polygon(50% 0,100% 100%,0 100%);border:0;box-shadow:none}
.pin-moderate span{top:2pt}
.pin-minor::before{background:var(--minor)}
.legend{list-style:none;padding:0;columns:2;margin-top:8pt}.legend li{margin:0 0 4pt;break-inside:avoid}
.swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:6pt}
.swatch{display:flex;flex-direction:column;font-size:8pt}.swatch i{display:block;height:16mm;border:1px solid var(--line);margin-bottom:3pt}
.specimens{display:grid;grid-template-columns:1fr 1fr;gap:6pt}
.fontcard{border:1px solid var(--line);padding:6pt}.fontcard .sample{font-size:22pt;margin:0 0 4pt}.fontcard p{margin:0;font-size:8pt}
.ruler div{display:flex;align-items:center;gap:6pt;margin:2pt 0}.ruler i{display:block;height:6pt;background:var(--ink);min-width:2pt;max-width:110mm}
.radii{display:flex;gap:10pt;flex-wrap:wrap}.radii div{display:flex;flex-direction:column;align-items:center;gap:2pt}.radii i{display:block;width:16mm;height:12mm;border:1.5px solid var(--ink)}
table.data{border-collapse:collapse;width:100%;font-size:8.5pt}table.data th,table.data td{border-bottom:1px solid var(--line);padding:3pt 4pt;text-align:left}
.chip{display:inline-block;width:8pt;height:8pt;border:1px solid var(--line);margin-right:4pt;vertical-align:middle}
pre.code{background:#f2f6fa;border:1px solid var(--line);padding:6pt;white-space:pre-wrap;word-break:break-all}
.task{border-top:1px solid var(--line);padding:8pt 0;break-inside:avoid-page}
.task h3{font-size:13pt;margin:0 0 2pt;display:flex;gap:6pt;align-items:center}
.meta{font-family:'Martian Mono',monospace;font-size:7pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 4pt}
.task p{margin:0 0 4pt}
.label{font-weight:600;font-size:8.5pt}
.steps,.checks{margin:0 0 4pt;padding-left:14pt}.checks{list-style:'☐  '}
.where{color:var(--muted);word-break:break-all}
`;

export function reportHtml(r: Report): string {
  const groups = orderedGroups(r);
  const taskNo = new Map(groups.map((g, i) => [g.ruleId, i + 1]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Teardown: ${esc(r.target.host)}</title>
<style>${fonts()}${CSS}</style></head><body>
${cover(r)}${scores(r)}${specimen(r, taskNo)}${brandSheet(r)}${fixes(r, taskNo)}${caveats(r)}
</body></html>`;
}
