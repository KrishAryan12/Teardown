/**
 * pnpm sample:generate
 *
 * Scans fixtures/pages/sample with the real pipeline (browser, rules, Lighthouse, AI if keys are
 * set) and writes the landing-page sample to apps/web/public/sample/:
 *   report.json   the Report, with screenshots replaced by URLs below
 *   desktop.webp  desktop screenshot
 *   mobile.webp   mobile screenshot
 * The local fixture origin is rewritten to https://kilnandco.example.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ReportSchema, computeScores, groupFindings, scoresByCategory, type Report } from '@teardown/core';
import { deterministicAdvice } from '../src/ai/fallback';
import { applyAdvice, runScan } from '../src/scan/run';
import { sumCounts } from '../src/scan/report';
import { loadConfig } from '../src/config';
import { createServices } from '../src/services';
import { FIXTURES_DIR, startFixtureServer } from './fixtureServer';

const OUT = fileURLToPath(new URL('../../web/public/sample/', import.meta.url));
const FAKE_ORIGIN = 'https://kilnandco.example';
/** Artefacts of serving the fixture locally (plain HTTP, made-up shop links), not flaws of the page. */
const LOCAL_ARTEFACTS = new Set(['sec.https.missing', 'sec.hsts.missing', 'seo.links.broken']);

function dropArtefacts(report: Report): Report {
  for (const p of report.pages) {
    p.findings = p.findings.filter((f) => !LOCAL_ARTEFACTS.has(f.ruleId));
    for (const k of LOCAL_ARTEFACTS) delete p.ruleCounts?.[k];
    const cats = scoresByCategory(groupFindings(p.findings, p.ruleCounts));
    p.scores = { ...cats, performance: p.scores?.performance ?? cats.performance };
  }
  report.groups = groupFindings(report.pages.flatMap((p) => p.findings), sumCounts(report.pages.map((p) => ({ counts: p.ruleCounts ?? {} }))));
  report.scores = computeScores(report.groups, report.scores.performance);
  if (report.ai.status === 'ok') {
    report.ai.priorities = report.ai.priorities.filter((p) => !LOCAL_ARTEFACTS.has(p.groupRuleId)).map((p, i) => ({ ...p, rank: i + 1 }));
    return report;
  }
  return applyAdvice(report, deterministicAdvice({ scores: report.scores, host: 'kilnandco.example', pageCount: report.pages.length }, report.groups, report.ai.status === 'skipped' ? 'skipped' : 'fallback', report.ai.notes ?? ''));
}

const cfg = loadConfig({ ...process.env, NODE_ENV: 'test', ALLOW_PRIVATE_TARGETS: 'true', CACHE_TTL_MS: '0' });
const services = createServices(cfg);
const server = await startFixtureServer(resolve(FIXTURES_DIR, 'sample'));
try {
  const report = await runScan({ url: `${server.origin}/`, mode: 'single' }, services, {
    emit: (e) => {
      if (e.type === 'step' && e.data.status !== 'running') console.log(`  ${e.data.status.padEnd(7)} ${e.data.name}`);
    },
  });
  mkdirSync(OUT, { recursive: true });
  const page = report.pages[0]!;
  for (const kind of ['desktop', 'mobile'] as const) {
    const data = page.screenshots[kind];
    if (!data) continue;
    const buf = Buffer.from(data.split(',')[1]!, 'base64');
    await sharp(buf).webp({ quality: 70 }).toFile(join(OUT, `${kind}.webp`));
    page.screenshots[kind] = `/sample/${kind}.webp`;
  }
  const host = new URL(server.origin).host;
  const json = JSON.stringify(report).replaceAll(server.origin, FAKE_ORIGIN).replaceAll(host, 'kilnandco.example');
  const fixed = JSON.parse(json);
  fixed.target.inputUrl = 'kilnandco.example';
  fixed.target.host = 'kilnandco.example';
  const parsed = ReportSchema.safeParse(dropArtefacts(fixed));
  if (!parsed.success) throw new Error(`sample report failed validation: ${parsed.error.issues[0]?.message}`);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(parsed.data));
  const s = parsed.data.scores;
  console.log(`\nsample: overall ${s.overall}, ${parsed.data.groups.length} groups, AI ${parsed.data.ai.status} -> ${OUT}`);
} finally {
  await services.close();
  await server.close();
}
