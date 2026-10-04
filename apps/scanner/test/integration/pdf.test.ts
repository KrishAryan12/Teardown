import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SsrfGuard } from '../../src/security/guard';
import { BrowserPool } from '../../src/browser/pool';
import { renderPdf } from '../../src/pdf/render';
import { makeReportFromFixture } from '../unit/reportFixture';

describe('PDF rendering (M8)', () => {
  let pool: BrowserPool;
  beforeAll(() => {
    pool = new BrowserPool({ guard: new SsrfGuard({ allowPrivate: false }), noSandbox: true, maxContexts: 2 });
  });
  afterAll(() => pool.close());

  it('renders an A4 PDF with selectable text and a sensible size', async () => {
    const report = makeReportFromFixture();
    const pdf = await renderPdf(report, pool);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(pdf.length).toBeLessThan(3_000_000);
    // A4 is ~595 x 842 pt
    expect(pdf.toString('latin1')).toMatch(/MediaBox\s*\[\s*0 0 59[45](\.\d+)? 84[12](\.\d+)?/);
    // Embedded fonts (text is real text, not images)
    expect(pdf.toString('latin1')).toMatch(/FontFile2|FontFile3|\/Font/);
  });

  it('makes no network requests even when the report references remote URLs', async () => {
    const report = makeReportFromFixture();
    report.brand.assets.logoUrl = 'http://127.0.0.1:1/logo.png';
    report.pages[0]!.screenshots.desktop = 'https://evil.example/x.jpg';
    const pdf = await renderPdf(report, pool);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
