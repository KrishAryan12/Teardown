import type { Rule } from './types';

const VALID_LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i;

export const a11yRules: Rule[] = [
  {
    id: 'a11y.lang.missing',
    category: 'accessibility',
    severity: 'serious',
    title: 'Page language is not set',
    detail: 'The <html> element has no lang attribute, so screen readers may read the content with the wrong voice and pronunciation. Search engines also use it.',
    supersedesAxe: ['html-has-lang'],
    fix: {
      summary: 'Add a lang attribute with the page language to the <html> element.',
      steps: ['Set lang on <html> in your root layout or template.', 'Use the right code per locale if the site is multilingual.'],
      codeHint: '<html lang="en">',
      effort: 'xs',
      acceptance: ['<html> has a valid, non-empty lang attribute matching the content language.'],
      verify: 'In DevTools console: `document.documentElement.lang`',
    },
    check: ({ capture }) => !capture.facts.head.lang && { selector: 'html', measured: 'no lang', expected: 'lang="en" (or your language)' },
  },
  {
    id: 'a11y.lang.invalid',
    category: 'accessibility',
    severity: 'serious',
    title: 'Page language code is invalid',
    detail: "The lang attribute isn't a valid language code, so assistive tech can't use it.",
    supersedesAxe: ['html-lang-valid'],
    fix: {
      summary: 'Use a valid BCP 47 language code such as en, en-GB or fr.',
      steps: ['Replace the value on <html lang> with a valid code.'],
      effort: 'xs',
      acceptance: ['<html lang> is a valid BCP 47 code.'],
    },
    check: ({ capture }) => {
      const l = capture.facts.head.lang;
      return !!l && !VALID_LANG.test(l.trim()) && { selector: 'html', measured: `lang="${l.slice(0, 30)}"`, expected: 'e.g. lang="en"' };
    },
  },
  {
    id: 'a11y.img.alt',
    category: 'accessibility',
    severity: 'serious',
    title: 'Images without alt text',
    detail: 'Images have no alt attribute. Screen readers announce the file name instead, and search engines get no description. (This also covers the SEO alt-text check.)',
    supersedesAxe: ['image-alt'],
    fix: {
      summary: 'Give every meaningful image a short alt text describing it, and decorative images alt="".',
      steps: [
        'For each image, decide whether it conveys information.',
        'Meaningful: add alt text that says what the image shows or does (not "image of").',
        'Decorative: add alt="" so assistive tech skips it.',
        'Images inside links: describe the link destination.',
      ],
      codeHint: '<img src="team.jpg" alt="Three designers sketching a site map">\n<img src="divider.svg" alt="">',
      effort: 's',
      acceptance: ['Every <img> has an alt attribute (empty for decorative images) or role="presentation".', 'Linked images have alt text describing the link.'],
      verify: "In DevTools console: `document.querySelectorAll('img:not([alt])').length === 0`",
    },
    check: ({ capture }) =>
      capture.facts.images
        .filter((i) => i.alt === null && !i.ariaHidden && i.role !== 'presentation' && i.role !== 'none' && !i.ariaLabel && (i.visible || !capture.facts.hasLayout))
        .map((i) => ({ selector: i.selector, snippet: i.snippet, bbox: i.bbox, measured: 'no alt attribute', expected: 'alt="description" or alt=""' })),
  },
  {
    id: 'a11y.link.empty',
    category: 'accessibility',
    severity: 'serious',
    title: 'Links with no accessible name',
    detail: 'These links have no text, label or alt text, so screen readers announce only "link".',
    supersedesAxe: ['link-name'],
    fix: {
      summary: 'Give icon-only links an accessible name with aria-label or visually hidden text.',
      steps: ['Add aria-label describing the destination, or visually hidden text inside the link.', 'If the link wraps an image, give the image alt text describing the destination.'],
      codeHint: '<a href="/cart" aria-label="Shopping cart"><svg aria-hidden="true">…</svg></a>',
      effort: 'xs',
      acceptance: ['Every link has a non-empty accessible name.'],
    },
    check: ({ capture }) =>
      capture.facts.links
        .filter((l) => l.visible && !l.accessibleName.trim() && l.rawHref !== '#')
        .map((l) => ({ selector: l.selector, snippet: l.snippet, bbox: l.bbox, measured: 'empty name', expected: 'descriptive name' })),
  },
  {
    id: 'a11y.form.label',
    category: 'accessibility',
    severity: 'serious',
    title: 'Form fields without labels',
    detail: "These inputs have no label. Placeholder text isn't a label: it disappears while typing and many screen readers ignore it.",
    supersedesAxe: ['label', 'select-name'],
    fix: {
      summary: 'Connect a visible <label> to each field with for/id, or wrap the field in the label.',
      steps: ['Add a <label for="field-id"> with clear text for each input, select and textarea.', 'Keep placeholders only as examples, not as the label.', 'If a visible label is impossible, use aria-label.'],
      codeHint: '<label for="email">Email address</label>\n<input id="email" type="email" autocomplete="email">',
      effort: 's',
      acceptance: ['Every visible input, select and textarea has a programmatically associated label.'],
    },
    check: ({ capture }) =>
      capture.facts.unlabeledControls.map((c) => ({
        selector: c.selector,
        snippet: c.snippet,
        bbox: c.bbox,
        measured: c.placeholder ? `placeholder only ("${c.placeholder.slice(0, 40)}")` : 'no label',
        expected: '<label for> or aria-label',
      })),
  },
  {
    id: 'a11y.skip-link.missing',
    category: 'accessibility',
    severity: 'moderate',
    title: 'No skip link',
    detail: 'Keyboard users have to tab through the whole header and navigation on every page before reaching the content.',
    supersedesAxe: ['bypass'],
    fix: {
      summary: 'Add a "Skip to content" link as the first focusable element, visible on focus, pointing at the main content.',
      steps: ['Add the link as the first element inside <body>.', 'Give <main> an id and point the link at it.', 'Hide it off-screen until it receives focus.'],
      codeHint:
        '<a class="skip-link" href="#main">Skip to content</a>\n…\n<main id="main">\n\n.skip-link { position: absolute; left: -999px; }\n.skip-link:focus { left: 1rem; top: 1rem; }',
      effort: 'xs',
      acceptance: ['Pressing Tab once on page load focuses a visible "Skip to content" link.', 'Activating it moves focus to the main content.'],
      verify: 'Load the page, press Tab once, then Enter; focus should land on the main content.',
    },
    check: ({ capture }) => !capture.facts.skipLink.found && capture.facts.linkCount >= 8 && { measured: 'none', expected: 'first focusable element' },
  },
  {
    id: 'a11y.focus.invisible',
    category: 'accessibility',
    severity: 'serious',
    title: 'Keyboard focus is invisible',
    detail: 'When these elements receive keyboard focus nothing visibly changes, so keyboard users lose track of where they are (WCAG 2.4.7).',
    fix: {
      summary: 'Give every interactive element a clearly visible :focus-visible style, and never remove outlines without a replacement.',
      steps: ['Search the CSS for `outline: none` / `outline: 0` on :focus.', 'Add a :focus-visible rule with an outline of at least 2px in a colour with 3:1 contrast.', 'Check buttons, links and form fields by tabbing through the page.'],
      codeHint: ':where(a, button, input, select, textarea, [tabindex]):focus-visible {\n  outline: 3px solid var(--color-accent);\n  outline-offset: 2px;\n}',
      effort: 's',
      acceptance: ['Every focusable element shows a visible focus indicator with at least 3:1 contrast against its surroundings.'],
      verify: 'Tab through the page; you should always see which element has focus.',
    },
    check: ({ capture }) =>
      capture.facts.focus.tested >= 2 &&
      capture.facts.focus.invisible.map((f) => ({ selector: f.selector, snippet: f.snippet, bbox: f.bbox, measured: 'no visible change on focus', expected: 'visible outline or style change' })),
  },
  {
    id: 'a11y.landmark.main',
    category: 'accessibility',
    severity: 'moderate',
    title: 'No main landmark',
    detail: "There's no <main> element. Screen reader users can't jump straight to the content, and skip links have nothing to target.",
    supersedesAxe: ['landmark-one-main'],
    fix: {
      summary: 'Wrap the primary content in a single <main> element, and use <header>, <nav> and <footer> for the rest.',
      steps: ['Wrap the page content (not header/footer) in <main id="main">.', 'Use <nav> for navigation blocks and <header>/<footer> for the page banner and footer.'],
      codeHint: '<header>…</header>\n<main id="main">…</main>\n<footer>…</footer>',
      effort: 's',
      acceptance: ['The page has exactly one <main> (or role="main").', 'Navigation is inside <nav>.'],
    },
    check: ({ capture }) => capture.facts.landmarks.main === 0 && { measured: '0 main', expected: '1 main' },
  },
];
