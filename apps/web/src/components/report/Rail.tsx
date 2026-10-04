import type { Report } from '@teardown/core';
import { band, formatDate, perfSourceLabel } from '@/lib/labels';

export function TitleBlock({ report, pageIndex, onPage }: { report: Report; pageIndex: number; onPage: (i: number) => void }) {
  const stack = report.stack.map((s) => s.name).join(', ') || 'Not detected';
  return (
    <div className="titleblock">
      <div className="tb-host">
        <span className="label">Specimen</span>
        <strong>{report.target.host}</strong>
      </div>
      <dl>
        <dt className="label">Date</dt>
        <dd>{formatDate(report.generatedAt)}</dd>
        <dt className="label">Mode</dt>
        <dd>{report.mode === 'site' ? `Full site, ${report.limits.pagesScanned} pages` : 'Single page'}</dd>
        <dt className="label">Stack</dt>
        <dd>{stack}</dd>
        <dt className="label">Ruleset</dt>
        <dd className="mono">{report.rulesetVersion}</dd>
        <dt className="label">Sheet</dt>
        <dd>
          {report.pages.length > 1 ? (
            <label>
              <span className="visually-hidden">Page shown on the specimen</span>
              <select value={pageIndex} onChange={(e) => onPage(Number(e.target.value))} style={{ maxWidth: '100%', background: 'var(--table)', color: 'var(--chalk)', border: '1px solid var(--rule-strong)', padding: '6px', minHeight: 36 }}>
                {report.pages.map((p, i) => (
                  <option key={p.url} value={i}>
                    {i + 1} of {report.pages.length}: {new URL(p.url).pathname}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            '1 of 1'
          )}
        </dd>
      </dl>
    </div>
  );
}

export function Readouts({ report }: { report: Report }) {
  const s = report.scores;
  const rows: { label: string; value: number; note?: string }[] = [
    { label: 'Performance', value: s.performance.score, note: perfSourceLabel(report) },
    { label: 'Accessibility', value: s.accessibility },
    { label: 'SEO', value: s.seo },
    { label: 'UX', value: s.ux },
    { label: 'Brand', value: s.brand },
    { label: 'Security', value: s.security },
  ];
  return (
    <section className="readouts" aria-labelledby="readouts-title">
      <h2 id="readouts-title" className="visually-hidden">
        Scores
      </h2>
      <div className={`readout overall ${band(s.overall)}`}>
        <span className="label">Overall</span>
        <span className="r-value">{s.overall}</span>
        <span className="r-bar" aria-hidden="true">
          <i style={{ width: `${s.overall}%` }} />
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`readout ${band(r.value)}`}>
          <span className="label">{r.label}</span>
          <span className="r-value" aria-label={`${r.value} out of 100`}>
            {r.value}
          </span>
          <span className="r-bar" aria-hidden="true">
            <i style={{ width: `${r.value}%` }} />
          </span>
          {r.note && <span className="r-note">{r.note}</span>}
        </div>
      ))}
    </section>
  );
}
