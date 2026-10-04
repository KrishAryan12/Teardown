// CI only: Lighthouse and the a11y check run against the static export with no scanner running.
// Build with NEXT_PUBLIC_SCANNER_URL=/__mock, then run this to add static /health and /api/quota
// responses so the warm-up ping succeeds instead of logging network errors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../out/__mock/', import.meta.url));
mkdirSync(`${dir}api`, { recursive: true });
writeFileSync(`${dir}health`, JSON.stringify({ ok: true, version: 'mock', queue: { running: 0, waiting: 0 } }));
const reset = new Date(Date.now() + 3600_000).toISOString();
writeFileSync(
  `${dir}api/quota`,
  JSON.stringify({
    single: { remainingHour: 5, remainingDay: 15, resetAt: reset },
    site: { remainingDay: 1, resetAt: reset, capacityAvailable: true },
    capacity: { single: true, site: true },
    aiAvailable: true,
    perfEngine: 'lighthouse',
    limits: { singlePerHour: 5, singlePerDay: 15, sitePerDay: 1, siteMaxPages: 15, pdfPerHour: 10 },
  }),
);
console.log('mock scanner responses written to out/__mock/');
