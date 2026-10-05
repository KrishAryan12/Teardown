import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * One Vercel project: the site (pre-rendered pages) and the scanner (route handlers under /api,
 * running as Vercel Functions). The scanner itself lives in apps/scanner and is imported as source.
 */
const CHROMIUM_BIN = ['./node_modules/@sparticuz/chromium/bin/**', '../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**'];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@teardown/core', '@teardown/scanner'],
  // Native or file-reading packages stay outside the bundle and are traced into the function.
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', '@axe-core/playwright', 'axe-core', 'sharp', 'linkedom'],
  outputFileTracingRoot: join(import.meta.dirname, '../../'),
  outputFileTracingIncludes: {
    // Files read from disk at runtime, which the tracer can't see. Every /api route loads the scanner,
    // and playwright-core reads browsers.json as soon as it is imported. The Chromium binary is listed by
    // both its symlinked and its real pnpm-store path, because @sparticuz/chromium resolves the real one.
    '/api/**': [
      '../../node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json',
      '../../node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/package.json',
    ],
    '/api/scan/stream': CHROMIUM_BIN,
    '/api/export/pdf': CHROMIUM_BIN,
  },
  outputFileTracingExcludes: {
    // Lighthouse runs only in the Docker deployment; on Vercel performance comes from PSI or the estimate.
    '*': ['**/node_modules/lighthouse/**', '**/node_modules/chrome-launcher/**'],
  },
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
