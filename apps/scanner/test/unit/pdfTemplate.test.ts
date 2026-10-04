import { describe, expect, it } from 'vitest';
import { esc, reportHtml, safeImage } from '../../src/pdf/template';
import { makeReportFromFixture } from './reportFixture';

describe('PDF template', () => {
  const report = makeReportFromFixture();

  it('includes the cover, scores, brand sheet, fixes and caveats', () => {
    const html = reportHtml(report);
    for (const s of ['Teardown report', 'Scores', 'Brand sheet', 'Fixes, in priority order', 'Scan limits and caveats', 'Acceptance criteria']) expect(html).toContain(s);
    expect(html).toMatch(/@font-face\{font-family:'Big Shoulders Display'/);
  });

  it('escapes hostile strings from the (client-supplied) report', () => {
    const r = structuredClone(report);
    r.target.host = '<script>alert(1)</script>';
    r.ai.summary = '"><img src=x onerror=alert(1)>';
    r.pages[0]!.findings[0]!.title = '<iframe src="https://evil.example">';
    r.groups[0]!.title = '</style><script>bad()</script>';
    r.brand.fonts[0]!.fallbackStack = 'x;} body{display:none} /*';
    r.brand.colors[0]!.hex = '#ffffff';
    const html = reportHtml(r);
    expect(html).not.toMatch(/<script>alert|<img src=x|<iframe src=|<\/style><script>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('body{display:none}');
  });

  it('only allows strict base64 data URLs as image sources', () => {
    expect(safeImage('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(safeImage('https://evil.example/x.jpg')).toBeNull();
    expect(safeImage('data:image/jpeg;base64,AA" onerror="x')).toBeNull();
    expect(safeImage('data:text/html;base64,AAAA')).toBeNull();
  });

  it('esc covers quotes and backticks', () => {
    expect(esc(`<a href="x" title='y'>\``)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&#96;');
  });
});
