/**
 * Regenerates docs/RULES.md from the rule catalogue so the docs can't drift from the code.
 *   pnpm --filter @teardown/scanner exec tsx scripts/gen-rules-doc.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORY_WEIGHT, RULESET_VERSION, SEVERITY_WEIGHT, COUNT_CAP } from '@teardown/core';
import { RULES, MAX_INSTANCES, SUPERSEDED_AXE, LIGHTHOUSE_TO_RULE } from '../src/rules';

const out = fileURLToPath(new URL('../../../docs/RULES.md', import.meta.url));
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines: string[] = [];
lines.push('# Rules and scoring', '');
lines.push(`Ruleset version **${RULESET_VERSION}**. This file is generated from \`apps/scanner/src/rules\` by \`scripts/gen-rules-doc.ts\`; edit the rules, then regenerate.`, '');
lines.push('Every finding comes from a deterministic rule (or axe-core, or Lighthouse). The AI layer can reorder groups and reword instructions, but it can never add, remove or re-grade a finding, and acceptance criteria always come from the templates below.', '');

lines.push('## Scoring', '');
lines.push('Per category: start at 100 and subtract a penalty per **rule group** (all instances of one rule across the scanned pages):', '');
lines.push('```');
lines.push('penalty = weight(severity) x min(1 + log2(count), 2.5)');
lines.push(`weight: critical ${SEVERITY_WEIGHT.critical}, serious ${SEVERITY_WEIGHT.serious}, moderate ${SEVERITY_WEIGHT.moderate}, minor ${SEVERITY_WEIGHT.minor}   (cap ${COUNT_CAP}x)`);
lines.push('score = clamp(0, 100, 100 - sum(penalties))');
lines.push('```', '');
lines.push(`Overall = weighted mean: ${Object.entries(CATEGORY_WEIGHT).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
lines.push('More or worse findings never raise a score (property-tested in `packages/core/test/scoring.test.ts`).', '');
lines.push('### Performance score', '');
lines.push('The performance score is the engine score: PageSpeed Insights (if `PSI_API_KEY` is set), else local Lighthouse (mobile preset, simulated throttling, indicative lab data). If neither runs, an **estimate**:', '');
lines.push('```');
lines.push('resource = 100 - min(50, 10 x max(0, MB - 1)) - min(20, max(0, requests - 60) / 4)');
lines.push('               - min(20, 5 x render-blocking resources) - min(10, max(0, elements - 1500) / 300)');
lines.push('estimate = round(0.7 x resource + 0.3 x categoryScore(performance rule groups))');
lines.push('```', '');
lines.push('In site mode the engine runs on the home page plus up to `PERF_MAX_PAGES_FULL` pages; the report score is their mean.', '');
lines.push('### Deterministic priority (AI fallback)', '');
lines.push('Groups are ordered by `penalty x category weight`, then severity, then count. This is the order used when the AI is unavailable, and the one the AI starts from.', '');

lines.push('## Grouping and caps', '');
lines.push(`Instances are grouped by rule id. Each page keeps at most ${MAX_INSTANCES} instances per rule; the true count is kept in \`page.ruleCounts\` and drives scoring.`, '');
lines.push('Finding ids are `${ruleId}:${shortHash(pageUrl + selector)}`, stable across scans of an unchanged page.', '');

lines.push('## De-duplication', '');
lines.push('One concept is reported once. Where our own rule and axe-core overlap, our rule wins and the axe rule is skipped:', '');
lines.push(`- axe rules skipped: ${[...SUPERSEDED_AXE].sort().map((s) => `\`${s}\``).join(', ')}.`);
lines.push('- `color-contrast` stays with axe (accessibility). The UX contrast rule only reports from brand extraction when axe did not run.');
lines.push('- The SEO "image alt" check is reported once, as `a11y.img.alt` (accessibility), because it is the same fix.');
lines.push(`- Lighthouse audits covered by our rules (we keep ours): ${[...LIGHTHOUSE_TO_RULE.entries()].map(([a, r]) => `\`${a}\` → \`${r}\``).join(', ')}.`, '');

const CATS: [string, string][] = [
  ['seo', 'SEO'],
  ['accessibility', 'Accessibility'],
  ['ux', 'UX'],
  ['security', 'Security hygiene'],
  ['brand', 'Brand consistency'],
  ['performance', 'Performance (local checks)'],
];
for (const [cat, label] of CATS) {
  lines.push(`## ${label}`, '');
  lines.push('| Rule | Severity | What it checks | Fix | Acceptance |', '|---|---|---|---|---|');
  for (const r of RULES.filter((x) => x.category === cat)) {
    lines.push(`| \`${r.id}\` | ${r.severity} | **${esc(r.title)}.** ${esc(r.detail)} | ${esc(r.fix.summary)} (effort ${r.fix.effort}) | ${esc(r.fix.acceptance.join(' '))} |`);
  }
  lines.push('');
}
lines.push('## axe-core', '');
lines.push('All other axe-core violations (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice) become `a11y.axe.<axe-id>` findings. Impact maps 1:1 to severity (critical, serious, moderate, minor). The axe rule id is kept in `evidence.ref`. Common rules have hand-written fix templates; the rest use a generic template that links to the axe guidance.', '');
lines.push('## Lighthouse', '');
lines.push('Lighthouse (or PSI) audits scoring below 0.9 become `perf.lh.<audit-id>` findings: the core metrics (LCP, CLS, TBT, FCP, Speed Index) and the top opportunities with estimated savings, minus audits listed above as covered by our own rules.', '');

writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out} (${RULES.length} rules)`);
