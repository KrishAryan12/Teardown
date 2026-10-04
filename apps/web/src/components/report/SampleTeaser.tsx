'use client';

import './report.css';
import { useMemo, useState } from 'react';
import type { Report } from '@teardown/core';
import { orderedGroups } from '@teardown/core/scoring';
import { Specimen } from './Specimen';
import { Pin } from '../Pin';
import { CATEGORY_LABEL, SEVERITY_LABEL } from '@/lib/labels';

/** The landing-page demo: the specimen with the reveal, the top tasks, and a link to the full sheet. */
export default function SampleTeaser({ report }: { report: Report }) {
  const groups = useMemo(() => orderedGroups(report), [report]);
  const taskNo = useMemo(() => new Map(groups.map((g, i) => [g.ruleId, i + 1])), [groups]);
  const [active, setActive] = useState<string | null>(null);
  const [lifted, setLifted] = useState(false);
  const s = report.scores;
  return (
    <div className="teaser">
      <Specimen report={report} pageIndex={0} taskNo={taskNo} active={active} setActive={setActive} onOpen={(id) => setActive(id)} reveal onRevealDone={() => setLifted(true)} />
      <div>
        <div className="readouts" style={{ marginBottom: 16 }}>
          <div className="readout overall fair">
            <span className="label">Overall · {report.target.host}</span>
            <span className="r-value">{s.overall}</span>
            <span className="r-bar" aria-hidden="true">
              <i style={{ width: `${s.overall}%` }} />
            </span>
            <span className="r-note">
              Accessibility {s.accessibility} · SEO {s.seo} · UX {s.ux} · Performance {s.performance.score} (lab)
            </span>
          </div>
        </div>
        <h3 className="label" style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, marginBottom: 10 }}>
          Top tasks
        </h3>
        <ol className="teaser-list">
          {groups.slice(0, 6).map((g) => (
            <li key={g.ruleId} onMouseEnter={() => setActive(g.ruleId)} onMouseLeave={() => setActive(null)} style={active === g.ruleId ? { color: '#fff' } : undefined}>
              <Pin severity={g.worstSeverity} n={taskNo.get(g.ruleId)!} />
              <span>
                {g.title}
                <br />
                <span className="label">
                  {SEVERITY_LABEL[g.worstSeverity]} · {CATEGORY_LABEL[g.category]}
                  {g.count > 1 ? ` · ${g.count}×` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <span className="label" style={{ display: 'block', marginTop: 20 }}>
          Palette lifted from the specimen
        </span>
        <div className="palette-strip" aria-hidden="true" style={{ height: 28 }}>
          {report.brand.colors.slice(0, 10).map((c, i) => (
            <i
              key={c.hex}
              style={{
                background: c.hex,
                flex: Math.max(c.share, 0.02),
                transition: `transform 380ms cubic-bezier(.2,.9,.3,1) ${i * 70}ms, opacity 300ms ease-out ${i * 70}ms`,
                ...(lifted ? {} : { transform: 'translateY(40px)', opacity: 0 }),
              }}
            />
          ))}
        </div>
        <p style={{ marginTop: 24 }}>
          <a className="btn btn-primary" href="/sample/">
            Open the full sample report
          </a>
        </p>
      </div>
    </div>
  );
}
