'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Category, Finding, Report, Viewport } from '@teardown/core';
import { Pin } from '../Pin';
import { CATEGORY_LABEL, SEVERITY_LABEL } from '@/lib/labels';

export interface PinData {
  key: string;
  finding: Finding;
  n: number;
  x: number; // CSS px in screenshot space
  y: number;
}

interface Props {
  report: Report;
  pageIndex: number;
  taskNo: Map<string, number>;
  active: string | null;
  setActive: (ruleId: string | null) => void;
  onOpen: (ruleId: string, finding: Finding) => void;
  reveal: boolean;
  /** Called with swatch timing so the palette strip can lift in after the pins. */
  onRevealDone?: () => void;
}

const MAX_PINS = 60;
const MARGIN_W = 56;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Specimen({ report, pageIndex, taskNo, active, setActive, onOpen, reveal, onRevealDone }: Props) {
  const page = report.pages[pageIndex]!;
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [layers, setLayers] = useState<Set<Category>>(() => new Set(['performance', 'seo', 'accessibility', 'ux', 'brand', 'security']));
  const shotRef = useRef<HTMLDivElement>(null);
  const bedRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [revealState, setRevealState] = useState<'idle' | 'running' | 'done'>(reveal ? 'idle' : 'done');
  const [lineY, setLineY] = useState<number | null>(null);

  const src = page.screenshots[viewport];
  const size = page.screenshotSize?.[viewport] ?? (viewport === 'desktop' ? { w: 1440, h: 900 } : { w: 390, h: 844 });
  const hasMobile = !!page.screenshots.mobile;

  const pins: PinData[] = useMemo(() => {
    const seen = new Map<string, number>();
    const out: PinData[] = [];
    for (const f of page.findings) {
      const b = f.evidence.bbox;
      if (!b || b.viewport !== viewport || !layers.has(f.category) || !taskNo.has(f.ruleId)) continue;
      if (b.y > size.h) continue;
      const count = seen.get(f.ruleId) ?? 0;
      if (count >= 6) continue; // a few instances per task is enough on the drawing
      seen.set(f.ruleId, count + 1);
      out.push({ key: f.id, finding: f, n: taskNo.get(f.ruleId)!, x: Math.min(size.w - 8, b.x + Math.min(b.w, 48) / 2), y: b.y + Math.min(b.h, 32) / 2 });
    }
    return out.sort((a, b) => a.n - b.n).slice(0, MAX_PINS);
  }, [page.findings, viewport, layers, taskNo, size.w, size.h]);

  // Displayed scale (rendered px per CSS px of the screenshot).
  useLayoutEffect(() => {
    const el = shotRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / size.w);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w, viewport]);

  // Margin labels: one per task, ordered by y, nudged apart so they never overlap.
  const labels = useMemo(() => {
    const firstByTask = new Map<number, PinData>();
    for (const p of pins) if (!firstByTask.has(p.n) || p.y < firstByTask.get(p.n)!.y) firstByTask.set(p.n, p);
    const list = [...firstByTask.values()].sort((a, b) => a.y - b.y).map((p) => ({ pin: p, y: p.y * scale }));
    let last = -Infinity;
    for (const l of list) {
      l.y = Math.max(l.y, last + 30);
      last = l.y;
    }
    return list;
  }, [pins, scale]);

  /* ----------------------------- the reveal ----------------------------- */
  const skip = useCallback(() => {
    setRevealState('done');
    setLineY(null);
  }, []);

  // Keep the latest callback without restarting the animation when the parent re-renders.
  const doneRef = useRef(onRevealDone);
  doneRef.current = onRevealDone;
  const started = useRef(false);
  const hasSize = scale > 0;

  useEffect(() => {
    if (!hasSize || started.current || revealState !== 'idle') return;
    started.current = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setLineY(null);
      setRevealState('done');
      doneRef.current?.();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setRevealState('running');
    const visibleH = Math.min(bedRef.current?.clientHeight ?? 800, size.h * scale);
    const SWEEP = 1800;
    const start = performance.now() + 500;
    let raf = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, Math.max(0, (now - start) / SWEEP));
      setLineY(now < start ? null : t * visibleH);
      if (t < 1) raf = requestAnimationFrame(tick);
      else finish();
    });
    // Any key or click skips straight to the final state.
    const stop = () => {
      cancelAnimationFrame(raf);
      finish();
    };
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
      // Unmounted mid-animation (or React's dev double-run): allow a fresh start on remount.
      if (!finished) {
        started.current = false;
        setRevealState('idle');
      }
    };
    // Runs once, when the image has a size. Later re-renders must not restart or cancel it.
  }, [hasSize]);

  const pinVisible = (p: PinData) => revealState === 'done' || (lineY !== null && p.y * scale <= lineY);

  const activePins = active ? pins.filter((p) => p.finding.ruleId === active) : [];
  const toggleLayer = (c: Category) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const shotW = scale * size.w;

  // Displayed pin positions, fanned out so no two targets overlap (WCAG 2.5.8: 24px targets or spacing).
  const placed = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    const taken: { x: number; y: number }[] = [];
    const STEP = 28;
    for (const p of pins) {
      let x = p.x * scale;
      let y = p.y * scale;
      for (let tries = 0; tries < 12 && taken.some((t) => Math.abs(t.x - x) < STEP && Math.abs(t.y - y) < STEP); tries++) {
        if (x + STEP < shotW - 12) x += STEP;
        else {
          x = Math.max(14, p.x * scale - STEP);
          y += STEP;
        }
      }
      taken.push({ x, y });
      out.set(p.key, { x, y });
    }
    return out;
  }, [pins, scale, shotW]);

  return (
    <section aria-labelledby="specimen-title" className={revealState === 'running' ? 'specimen revealing' : 'specimen'}>
      <div className="panel-title">
        <h2 id="specimen-title">Specimen</h2>
        <span className="label">
          {viewport === 'desktop' ? '1440 px' : '390 px'} · {pins.length} pins
        </span>
      </div>
      <div className="specimen-tools">
        <div className="toggle-group" role="group" aria-label="Viewport">
          <button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}>
            Desktop
          </button>
          <button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')} disabled={!hasMobile} title={hasMobile ? undefined : 'No mobile screenshot for this page'}>
            Mobile
          </button>
        </div>
        <fieldset className="layers">
          <legend className="visually-hidden">Show pins for</legend>
          {(['accessibility', 'seo', 'ux', 'performance', 'brand', 'security'] as Category[]).map((c) => (
            <label key={c}>
              <input type="checkbox" checked={layers.has(c)} onChange={() => toggleLayer(c)} />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="bed" ref={bedRef} style={revealState === 'running' ? { animation: 'td-slide 500ms ease-out both' } : undefined}>
        {revealState === 'running' && (
          <button type="button" className="btn skip-reveal" onClick={skip}>
            Skip animation
          </button>
        )}
        <div className={`bed-inner ${viewport}`}>
          <div className="shot" ref={shotRef}>
            {src ? (
              <img src={src} width={size.w} height={size.h} alt={`Screenshot of ${report.target.host} at ${viewport} width, annotated with numbered pins`} />
            ) : (
              <p className="no-shot">No screenshot for this view. {report.reducedAccuracy ? 'The browser was unavailable for this scan.' : 'It was left out to keep the report small.'}</p>
            )}
            {src &&
              activePins.map((p) => {
                const b = p.finding.evidence.bbox!;
                return <span key={`hl-${p.key}`} className="hl-box" style={{ left: b.x * scale, top: b.y * scale, width: Math.max(8, b.w * scale), height: Math.max(8, b.h * scale) }} />;
              })}
            {src &&
              pins.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="pin-btn"
                  data-active={active === p.finding.ruleId}
                  style={{
                    left: placed.get(p.key)?.x ?? p.x * scale,
                    top: placed.get(p.key)?.y ?? p.y * scale,
                    opacity: pinVisible(p) ? 1 : 0,
                    transform: `translate(-50%, -50%) scale(${pinVisible(p) ? 1 : 0.6})`,
                    transition: 'opacity 160ms ease-out, transform 220ms cubic-bezier(.2,1.6,.4,1)',
                  }}
                  aria-label={`Task ${p.n}: ${p.finding.title} (${SEVERITY_LABEL[p.finding.severity]}, ${CATEGORY_LABEL[p.finding.category]})`}
                  onMouseEnter={() => setActive(p.finding.ruleId)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.finding.ruleId)}
                  onBlur={() => setActive(null)}
                  onClick={() => onOpen(p.finding.ruleId, p.finding)}
                >
                  <Pin severity={p.finding.severity} n={p.n} />
                </button>
              ))}
            {lineY !== null && <span className="scanline" style={{ top: lineY }} aria-hidden="true" />}
            {/* Leader lines and margin labels share the screenshot's coordinate box. */}
            {src &&
              labels.map((l) => (
                <span key={`m-${l.pin.n}`} className="margin-label" style={{ top: l.y, left: shotW + 14, opacity: pinVisible(l.pin) ? 1 : 0, transition: 'opacity 200ms ease-out 80ms' }}>
                  <Pin severity={l.pin.finding.severity} n={l.pin.n} small />
                </span>
              ))}
          {src && scale > 0 && (
            <svg className="leaders" width={shotW + MARGIN_W} height={size.h * scale} aria-hidden="true">
              {labels.map((l) => {
                const pos = placed.get(l.pin.key) ?? { x: l.pin.x * scale, y: l.pin.y * scale };
                const x1 = pos.x + 13;
                const y1 = pos.y;
                const x2 = shotW + 10;
                const len = Math.hypot(x2 - x1, l.y - y1) + 12;
                const shown = pinVisible(l.pin);
                return (
                  <polyline
                    key={`l-${l.pin.n}`}
                    className={active === l.pin.finding.ruleId ? 'active' : undefined}
                    points={`${x1},${y1} ${shotW - 8},${l.y} ${x2},${l.y}`}
                    strokeDasharray={len}
                    strokeDashoffset={shown ? 0 : len}
                    style={{ transition: 'stroke-dashoffset 420ms ease-out' }}
                  />
                );
              })}
            </svg>
          )}
          </div>
          <div className="margin" aria-hidden="true" />
        </div>
      </div>
      <p className="specimen-caption">
        Pins are numbered by task. Shape shows severity: circle critical, diamond serious, triangle moderate, square minor. Select a pin to open its task.
      </p>
      <style>{`@keyframes td-slide{from{transform:translateY(24px);opacity:.0}to{transform:none;opacity:1}}`}</style>
    </section>
  );
}
