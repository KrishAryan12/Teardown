/**
 * Dev CLI: run one scan without the API and write the report.
 *   pnpm --filter @teardown/scanner exec tsx scripts/scan.ts https://example.com [--site] [--out report.json]
 * Uses the same config as the server (.env is loaded by the package script when present).
 */
import { writeFileSync } from 'node:fs';
import { toAgentMarkdown } from '@teardown/core';
import { loadConfig } from '../src/config';
import { createServices } from '../src/services';
import { runScan } from '../src/scan/run';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
if (!url) {
  console.error('usage: tsx scripts/scan.ts <url> [--site] [--out file.json] [--md file.md]');
  process.exit(1);
}
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadConfig();
const services = createServices(cfg);
const t0 = Date.now();
try {
  const report = await runScan({ url, mode: args.includes('--site') ? 'site' : 'single' }, services, {
    emit: (e) => {
      if (e.type === 'step' && e.data.status !== 'running') console.log(`  ${e.data.status.padEnd(7)} ${e.data.name}${e.data.ms !== undefined ? ` (${e.data.ms} ms)` : ''}`);
      if (e.type === 'page_done') console.log(`  page    ${e.data.url} (${e.data.findingCount} findings)`);
    },
  });
  const s = report.scores;
  console.log(`\n${report.target.host}: overall ${s.overall} | perf ${s.performance.score} (${s.performance.source}) | a11y ${s.accessibility} | seo ${s.seo} | ux ${s.ux} | brand ${s.brand} | sec ${s.security}`);
  console.log(`${report.groups.length} groups, AI ${report.ai.status}${report.ai.model ? ` (${report.ai.model})` : ''}, ${Date.now() - t0} ms`);
  console.log(`\n${report.ai.summary}\n`);
  const out = flag('--out');
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  const md = flag('--md');
  if (md) writeFileSync(md, toAgentMarkdown(report));
} finally {
  await services.close();
}
