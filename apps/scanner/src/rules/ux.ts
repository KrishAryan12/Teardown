import type { Rule } from './types';

export const uxRules: Rule[] = [
  {
    id: 'ux.tap-target.small',
    category: 'ux',
    severity: 'serious',
    title: 'Tap targets smaller than 24px',
    detail: 'On a phone these controls are smaller than 24x24 CSS pixels, the WCAG 2.2 minimum (2.5.8), so people mis-tap.',
    supersedesAxe: ['target-size'],
    supersedesLighthouse: ['target-size'],
    fix: {
      summary: 'Make each control at least 24x24px (44x44px is better) using padding, without changing the visual size of icons.',
      steps: ['Add padding or min-width/min-height to small links and buttons.', 'Increase spacing between adjacent small targets.', 'Recheck at a 390px-wide viewport.'],
      codeHint: '.icon-button, .tiny-link {\n  min-width: 44px;\n  min-height: 44px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}',
      effort: 's',
      acceptance: ['At 390px width, every tap target is at least 24x24 CSS px (or has 24px spacing to its neighbours).'],
      verify: 'DevTools device mode at 390px: hover each control and check its box size.',
    },
    check: ({ capture }) =>
      capture.mobile?.tapTargets.samples
        .filter((t) => t.level === 24)
        .map((t) => ({ selector: t.selector, snippet: t.snippet, bbox: t.bbox, viewport: 'mobile' as const, measured: `${t.w}x${t.h}px`, expected: '>= 24x24px' })),
  },
  {
    id: 'ux.tap-target.comfort',
    category: 'ux',
    severity: 'minor',
    title: 'Tap targets under 44px',
    detail: 'These controls meet the 24px minimum but are smaller than the comfortable 44x44px recommended for touch.',
    fix: {
      summary: 'Grow touch targets to 44x44px where the layout allows, using padding.',
      steps: ['Add padding to primary navigation, buttons and form controls until they reach 44px tall.'],
      effort: 's',
      acceptance: ['Primary controls are at least 44x44 CSS px on mobile.'],
    },
    check: ({ capture }) => {
      const t = capture.mobile?.tapTargets;
      if (!t || t.below44 < 3) return null;
      return t.samples.filter((s) => s.level === 44).map((s) => ({ selector: s.selector, snippet: s.snippet, bbox: s.bbox, viewport: 'mobile' as const, measured: `${s.w}x${s.h}px`, expected: '>= 44x44px' }));
    },
  },
  {
    id: 'ux.text.small',
    category: 'ux',
    severity: 'moderate',
    title: 'Body text smaller than 16px',
    detail: 'A large share of the running text is under 16px, which is hard to read on phones and for many older readers.',
    fix: {
      summary: 'Set body text to at least 16px (1rem) and size other text relative to it.',
      steps: ['Set `font-size: 1rem` (16px) or larger on body.', 'Use rem for paragraph and list text; keep smaller sizes for captions and legal text only.'],
      codeHint: 'body { font-size: 1rem; line-height: 1.5; }',
      effort: 's',
      acceptance: ['Paragraph and list text renders at 16px or larger at all viewport widths.'],
    },
    check: ({ capture }) => {
      const s = capture.facts.smallText;
      if (s.totalChars < 200 || s.chars / s.totalChars < 0.3) return null;
      return s.samples.slice(0, 5).map((x) => ({ selector: x.selector, snippet: x.snippet, bbox: x.bbox, measured: `${x.px}px (${Math.round((s.chars / s.totalChars) * 100)}% of text)`, expected: '>= 16px' }));
    },
  },
  {
    id: 'ux.line-length',
    category: 'ux',
    severity: 'minor',
    title: 'Lines of text are too long',
    detail: 'Paragraph lines run past ~90 characters. Long lines make it hard to find the start of the next line.',
    fix: {
      summary: 'Limit text columns to about 60-75 characters with max-width.',
      steps: ['Add a max-width in ch units to prose containers.'],
      codeHint: '.prose, article p { max-width: 68ch; }',
      effort: 'xs',
      acceptance: ['Paragraphs on a 1440px-wide screen have at most ~80 characters per line.'],
    },
    check: ({ capture }) => capture.facts.longLines.map((l) => ({ selector: l.selector, snippet: l.snippet, bbox: l.bbox, measured: `~${l.cpl} characters per line`, expected: '<= 80' })),
  },
  {
    id: 'ux.mobile.overflow',
    category: 'ux',
    severity: 'serious',
    title: 'Page scrolls sideways on mobile',
    detail: 'At phone width the page is wider than the screen, so content is cut off and the page wobbles sideways while scrolling.',
    fix: {
      summary: 'Find the element wider than the viewport and make it fluid.',
      steps: ['In DevTools at 390px, find the element listed here.', 'Replace fixed widths with max-width: 100%, use flex-wrap/grid that collapses, and let long words break.', 'Avoid fixing it with overflow-x: hidden on body, which hides content.'],
      codeHint: 'img, video, table, pre { max-width: 100%; }\n.wide { width: auto; max-width: 100%; }\n* { min-width: 0; }',
      effort: 's',
      acceptance: ['At 390px width, document.documentElement.scrollWidth equals window.innerWidth.'],
      verify: 'DevTools console at 390px: `document.documentElement.scrollWidth <= innerWidth`',
    },
    check: ({ capture }) => {
      const m = capture.mobile;
      if (!m?.overflow) return null;
      const first = m.overflowOffenders[0];
      return {
        selector: first?.selector,
        snippet: first?.snippet,
        bbox: first?.bbox,
        viewport: 'mobile',
        measured: `${m.scrollWidth}px wide`,
        expected: `${m.viewportW}px`,
      };
    },
  },
  {
    id: 'ux.img.dimensions',
    category: 'ux',
    severity: 'moderate',
    title: 'Images without width and height',
    detail: "Images without width/height (or aspect-ratio) make the layout jump as they load (cumulative layout shift).",
    supersedesLighthouse: ['unsized-images'],
    fix: {
      summary: 'Add width and height attributes matching the intrinsic size, and let CSS scale them.',
      steps: ['Add width and height attributes to each <img> (the intrinsic pixel size).', 'Keep `height: auto` in CSS so they stay responsive.'],
      codeHint: '<img src="hero.jpg" width="1200" height="800" alt="…">\nimg { max-width: 100%; height: auto; }',
      effort: 'xs',
      acceptance: ['Every content <img> has width and height attributes or a CSS aspect-ratio.'],
    },
    check: ({ capture }) =>
      capture.facts.images
        .filter((i) => i.visible && !i.hasDimensions && i.renderedW * i.renderedH > 2500)
        .map((i) => ({ selector: i.selector, snippet: i.snippet, bbox: i.bbox, measured: 'no width/height', expected: `width="${i.naturalW || '…'}" height="${i.naturalH || '…'}"` })),
  },
  {
    id: 'ux.primary-action.missing',
    category: 'ux',
    severity: 'minor',
    title: 'No clear call to action above the fold',
    detail: 'Teardown found no button-styled primary action in the first screen (heuristic). Visitors may not know what to do next.',
    fix: {
      summary: 'Place one visually prominent primary action in the first viewport.',
      steps: ['Decide the main thing a visitor should do on this page.', 'Add a button-styled link for it near the top, using the brand accent colour.'],
      effort: 's',
      acceptance: ['A button-styled primary action is visible without scrolling at 1440x900 and 390x844.'],
    },
    check: ({ capture, primary }) => primary && capture.facts.primaryAction.checked && !capture.facts.primaryAction.found && { measured: 'none found', expected: '1 primary action' },
  },
  {
    id: 'ux.overlay.intrusive',
    category: 'ux',
    severity: 'serious',
    title: 'Overlay covers most of the screen on load',
    detail: 'A fixed overlay (cookie wall, popup or modal) covers over 40% of the screen when the page loads, blocking the content.',
    fix: {
      summary: 'Shrink the overlay to a small banner, or delay it until the visitor has engaged.',
      steps: ['Use a compact bottom banner for consent instead of a full-screen wall.', 'Delay marketing popups until scroll or exit intent.', 'Make sure it can be dismissed with Escape and a visible close button.'],
      effort: 'm',
      acceptance: ['No overlay covers more than 30% of the viewport on initial load.'],
    },
    check: ({ capture }) => capture.facts.overlays.map((o) => ({ selector: o.selector, snippet: o.snippet, bbox: o.bbox, measured: `${Math.round(o.coverage * 100)}% of viewport`, expected: '<= 30%' })),
  },
  {
    id: 'ux.media.autoplay',
    category: 'ux',
    severity: 'moderate',
    title: 'Media autoplays with sound',
    detail: 'Audio or video starts playing with sound on its own, which startles visitors and interferes with screen readers (WCAG 1.4.2).',
    supersedesAxe: ['no-autoplay-audio'],
    fix: {
      summary: 'Remove autoplay, or autoplay muted with visible controls.',
      steps: ['Remove the autoplay attribute, or add muted and playsinline.', 'Show controls so people can pause.'],
      codeHint: '<video src="intro.mp4" autoplay muted playsinline controls></video>',
      effort: 'xs',
      acceptance: ['No media plays sound without a user action.'],
    },
    check: ({ capture }) => capture.facts.autoplay.map((a) => ({ selector: a.selector, snippet: a.snippet, bbox: a.bbox, measured: 'autoplay with sound', expected: 'muted or user-started' })),
  },
  {
    id: 'ux.contrast.low',
    category: 'ux',
    severity: 'serious',
    title: 'Low-contrast text',
    detail: 'Text colours against their backgrounds fall below the WCAG AA contrast ratio, so they are hard to read, especially outdoors or for people with low vision.',
    fix: {
      summary: 'Darken the text (or lighten the background) until each pair reaches 4.5:1 (3:1 for large text).',
      steps: ['Pick the nearest brand colour that passes, or adjust lightness only.', 'Recheck each pair with a contrast checker.'],
      effort: 's',
      acceptance: ['Every text/background pair has at least 4.5:1 contrast (3:1 for 24px+ or 18.66px+ bold).'],
    },
    // Reported from brand extraction only when axe-core didn't run; otherwise axe's color-contrast covers it.
    check: ({ brand, axeRan }) =>
      !axeRan &&
      brand?.profile.contrast
        .filter((c) => !c.passAA)
        .map((c) => ({ selector: c.sampleSelector, measured: `${c.ratio}:1 (${c.fg} on ${c.bg})`, expected: c.largeText ? '>= 3:1' : '>= 4.5:1' })),
  },
];
