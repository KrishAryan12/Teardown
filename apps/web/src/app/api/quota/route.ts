import { quotaHandler } from '@teardown/scanner/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return quotaHandler(req);
}
