#!/usr/bin/env node
// After `next build`: fail if a Vercel function would be missing a file the scanner reads from disk at
// runtime. The tracer only follows imports, so these are listed in next.config.ts → outputFileTracingIncludes.
import { readFileSync } from 'node:fs';

const NEEDS = [
  { name: 'playwright-core/browsers.json', re: /\.pnpm\/playwright-core@[^/]+\/node_modules\/playwright-core\/browsers\.json$/ },
];
const CHROMIUM = { name: '@sparticuz/chromium/bin (real path)', re: /\.pnpm\/@sparticuz\+chromium@[^/]+\/node_modules\/@sparticuz\/chromium\/bin\/chromium\.br$/ };
const ROUTES = {
  health: NEEDS,
  quota: NEEDS,
  'scan/stream': [...NEEDS, CHROMIUM],
  'export/pdf': [...NEEDS, CHROMIUM],
};

let failed = false;
for (const [route, needs] of Object.entries(ROUTES)) {
  const files = JSON.parse(readFileSync(new URL(`../.next/server/app/api/${route}/route.js.nft.json`, import.meta.url), 'utf8')).files;
  for (const need of needs) {
    const ok = files.some((f) => need.re.test(f.replaceAll('\\', '/')));
    if (!ok) failed = true;
    console.log(`${ok ? '✓' : '✗'} /api/${route} traces ${need.name}`);
  }
}
process.exit(failed ? 1 : 0);
