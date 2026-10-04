import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PageCapture } from '../../src/capture/types';
import type { RuleContext, SiteSignals } from '../../src/rules/types';
import { processBrand } from '../../src/brand/process';

const dir = fileURLToPath(new URL('../fixtures/captures/', import.meta.url));

export function loadCapture(name: 'bad' | 'good'): PageCapture {
  return JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as PageCapture;
}

export const noSignals: SiteSignals = { robots: { status: 200, body: 'User-agent: *' }, sitemap: { found: true }, linkChecks: [] };

export function ctxFor(capture: PageCapture, over: Partial<RuleContext> = {}): RuleContext {
  return {
    url: capture.finalUrl,
    capture,
    brand: capture.brand ? processBrand([capture.brand]) : null,
    site: noSignals,
    primary: true,
    axeRan: capture.axe !== null,
    axeIds: new Set((capture.axe ?? []).map((v) => v.id)),
    ...over,
  };
}

/** Deep copy of a fixture capture with a mutation applied. */
export function mutate(name: 'bad' | 'good', fn: (c: PageCapture) => void): PageCapture {
  const c = structuredClone(loadCapture(name));
  fn(c);
  return c;
}
