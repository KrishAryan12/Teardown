#!/usr/bin/env node
// Health check for a running scanner.
//   pnpm health                                   -> http://localhost:7860
//   pnpm health https://you-teardown-scanner.hf.space
// Checks /health, /api/quota, and that private targets are refused. Exits non-zero on failure.
const base = (process.argv[2] || process.env.SCANNER_URL || 'http://localhost:7860').replace(/\/+$/, '');
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

await check('GET /health', async () => {
  const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90_000) });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`HTTP ${r.status}`);
  return `version ${j.version}, running ${j.queue.running}, waiting ${j.queue.waiting}`;
});
await check('GET /api/quota', async () => {
  const r = await fetch(`${base}/api/quota`);
  const j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `AI ${j.aiAvailable ? 'available' : 'unavailable'}, perf engine ${j.perfEngine}, ${j.single.remainingHour} single scans left this hour`;
});
for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/']) {
  await check(`refuses ${target}`, async () => {
    const r = await fetch(`${base}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) });
    const j = await r.json();
    if (j.error?.code !== 'BLOCKED_TARGET') throw new Error(`expected BLOCKED_TARGET, got ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  });
}
process.exit(failed ? 1 : 0);
