import type { Report } from '@teardown/core';
import { brandToTokens, tokensToCss } from '@teardown/core/tokens';

const safeHex = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? h : '#888888');
/** Only web-safe characters in a font stack used inline. */
const safeStack = (s: string) => s.replace(/[^\w\s,'"-]/g, '');

export function BrandSheet({ report, lifted }: { report: Report; lifted: boolean }) {
  const b = report.brand;
  if (!b.colors.length && !b.fonts.length) {
    return (
      <section className="section" aria-labelledby="brand-title">
        <div className="section-head">
          <h2 id="brand-title">Brand sheet</h2>
        </div>
        <p className="dim">{b.consistency.notes[0] ?? 'No brand data was collected for this scan.'}</p>
      </section>
    );
  }
  const css = tokensToCss(brandToTokens(b));
  const maxSpace = Math.max(1, ...b.spacing.values.map((v) => v.px));
  const unit = b.spacing.baseUnit;
  const failing = b.contrast.filter((c) => !c.passAA);
  return (
    <section className="section" aria-labelledby="brand-title">
      <div className="section-head">
        <h2 id="brand-title">Brand sheet</h2>
        <span className="label">
          {b.consistency.colorCount} colours · {b.consistency.fontCount} families
        </span>
      </div>
      <div className="brand-grid">
        <div>
          <h3 className="label" style={{ marginBottom: 12 }}>
            Palette, by share of the page
          </h3>
          <ul className="palette" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {b.colors.slice(0, 12).map((c, i) => (
              <li
                key={c.hex}
                className="swatch"
                // The "lift": swatches rise off the specimen into the palette once the pins are down.
                style={{
                  transition: `transform 360ms ease-out ${i * 60}ms, opacity 360ms ease-out ${i * 60}ms`,
                  ...(lifted ? {} : { opacity: 0, transform: 'translateY(-16px)' }),
                }}
              >
                <i style={{ background: safeHex(c.hex) }} />
                <span className="mono">{c.hex}</span>
                <br />
                <span className="dim">
                  {c.role ?? 'other'} · {c.share < 0.01 ? '<1' : Math.round(c.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
          <div className="palette-strip" aria-hidden="true">
            {b.colors.slice(0, 12).map((c) => (
              <i key={c.hex} style={{ background: safeHex(c.hex), flex: Math.max(c.share, 0.01) }} />
            ))}
          </div>

          <h3 className="label" style={{ margin: '28px 0 12px' }}>
            Spacing {unit ? `(base unit ${unit}px, ${Math.round(b.spacing.onGridRatio * 100)}% on grid)` : `(no consistent grid, ${Math.round(b.spacing.onGridRatio * 100)}% on a 4px grid)`}
          </h3>
          <div className="ruler">
            {b.spacing.values.slice(0, 14).map((v) => {
              const off = unit ? Math.abs(v.px / unit - Math.round(v.px / unit)) > 0.06 : v.px % 4 !== 0;
              return (
                <div key={v.px} className={off ? 'off-grid' : undefined}>
                  <span className="mono">
                    {v.px}px ×{v.count}
                    {off ? ' ⚠' : ''}
                  </span>
                  <i style={{ width: `${Math.max(1, (v.px / maxSpace) * 100)}%` }} />
                </div>
              );
            })}
          </div>
          {off(b) && <p className="small dim">Hatched bars are off the grid.</p>}

          {b.radii.length > 0 && (
            <>
              <h3 className="label" style={{ margin: '28px 0 12px' }}>
                Corner radii
              </h3>
              <div className="radii">
                {b.radii.slice(0, 8).map((r) => (
                  <div key={r.px}>
                    <i style={{ borderRadius: Math.min(r.px, 20) }} />
                    <span className="mono">{r.px >= 9999 ? 'pill' : `${r.px}px`}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <h3 className="label" style={{ marginBottom: 12 }}>
            Type specimens
          </h3>
          <div className="fontcards">
            {b.fonts.slice(0, 4).map((f) => (
              <div key={f.family} className="fontcard">
                <p className="sample" style={{ fontFamily: safeStack(f.fallbackStack) }}>
                  Aa Bb Cc 0123
                </p>
                <p className="small" style={{ margin: 0 }}>
                  <strong>{f.family}</strong> · {f.source === 'google' ? 'Google Fonts' : f.source === 'self-hosted' ? 'self-hosted' : f.source === 'system' ? 'system font' : 'source unknown'} · {f.usedFor.join(', ')} · weights {f.weights.join(', ')}
                </p>
                {f.source !== 'system' && <p className="small dim" style={{ margin: '4px 0 0' }}>Shown in your browser&apos;s version if installed, otherwise a fallback.</p>}
              </div>
            ))}
          </div>
          {b.typeScale.length > 0 && (
            <p className="mono small" style={{ marginTop: 12 }}>
              Sizes: {b.typeScale.map((t) => `${t.px}`).join(' · ')} px{b.typeScaleRatio ? ` · ratio ~${b.typeScaleRatio}` : ' · no consistent ratio'}
            </p>
          )}

          {failing.length > 0 && (
            <>
              <h3 className="label" style={{ margin: '28px 0 12px' }}>
                Contrast pairs below WCAG AA
              </h3>
              <table className="pairs">
                <thead>
                  <tr>
                    <th scope="col">Sample</th>
                    <th scope="col">Ratio</th>
                    <th scope="col">Uses</th>
                  </tr>
                </thead>
                <tbody>
                  {failing.slice(0, 8).map((c) => (
                    <tr key={`${c.fg}${c.bg}${c.largeText}`}>
                      <td>
                        {/* Drawn as SVG: the sample deliberately shows the failing contrast, so it isn't page text. */}
                        <svg className="pair-sample" width="40" height="24" viewBox="0 0 40 24" aria-hidden="true" focusable="false">
                          <rect width="40" height="24" fill={safeHex(c.bg)} />
                          <text x="20" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill={safeHex(c.fg)} fontFamily="sans-serif">
                            Aa
                          </text>
                        </svg>{' '}
                        <span className="mono">
                          {c.fg} on {c.bg}
                        </span>
                      </td>
                      <td className="mono">
                        {c.ratio}:1 <span className="dim">/ {c.largeText ? '3' : '4.5'}</span>
                      </td>
                      <td className="mono">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {b.contrastUnknown > 0 && <p className="small dim">{b.contrastUnknown} text elements sit on images or gradients, so their contrast was not guessed.</p>}

          <h3 className="label" style={{ margin: '28px 0 12px' }}>
            Tokens, ready to paste
          </h3>
          <pre className="code" style={{ maxHeight: 260, overflow: 'auto' }} tabIndex={0} aria-label="Design tokens as CSS custom properties">
            {css}
          </pre>
          {b.consistency.notes.length > 0 && (
            <ul className="small dim" style={{ paddingLeft: 18 }}>
              {b.consistency.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function off(b: Report['brand']): boolean {
  const unit = b.spacing.baseUnit ?? 4;
  return b.spacing.values.some((v) => Math.abs(v.px / unit - Math.round(v.px / unit)) > 0.06);
}
