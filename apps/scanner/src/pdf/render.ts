import type { Report } from '@teardown/core';
import type { BrowserPool } from '../browser/pool';
import { reportHtml } from './template';

/**
 * Renders the print template to an A4 PDF. The report is untrusted input (it comes from the
 * client), so the page runs with JavaScript disabled and every network request aborted; only
 * inline data: URLs (fonts, screenshots) load.
 */
export async function renderPdf(report: Report, pool: BrowserPool): Promise<Buffer> {
  const release = await pool.contexts.acquire();
  const ctx = await pool.newContext({ javaScriptEnabled: false, viewport: { width: 1240, height: 1754 } }).catch((e) => {
    release();
    throw e;
  });
  try {
    await ctx.route('**/*', (route) => route.abort('blockedbyclient'));
    const page = await ctx.newPage();
    await page.setContent(reportHtml(report), { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:7px Arial,sans-serif;color:#4a5d72;padding:0 18mm;display:flex;justify-content:space-between"><span>Teardown · ${report.target.host.replace(/[^a-z0-9.-]/gi, '')} · JSON and Markdown exports available from the report page</span><span>Sheet <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await ctx.close().catch(() => undefined);
    release();
  }
}
