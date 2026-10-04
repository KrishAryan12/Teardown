import { pdfHandler } from '@teardown/scanner/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(req: Request): Promise<Response> {
  return pdfHandler(req);
}
