'use client';

import { useState } from 'react';
import type { Report } from '@teardown/core';
import { toAgentMarkdown, toJson } from '@teardown/core/exporters';
import { ApiFailure, download, exportPdf, formatReset } from '@/lib/api';
import { fileStem } from '@/lib/labels';

export function ExportPanel({ report }: { report: Report }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const stem = fileStem(report);
  const schemaUrl = typeof window !== 'undefined' ? `${window.location.origin}/schema/report-v1.json` : undefined;

  const pdf = async () => {
    setBusy(true);
    setStatus('Rendering the PDF on the scanner…');
    try {
      download(await exportPdf(report), `${stem}.pdf`);
      setStatus('PDF downloaded.');
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      setStatus(f?.code === 'RATE_LIMITED' ? `${f.message} Try again ${formatReset(f.resetAt)}.` : (f?.message ?? 'The PDF could not be created. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(toAgentMarkdown(report));
      setStatus('Agent brief copied. Paste it into your AI coding agent.');
    } catch {
      setStatus("Your browser blocked the clipboard. Use Download agent brief instead.");
    }
  };

  return (
    <section className="section" aria-labelledby="exports-title">
      <div className="section-head">
        <h2 id="exports-title">Exports</h2>
      </div>
      <div className="export-panel">
        <div className="exports-grid">
          <div>
            <span className="label">01 · For people</span>
            <h3>PDF report</h3>
            <p>Cover, scores, the annotated specimen, the brand sheet and every fix with its acceptance criteria.</p>
            <p style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={pdf} disabled={busy}>
                Download PDF
              </button>
            </p>
          </div>
          <div>
            <span className="label">02 · For AI coding agents</span>
            <h3>Agent brief</h3>
            <p>Markdown tasks in priority order, each with steps, acceptance criteria and a way to verify, plus your brand tokens.</p>
            <p style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={copyBrief}>
                Copy agent brief
              </button>
              <button type="button" className="btn" onClick={() => download(new Blob([toAgentMarkdown(report)], { type: 'text/markdown' }), `${stem}.md`)}>
                Download agent brief
              </button>
            </p>
          </div>
          <div>
            <span className="label">03 · For machines</span>
            <h3>JSON</h3>
            <p>The full report (schema teardown.report/v1) with design tokens. The smaller file leaves out screenshots.</p>
            <p style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={() => download(new Blob([toJson(report, { schemaUrl })], { type: 'application/json' }), `${stem}.json`)}>
                Download JSON
              </button>
              <button type="button" className="btn" onClick={() => download(new Blob([toJson(report, { images: false, schemaUrl })], { type: 'application/json' }), `${stem}-no-images.json`)}>
                JSON without images
              </button>
            </p>
          </div>
        </div>
        <p className="status-line" role="status">
          {status}
        </p>
        <p className="small dim">This report isn&apos;t stored anywhere. Refreshing or closing the page loses it, so download what you need.</p>
      </div>
    </section>
  );
}
