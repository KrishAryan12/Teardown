/**
 * pnpm ai:eval [--runs 3]
 *
 * Runs the fixture findings through every configured provider/model and reports JSON validity,
 * invalid-id rate, length-limit violations, median latency and median tokens. Use the results to
 * pick each provider's default model and record them in docs/DECISIONS.md.
 * Only providers with a key in the environment (.env) are called. Calls count toward nothing
 * persistent, but they do use your free-tier quota.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PageCapture } from '../src/capture/types';
import { loadConfig } from '../src/config';
import { DailyCounters } from '../src/util/daily';
import { AiChain, providersFromConfig, type Attempt } from '../src/ai/chain';
import { CircuitBreaker } from '../src/ai/breaker';
import { buildAiInput } from '../src/ai/input';
import { analyzePage } from '../src/scan/analyze';
import { buildReport } from '../src/scan/report';
import { processBrand } from '../src/brand/process';

const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 3;
const cfg = loadConfig({ ...process.env, NODE_ENV: 'test', AI_DAILY_CALLS: '100000' });
const dir = fileURLToPath(new URL('../test/fixtures/captures/', import.meta.url));

function fixtureInput(name: 'bad' | 'good') {
  const cap = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as PageCapture;
  const a = analyzePage(cap, { robots: { status: 404, body: '' }, sitemap: { found: false }, linkChecks: [] }, true);
  const report = buildReport({
    mode: 'single',
    inputUrl: cap.finalUrl,
    finalUrl: cap.finalUrl,
    stack: [{ name: 'WordPress', confidence: 'high' }],
    pages: [{ url: cap.finalUrl, title: cap.title, status: cap.status, timings: {}, screenshots: {}, findings: a.findings, counts: a.counts }],
    brand: processBrand([cap.brand!]).profile,
    perf: { score: 64, source: 'lighthouse' },
    ai: { status: 'skipped', summary: '', priorities: [] },
    limits: { pagesScanned: 1, pagesSkipped: 0, truncated: false },
  });
  return { input: buildAiInput(report, report.groups), groups: report.groups };
}

const cases = [fixtureInput('bad'), fixtureInput('good')];
const providers = providersFromConfig(cfg).filter((p) => p.apiKey);
if (!providers.length) {
  console.log('No AI provider keys found. Put GEMINI_API_KEY / GROQ_API_KEY / HF_TOKEN / OPENROUTER_API_KEY in .env and re-run.');
  process.exit(0);
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const rows: string[] = [];
for (const p of providers) {
  for (const model of p.models) {
    const attempts: Attempt[] = [];
    let ok = 0;
    let total = 0;
    for (let i = 0; i < runs; i++) {
      for (const c of cases) {
        if (c.groups.length === 0) continue;
        total++;
        // A one-model chain per run, fresh breaker, so failures don't skip later runs.
        const chain = new AiChain(cfg, new DailyCounters(), {
          providers: [{ ...p, models: [model] }],
          breaker: new CircuitBreaker(),
          onAttempt: (a) => attempts.push(a),
        });
        const r = await chain.advise(c.input, c.groups);
        if (r.status === 'ok') ok++;
      }
    }
    const answered = attempts.filter((a) => a.stats);
    const jsonValid = answered.filter((a) => a.stats!.jsonValid).length;
    const invalidIds = answered.reduce((n, a) => n + a.stats!.invalidIds, 0);
    const lengthViol = answered.reduce((n, a) => n + a.stats!.lengthViolations, 0);
    const errors = attempts.filter((a) => !a.stats).map((a) => a.error);
    rows.push(
      `| ${p.name} | ${model} | ${ok}/${total} | ${answered.length ? Math.round((jsonValid / answered.length) * 100) : 0}% | ${answered.length ? (invalidIds / answered.length).toFixed(2) : '-'} | ${answered.length ? (lengthViol / answered.length).toFixed(2) : '-'} | ${median(answered.map((a) => a.latencyMs ?? 0))} | ${median(answered.map((a) => a.tokens ?? 0).filter(Boolean))} | ${[...new Set(errors)].slice(0, 2).join('; ') || ''} |`,
    );
    console.log(rows.at(-1));
  }
}

console.log('\nAI eval results (' + new Date().toISOString().slice(0, 10) + `, ${runs} runs x ${cases.length} fixtures)\n`);
console.log('| Provider | Model | Usable reports | JSON valid | Invalid ids / reply | Length violations / reply | Median latency ms | Median tokens | Errors |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
