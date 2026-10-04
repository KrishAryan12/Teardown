# Design plan: Teardown

## Concept

A forensic lab bench crossed with an engineering drawing set. The scanned site is the **specimen**: it is laid on a drawing sheet, measured, and taken apart. Problems become numbered callouts with leader lines into the margin. Brand colours are lifted off the specimen into a swatch strip, and fonts become specimen cards. The interface reads like a drawing set (sheets, a title block, a revision table, readouts), not a SaaS dashboard: no cards with drop shadows, no gradients, no rounded "stat tiles", no illustration mascots.

Boldness is spent in one place, **the teardown reveal**. Everything else is quiet linework on cyanotype blue.

## Tokens

| Token | Value | Use | Contrast on canvas |
|---|---|---|---|
| `--canvas` | `#0D2B4B` | Page background (cyanotype) | — |
| `--table` | `#081C33` | Recessed surfaces: input slot, specimen bed, code | — |
| `--chalk` | `#CFE3F2` | Body text, linework | 10.87:1 |
| `--chalk-dim` | `#9DB9D1` | Secondary text, captions | 7.03:1 |
| `--grid` | `rgba(207,227,242,0.08)` | Drawing grid, never carries meaning | — |
| `--rule` | `rgba(207,227,242,0.28)` | Hairlines, frame | decorative |
| `--pass` | `#6FD6A8` | Good scores, "done" ticks | 8.1:1 |
| `--critical` | `#FF5043` | Redline | 4.43:1 (shapes and borders only, never text; passes the 3:1 non-text minimum) |
| `--serious` | `#FF8A3D` | | 6.12:1 |
| `--moderate` | `#F2C94C` | | 9.04:1 |
| `--minor` | `#8FB8DE` | | 6.88:1 |
| `--focus` | `#FFFFFF` | 2px focus outline, 2px offset | 14.34:1 |

