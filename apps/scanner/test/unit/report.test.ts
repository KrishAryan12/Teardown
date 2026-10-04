import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@teardown/core';
import { enforcePayloadCap, sumCounts } from '../../src/scan/report';
import { makeReportFromFixture } from './reportFixture';

const shot = (kb: number) => `data:image/jpeg;base64,${'A'.repeat(kb * 1024)}`;

describe('enforcePayloadCap', () => {
  it('drops the lowest-priority screenshots first and records it', () => {
    const r = makeReportFromFixture();
    const page = r.pages[0]!;
    r.pages = [0, 1, 2].map((i) => ({ ...structuredClone(page), url: `${page.url}?p=${i}`, screenshots: { desktop: shot(300), ...(i === 0 ? { mobile: shot(100) } : {}) } }));
    const base = Buffer.byteLength(JSON.stringify({ ...r, pages: r.pages.map((p) => ({ ...p, screenshots: {} })) }));
    const capped = enforcePayloadCap(r, base + 500 * 1024);
    // Later pages' desktop shots go first; the home page keeps its desktop and mobile shots.
    expect(capped.pages[2]!.screenshots.desktop).toBeUndefined();
    expect(capped.pages[0]!.screenshots.desktop).toBeDefined();
    expect(capped.pages[0]!.screenshots.mobile).toBeDefined();
    expect(capped.limits.screenshotsDropped).toBeGreaterThan(0);
    expect(capped.limits.notes?.join(' ')).toMatch(/screenshot\(s\) were left out/);
    expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(base + 500 * 1024);
    expect(ReportSchema.safeParse(capped).success).toBe(true);
  });

  it('leaves small reports untouched', () => {
    const r = makeReportFromFixture();
    expect(enforcePayloadCap(r, 10 * 1024 * 1024).limits.screenshotsDropped).toBeUndefined();
  });
});

describe('sumCounts', () => {
  it('adds instance counts across pages', () => {
    expect(sumCounts([{ counts: { a: 2, b: 1 } }, { counts: { a: 3 } }])).toEqual({ a: 5, b: 1 });
  });
});
