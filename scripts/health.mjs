#!/usr/bin/env node
// Smoke test for a running Teardown deployment (Vercel, `next start`, or the Docker scanner).
//   pnpm health                                    -> http://localhost:3000
//   pnpm health https://your-app.vercel.app
//   pnpm health https://your-app.vercel.app --scan https://example.com
// Checks /api/health, /api/quota and that private targets are refused. With --scan it also runs one
// real scan through POST /api/scan/stream and checks the event stream. Exits non-zero on failure.
const args = process.argv.slice(2);
const scanAt = args.indexOf('--scan');
const scanUrl = scanAt >= 0 ? args[scanAt + 1] : undefined;
const positional = args.filter((a, i) => !a.startsWith('--') && (scanAt < 0 || i !== scanAt + 1));
const base = (positional[0] || process.env.SCANNER_URL || 'http://localhost:3000').replace(/\/+$/, '');
let failed = false;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}: ${e.message}`);
  }
};

await check('GET /api/health', async () => {
  const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(90_000) });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`HTTP ${r.status}`);
  return `version ${j.version}, scans running ${j.queue.running}`;
});
await check('GET /api/quota', async () => {
  const r = await fetch(`${base}/api/quota`);
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `AI ${j.aiAvailable ? 'available' : 'unavailable'}, perf engine ${j.perfEngine}, ${j.single.remainingHour} single scans left this hour`;
});
for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/']) {
  await check(`refuses ${target}`, async () => {
    const r = await fetch(`${base}/api/scan/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target, mode: 'single' }) });
    const j = await r.json();
    if (j.error?.code !== 'BLOCKED_TARGET') throw new Error(`expected BLOCKED_TARGET, got ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  });
}

if (scanUrl) {
  await check(`scan ${scanUrl}`, async () => {
    const t0 = Date.now();
    const r = await fetch(`${base}/api/scan/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: scanUrl, mode: 'single', fresh: true }),
      signal: AbortSignal.timeout(310_000),
    });
    if (!(r.headers.get('content-type') ?? '').includes('text/event-stream')) {
      throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    }
    const decoder = new TextDecoder();
    let buf = '';
    let report;
    let error;
    const seen = [];
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = raw.match(/^event: (.+)$/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (!type) continue; // heartbeat comment
        seen.push(type);
        const parsed = data ? JSON.parse(data) : {};
        if (type === 'step' && parsed.status !== 'running') console.log(`    · ${parsed.name}${parsed.ms != null ? ` (${parsed.ms} ms)` : ''}`);
        if (type === 'report') report = parsed.report;
        if (type === 'error') error = parsed;
      }
    }
    if (error) throw new Error(`${error.code}: ${error.message}`);
    if (!report) throw new Error(`no report (events: ${seen.join(', ')})`);
    if (seen.at(-1) !== 'done') throw new Error('stream ended without a done event');
    const shots = Object.values(report.pages?.[0]?.screenshots ?? {}).filter(Boolean).length;
    return `${((Date.now() - t0) / 1000).toFixed(0)} s, overall ${report.scores.overall}, ${report.groups.length} groups, perf ${report.scores.performance.source}, AI ${report.ai.status}, screenshots ${shots}${report.reducedAccuracy ? ', REDUCED ACCURACY (browser fallback)' : ''}`;
  });
}
process.exit(failed ? 1 : 0);
