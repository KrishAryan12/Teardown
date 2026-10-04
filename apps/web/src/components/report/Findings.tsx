'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, Finding, Group, Report, Severity } from '@teardown/core';
import { defaultVerify } from '@teardown/core/exporters';
import { Pin } from '../Pin';
import { CATEGORY_LABEL, SEVERITY_LABEL } from '@/lib/labels';

interface Props {
  report: Report;
  groups: Group[];
  byId: Map<string, Finding>;
  taskNo: Map<string, number>;
  active: string | null;
  setActive: (ruleId: string | null) => void;
  open: Set<string>;
  toggle: (ruleId: string) => void;
  /** Set when a task is opened from a pin; scrolls that task into view. */
  scrollTo?: { ruleId: string; nonce: number } | null;
}

const CATS: Category[] = ['accessibility', 'seo', 'ux', 'performance', 'brand', 'security'];
const SEVS: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

export function Findings({ report, groups, byId, taskNo, active, setActive, open, toggle, scrollTo }: Props) {
  const [cats, setCats] = useState<Set<Category>>(new Set());
  const [sevs, setSevs] = useState<Set<Severity>>(new Set());
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const shown = useMemo(() => groups.filter((g) => (!cats.size || cats.has(g.category)) && (!sevs.size || sevs.has(g.worstSeverity))), [groups, cats, sevs]);

  // Scroll only when a task is opened from a pin; hover and focus must never move the page.
  useEffect(() => {
    if (!scrollTo) return;
    const el = itemRefs.current.get(scrollTo.ruleId);
    el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [scrollTo]);

  const flip = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  };
  const counts = (c: Category) => groups.filter((g) => g.category === c).length;

  const aiOk = report.ai.status === 'ok';
  return (
    <section aria-labelledby="findings-title">
      <div className="panel-title">
        <h2 id="findings-title">Fixes</h2>
        <span className="label">{groups.length} tasks</span>
      </div>
      <p className="order-note">
        {aiOk
          ? `Ordered and explained by ${report.ai.model ?? 'an AI model'} from Teardown's rule findings. Severity and checks come from the rules.`
          : "Ordered by Teardown's built-in rules (severity, how often, and category weight)."}
      </p>
      <fieldset className="filters">
        <legend className="visually-hidden">Filter tasks</legend>
        <div className="chips" role="group" aria-label="Category">
          {CATS.filter((c) => counts(c) > 0).map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={cats.has(c)} onClick={() => flip(cats, c, setCats)}>
              {CATEGORY_LABEL[c]} <span className="mono">{counts(c)}</span>
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Severity">
          {SEVS.filter((s) => groups.some((g) => g.worstSeverity === s)).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sevs.has(s)} onClick={() => flip(sevs, s, setSevs)}>
              <Pin severity={s} n="" small /> {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="visually-hidden" aria-live="polite">
        Showing {shown.length} of {groups.length} tasks
      </p>
      {shown.length === 0 && <p className="dim">{groups.length ? 'No tasks match these filters.' : 'No issues found by the checks Teardown runs. Nothing to fix here.'}</p>}
      <ol className="findings-list">
        {shown.map((g) => {
          const items = g.findingIds.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
          const f = items[0];
          if (!f) return null;
          const n = taskNo.get(g.ruleId)!;
          const isOpen = open.has(g.ruleId);
          const bodyId = `task-${n}`;
          return (
            <li
              key={g.ruleId}
              className="finding"
              data-active={active === g.ruleId}
              ref={(el) => {
                if (el) itemRefs.current.set(g.ruleId, el);
                else itemRefs.current.delete(g.ruleId);
              }}
              onMouseEnter={() => setActive(g.ruleId)}
              onMouseLeave={() => setActive(null)}
            >
              <h3 style={{ margin: 0, font: 'inherit' }}>
                <button type="button" className="finding-head" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggle(g.ruleId)} onFocus={() => setActive(g.ruleId)}>
                  <Pin severity={g.worstSeverity} n={n} />
                  <span>
                    <span className="f-title">{g.title}</span>
                    <span className="f-meta label">
                      {SEVERITY_LABEL[g.worstSeverity]} · {CATEGORY_LABEL[g.category]} · effort {f.fix.effort}
                      {g.count > 1 ? ` · ${g.count}×` : ''}
                    </span>
                  </span>
                  <span className="chev" aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
              </h3>
              <div id={bodyId} className="finding-body" hidden={!isOpen}>
                <p>{f.detail}</p>
                {(f.evidence.measured || f.evidence.expected || f.evidence.selector) && (
                  <dl className="evidence">
                    {f.evidence.measured && (
                      <>
                        <dt>Now</dt>
                        <dd className="mono">{f.evidence.measured}</dd>
                      </>
                    )}
                    {f.evidence.expected && (
                      <>
                        <dt>Target</dt>
                        <dd className="mono">{f.evidence.expected}</dd>
                      </>
                    )}
                    {f.evidence.selector && (
                      <>
                        <dt>Where</dt>
                        <dd>
                          <code className="mono">{f.evidence.selector}</code>
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                {f.evidence.htmlSnippet && <pre className="code">{f.evidence.htmlSnippet}</pre>}
                <h4>Do this</h4>
                <p className="do-this">{f.ai?.instruction ?? f.fix.summary}</p>
                {f.ai?.rationale && aiOk && <p className="small dim">Why now: {f.ai.rationale}</p>}
                {f.fix.steps.length > 0 && (
                  <>
                    <h4>Steps</h4>
                    <ol>
                      {f.fix.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </>
                )}
                {f.fix.codeHint && <pre className="code">{f.fix.codeHint}</pre>}
                <h4>Acceptance criteria</h4>
                <ul className="acceptance">
                  {f.fix.acceptance.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <h4>Verify</h4>
                <p className="small">{defaultVerify(f)}</p>
                {g.count > 1 && (
                  <>
                    <h4>Instances</h4>
                    <ul className="small">
                      {items.slice(0, 8).map((it) => (
                        <li key={it.id}>
                          {report.mode === 'site' && <span className="dim">{new URL(it.pageUrl).pathname} · </span>}
                          <code className="mono">{it.evidence.selector ?? it.evidence.measured ?? 'page'}</code>
                        </li>
                      ))}
                      {g.count > 8 && <li className="dim">and {g.count - 8} more</li>}
                    </ul>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
