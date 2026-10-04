import { healthHandler } from '@teardown/scanner/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return healthHandler();
}
