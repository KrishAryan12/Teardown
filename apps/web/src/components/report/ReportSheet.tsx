'use client';

import './report.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Finding, Report } from '@teardown/core';
import { allFindings, orderedGroups } from '@teardown/core/scoring';
import { defaultVerify } from '@teardown/core/exporters';
import { Pin } from '../Pin';
import { Specimen } from './Specimen';
import { Findings } from './Findings';
import { Readouts, TitleBlock } from './Rail';
import { BrandSheet } from './BrandSheet';
import { ExportPanel } from './ExportPanel';
import { CATEGORY_LABEL, SEVERITY_LABEL, hoursAgo } from '@/lib/labels';

export interface ReportSheetProps {
  report: Report;
  cached?: boolean;
  cachedAt?: string;
  onRescan?: () => void;
  reveal?: boolean;
  headingLevel?: 'h1' | 'h2';
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

export default function ReportSheet({ report, cached, cachedAt, onRescan, reveal = true, headingLevel = 'h1' }: ReportSheetProps) {
  const groups = useMemo(() => orderedGroups(report), [report]);
  const taskNo = useMemo(() => new Map(groups.map((g, i) => [g.ruleId, i + 1])), [groups]);
  const byId = useMemo(() => new Map(allFindings(report).map((f) => [f.id, f])), [report]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.ruleId)));
  const [pageIndex, setPageIndex] = useState(0);
  const [lifted, setLifted] = useState(!reveal);
  const [sheet, setSheet] = useState<Finding | null>(null);
  const [scrollTo, setScrollTo] = useState<{ ruleId: string; nonce: number } | null>(null);
  const narrow = useIsNarrow();

  const toggle = useCallback((ruleId: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }, []);

  const openFromPin = useCallback(
    (ruleId: string, f: Finding) => {
      if (narrow) {
        setSheet(f);
        return;
      }
      setOpen((prev) => new Set(prev).add(ruleId));
      setActive(ruleId);
      setScrollTo({ ruleId, nonce: Date.now() });
    },
    [narrow],
  );

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const Heading = headingLevel;
  const ai = report.ai;

  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <Heading id="sheet-title" className="visually-hidden">
        Teardown of {report.target.host}
      </Heading>
      <div className="sheet-banners">
        {cached && (
          <div className="notice notice-ok">
            <p>
              From cache: this site was scanned {hoursAgo(cachedAt)}.{' '}
              {onRescan && (
                <button type="button" className="btn" style={{ minHeight: 36, padding: '4px 12px', marginLeft: 8 }} onClick={onRescan}>
                  Scan again now
                </button>
              )}
            </p>
            {onRescan && <p className="small dim">A fresh scan counts against your scan limit.</p>}
          </div>
        )}
        {report.reducedAccuracy && (
          <div className="notice notice-warn">
            <p className="notice-title">Reduced accuracy</p>
            <p>The scanner&apos;s browser was unavailable, so this report comes from the page&apos;s HTML only: no screenshots, brand data, contrast or keyboard checks.</p>
          </div>
        )}
        {ai.status !== 'ok' && (
          <div className="notice">
            <p>{ai.notes ?? "AI-written advice wasn't used for this report."} Every fix still has complete steps and acceptance criteria from Teardown&apos;s rules.</p>
          </div>
        )}
        {report.limits.truncated && (
          <div className="notice notice-warn">
            <p>
              This scan stopped at its cap: {report.limits.pagesScanned} pages scanned, {report.limits.pagesSkipped} skipped.
            </p>
          </div>
        )}
      </div>

      <div className="sheet-grid">
        <div className="area-rail">
          <TitleBlock report={report} pageIndex={pageIndex} onPage={setPageIndex} />
          <Readouts report={report} />
          <div>
            <span className="label">Palette lifted from the specimen</span>
            <div className="palette-strip" aria-hidden="true" style={{ height: 28 }}>
              {report.brand.colors.slice(0, 10).map((c, i) => (
                <i
                  key={c.hex}
                  style={{
                    background: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#888',
                    flex: Math.max(c.share, 0.02),
                    transition: `transform 380ms cubic-bezier(.2,.9,.3,1) ${i * 70}ms, opacity 300ms ease-out ${i * 70}ms`,
                    ...(lifted ? {} : { transform: 'translateY(40px)', opacity: 0 }),
                  }}
                />
              ))}
            </div>
          </div>
          <section aria-labelledby="summary-title">
            <h2 id="summary-title" className="label" style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, marginBottom: 6 }}>
              Summary
            </h2>
            <p className="small">{ai.summary}</p>
          </section>
        </div>

        <div className="area-specimen">
          <Specimen key={pageIndex} report={report} pageIndex={pageIndex} taskNo={taskNo} active={active} setActive={setActive} onOpen={openFromPin} reveal={reveal} onRevealDone={() => setLifted(true)} />
        </div>

        <div className="area-findings">
          <Findings report={report} groups={groups} byId={byId} taskNo={taskNo} active={active} setActive={setActive} open={open} toggle={toggle} scrollTo={scrollTo} />
        </div>
      </div>

      <BrandSheet report={report} lifted />
      <ExportPanel report={report} />

      {sheet && (
        <div className="bottom-sheet" role="dialog" aria-modal="false" aria-labelledby="bs-title">
          <div className="bs-head">
            <h2 id="bs-title" style={{ fontSize: '1.375rem', display: 'flex', gap: 10, alignItems: 'center' }}>
              <Pin severity={sheet.severity} n={taskNo.get(sheet.ruleId) ?? ''} /> {sheet.title}
            </h2>
            <button type="button" className="btn" onClick={() => setSheet(null)} autoFocus>
              Close
            </button>
          </div>
          <p className="label">
            {SEVERITY_LABEL[sheet.severity]} · {CATEGORY_LABEL[sheet.category]}
          </p>
          <p>{sheet.detail}</p>
          {sheet.evidence.measured && (
            <p className="mono">
              Now {sheet.evidence.measured} → target {sheet.evidence.expected}
            </p>
          )}
          <p className="do-this">{sheet.ai?.instruction ?? sheet.fix.summary}</p>
          <p className="small">Verify: {defaultVerify(sheet)}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOpen((prev) => new Set(prev).add(sheet.ruleId));
              setActive(sheet.ruleId);
              setScrollTo({ ruleId: sheet.ruleId, nonce: Date.now() });
              setSheet(null);
            }}
          >
            Show in the task list
          </button>
        </div>
      )}
    </article>
  );
}
