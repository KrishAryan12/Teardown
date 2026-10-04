import { scanHandler } from '@teardown/scanner/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Hobby's maximum. The scanner stops itself earlier (SCAN_DEADLINE_MS) and reports a timeout.
export const maxDuration = 300;

export function POST(req: Request): Promise<Response> {
  return scanHandler(req);
}