Changes from the starting tokens, with reasons: added `--chalk-dim` (the brief had no secondary text colour, and lowering chalk's opacity fails AA on the grid), `--rule` (frame lines need more presence than the grid), and a white `--focus` (yellow would read as "moderate severity").

Pin numerals are drawn in `--table` (#081C33) on the severity fill: 5.29:1 on redline, higher on the others (white numerals on redline would be 3.2:1). Ratios above were computed with the project's own WCAG function.

Severity is **never** colour alone. Every pin and badge has a shape and a word:

| Severity | Shape | Label |
|---|---|---|
| critical | ● circle | Critical |
| serious | ◆ diamond | Serious |
| moderate | ▲ triangle | Moderate |
| minor | ■ square | Minor |

## Type roles

| Role | Face | Where |
|---|---|---|
| Display | Big Shoulders Display 800 | Headline, score numerals, sheet titles, title-block host |
| Body | Public Sans 400/600 | Everything readable, sentence case, max 72ch |
| Data | Martian Mono 400 | Numbers, measured values, selectors, hex codes, log lines, tiny uppercase labels |

All three are self-hosted at build time with `next/font/google` (`display: swap`, Latin subset, size-adjusted fallbacks so CLS stays at 0). Martian Mono is never used for running prose.

Scale (rem): 0.75 label · 0.875 small · 1 body · 1.25 lead · 2 h2 · 3–4.5 display (clamped).

## Layout and wireframes

The page sits inside a **drawing frame**: a hairline border inset 16px from the viewport with column letters (A–F) along the top edge and row numbers along the left. It is the only persistent decoration. It hides below 640px.

### Landing (desktop)

```
 A          B          C          D          E          F
┌──────────────────────────────────────────────────────────────┐
1 TEARDOWN                                  How it works  GitHub│
│                                                              │
│ Take any website apart.                                      │
│ Paste a URL. Teardown scans it in a real browser and hands   │
│ back a prioritised fix list, its brand system, and a brief   │
│ your AI coding agent can execute.                            │
│                                                              │
2 ┌─SPECIMEN──────────────────────────┬─MODE──────────┬──────┐ │
│ │ https://                          │ ◉ Single page │ Scan │ │
│ │                                   │ ○ Full site   │ this │ │
│ └───────────────────────────────────┴───────────────┴ site─┘ │
│ 5 scans left this hour · Full site: up to 15 pages, about    │
│ 5 minutes, 1 per day.                                        │
│                                                              │
3 SHEET 00 · SAMPLE TEARDOWN                                   │
│ ┌──────────────────────────┐  ①── Low-contrast text         │
│ │  specimen screenshot     │  ②── Images without alt text   │
│ │   ①      ②               │  ③── Tap targets under 24px    │
│ │        ③                 │                                │
│ └──────────────────────────┘  ■■■■■ palette strip            │
│ Open the full sample report →                                │
│                                                              │
4 WHAT YOU GET                                                 │
│ 01 PDF report     02 Agent brief (.md)     03 JSON           │
└──────────────────────────────────────────────────────────────┘
```

### Scanning: the bench log

```
┌─TITLE BLOCK───────────────┐ ┌─BENCH LOG ───────────────────────────┐
│ SPECIMEN  example.com      │ │ ✓ Check the address            51 ms │
│ MODE      Single page      │ │ ✓ Read robots.txt and sitemap 149 ms │
│ STARTED   14:02:11         │ │ ✓ Load page                   529 ms │
│ QUEUE     running          │ │ … Measure performance                │
│                            │ │                                      │
│ [ Cancel scan ]            │ │ Lighthouse runs one at a time on a   │
└────────────────────────────┘ │ small shared server: 20-60 s.        │
                               └──────────────────────────────────────┘
```
States: "Starting the scanner" (wake-up, with elapsed seconds), "Waiting in line: position 2", per-page rows in site mode (`page 3 of 15 · /pricing · 18 findings`). The log is `aria-live="polite"` and only announces completed steps.

### Report: the sheet (≥ 1200px)

```
┌─RAIL──────────┬─SPECIMEN──────────────────────────┬─FINDINGS──────────┐
│ example.com   │ [Desktop|Mobile]  Layers: ☑SEO ☑A11y│ AI order · filters │
│ 4 Oct 2026    │ ┌───────────────────────────┐  ①─ │ ◆1 Focus invisible │
│ Single · WP   │ │                           │  ②─ │   Serious · A11y   │
│ Sheet 1 of 1  │ │     ①          ②          │  ③─ │ ▲2 Images no alt   │
│───────────────│ │           ③               │     │ ■3 No HSTS         │
│ OVERALL   62  │ │                           │     │  (expands: evidence│
│ PERF  71 lab  │ └───────────────────────────┘     │   steps, criteria) │
│ A11Y  38      │                                    │                    │
│ SEO   80 …    │                                    │                    │
├───────────────┴────────────────────────────────────┴────────────────────┤
│ BRAND SHEET  swatches · type specimens · spacing ruler · radii · contrast│
├──────────────────────────────────────────────────────────────────────────┤
│ EXPORTS  Download PDF · Copy agent brief · Download .md · Download JSON  │
│ This report isn't stored. Refreshing the page loses it.                  │
└──────────────────────────────────────────────────────────────────────────┘
```
Hovering or focusing a pin highlights its finding card and the reverse. Pins are buttons in task order (`Tab` follows the numbers).

### Mobile report (< 900px)

```
┌──────────────────────┐
│ example.com · 62     │
│ readouts (2 columns) │
├──────────────────────┤
│ FINDINGS (primary)   │
│ ◆1 Focus invisible   │
│ ▲2 Images no alt     │
├──────────────────────┤
│ specimen (tap pin →  │
│ bottom sheet card)   │
├──────────────────────┤
│ brand · exports      │
└──────────────────────┘
```

## Motion

Only one elaborate animation, **the reveal** (3.4s, skippable with any click or key, instant with `prefers-reduced-motion`):

1. 0–500ms: the specimen slides up 24px onto the sheet and its frame draws in.
2. 500–2300ms: one scan line sweeps top to bottom.
3. Pins drop in (scale 0.6 → 1) as the line passes their y-position; their leader lines extend to the margin.
4. 2300–3400ms: brand swatches lift off the specimen into the palette strip.

Everything else moves only in answer to the user: expanding a finding (height), toggling layers (opacity), "Copied" confirmation. No scroll-triggered fades, no hover flourishes.

## Principles

1. **Measured, not decorated.** Every line on the sheet is a frame, a rule or a leader line pointing at something.
2. **Numbers are references.** A pin's number is its task number in the fix list, the brief and the PDF.
3. **Say what happened and what to do.** Errors, limits and fallbacks use plain sentences, never apologies or vague "something went wrong".
4. **Honest provenance.** The performance readout always names its source; AI-ordered vs rule-ordered is always labelled.
5. **The tool passes its own audit.** Semantic landmarks, visible focus, AA contrast, 320px support, no layout shift, landing JS under 150KB.

## Review against the brief (revisions)

First draft problems I found and changed:

- *Readout tiles with big coloured backgrounds* looked like a generic dashboard. Replaced with typeset readouts: label, mono number, a 2px bar.
- *A hero illustration* of a dissected browser competed with the reveal. Removed: the sample teardown below the form is the illustration.
- *Severity chips coloured as filled pills* are a component-library default. Replaced with the four pin shapes plus a word.
- *Centered hero* contradicts "left-aligned". Fixed.
- *Gradient scan line with glow trail* was too much. Now a single 2px chalk line with a faint 24px band behind it.

**Removed before finishing (the one decorative thing):** the coordinate tick marks on all four frame edges. Only the top letters and left numbers remain; the bottom and right ticks added noise without helping orientation.
