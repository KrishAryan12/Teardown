import type { Rule } from './types';

export const brandRules: Rule[] = [
  {
    id: 'brand.colors.near-duplicates',
    category: 'brand',
    severity: 'moderate',
    title: 'Near-duplicate colours',
    detail: 'Several colours in use are almost identical. They usually come from one-off hex values instead of shared tokens, and make the palette feel slightly off.',
    fix: {
      summary: 'Merge each near-duplicate pair into one token and replace the stray values.',
      steps: ['Pick the canonical value of each pair (the more common one).', 'Define it once as a CSS custom property.', 'Search the codebase for the other hex values and replace them with the variable.'],
      codeHint: ':root { --color-link: #1a5fb4; }\n.a, .b, .c { color: var(--color-link); }',
      effort: 'm',
      acceptance: ['No two colours in the extracted palette are within ΔE 6 of each other unless intentionally distinct.'],
    },
    check: ({ brand }) =>
      !!brand &&
      brand.nearDuplicates.length >= 2 &&
      brand.nearDuplicates.slice(0, 6).map(([a, b]) => ({ measured: `${a} ≈ ${b}`, expected: 'one shared colour token' })),
  },
  {
    id: 'brand.fonts.too-many',
    category: 'brand',
    severity: 'moderate',
    title: 'Too many font families',
    detail: 'More than three typefaces are in use. It dilutes the brand and every web font adds download weight.',
    fix: {
      summary: 'Reduce to two families (one for headings, one for body), plus a monospace if you show code.',
      steps: ['Pick the heading and body faces that best represent the brand.', 'Replace the others with those, using weights for hierarchy.', 'Remove unused @font-face rules and font links.'],
      effort: 'm',
      acceptance: ['At most 3 font families render on the page.'],
    },
    check: ({ brand }) =>
      !!brand && brand.profile.fonts.length > 3 && { measured: `${brand.profile.fonts.length} families: ${brand.profile.fonts.map((f) => f.family).join(', ')}`.slice(0, 190), expected: '<= 3 families' },
  },
  {
    id: 'brand.fonts.weights',
    category: 'brand',
    severity: 'minor',
    title: 'Many font weights',
    detail: 'More than five font weights are in use. Each web-font weight is a separate download and the hierarchy gets muddy.',
    fix: {
      summary: 'Limit the system to 2-4 weights (e.g. 400, 600, 700).',
      steps: ['List the weights in use and map each to the closest of your chosen set.', 'Remove unused weight files.'],
      effort: 's',
      acceptance: ['At most 4 distinct font weights render on the page.'],
    },
    check: ({ brand }) => !!brand && brand.weightCount > 5 && { measured: `${brand.weightCount} weights`, expected: '<= 4 weights' },
  },
  {
    id: 'brand.type-scale.irregular',
    category: 'brand',
    severity: 'minor',
    title: 'Font sizes follow no scale',
    detail: "Many different font sizes are used and they don't follow a consistent ratio, so the hierarchy looks improvised.",
    fix: {
      summary: 'Define a type scale (e.g. 1.25 ratio from 16px) as tokens and map every size to a step.',
      steps: ['Choose a base (16px) and ratio (1.2 or 1.25).', 'Define the steps as custom properties.', 'Replace one-off font sizes with the nearest step.'],
      codeHint: ':root {\n  --step-0: 1rem;\n  --step-1: 1.25rem;\n  --step-2: 1.5625rem;\n  --step-3: 1.953rem;\n}',
      effort: 'm',
      acceptance: ['Text uses at most 8 distinct sizes, each a step of one scale.'],
    },
    check: ({ brand }) => !!brand && !brand.profile.typeScaleRatio && brand.distinctSizes > 8 && { measured: `${brand.distinctSizes} distinct sizes, no consistent ratio`, expected: '<= 8 sizes on one scale' },
  },
  {
    id: 'brand.spacing.off-grid',
    category: 'brand',
    severity: 'minor',
    title: 'Spacing is off-grid',
    detail: 'Margins and paddings use arbitrary values instead of multiples of a base unit, so rhythm and alignment drift.',
    fix: {
      summary: 'Adopt a 4px or 8px spacing scale as tokens and snap values to it.',
      steps: ['Define spacing tokens (4, 8, 12, 16, 24, 32, 48…).', 'Replace odd values (7px, 13px, 19px) with the nearest token.'],
      codeHint: ':root { --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px; --space-5: 32px; }',
      effort: 'm',
      acceptance: ['At least 80% of margin, padding and gap values are multiples of 4px.'],
    },
    check: ({ brand }) =>
      !!brand && !brand.profile.spacing.baseUnit && brand.profile.spacing.values.length >= 4 && {
        measured: `${Math.round(brand.profile.spacing.onGridRatio * 100)}% on a 4px grid`,
        expected: '>= 80%',
      },
  },
  {
    id: 'brand.radii.inconsistent',
    category: 'brand',
    severity: 'minor',
    title: 'Inconsistent corner radii',
    detail: 'Many different border radii are in use, so cards, buttons and inputs look like they come from different systems.',
    fix: {
      summary: 'Define 2-3 radius tokens (small, medium, pill) and use only those.',
      steps: ['Choose the radii you want to keep.', 'Replace the rest with the nearest token.'],
      codeHint: ':root { --radius-sm: 4px; --radius-md: 8px; --radius-pill: 9999px; }',
      effort: 's',
      acceptance: ['At most 3 distinct non-zero border radii are used.'],
    },
    check: ({ brand }) => {
      const r = brand?.profile.radii.filter((x) => x.px > 0 && x.px < 9999) ?? [];
      return r.length > 3 && { measured: `${r.length} radii: ${r.map((x) => x.px + 'px').join(', ')}`.slice(0, 190), expected: '<= 3 radii' };
    },
  },
  {
    id: 'brand.buttons.inconsistent',
    category: 'brand',
    severity: 'moderate',
    title: 'Buttons come in many styles',
    detail: 'Button-like elements use several different combinations of colour, padding, radius and type, which weakens the visual hierarchy.',
    fix: {
      summary: 'Define primary, secondary and tertiary button styles and apply them everywhere.',
      steps: ['Write one button component or class set with variants.', 'Replace one-off button styles with a variant.'],
      codeHint: '.btn { padding: 12px 20px; border-radius: var(--radius-md); font-weight: 600; }\n.btn--primary { background: var(--color-accent); color: #fff; }\n.btn--secondary { background: transparent; border: 1px solid currentColor; }',
      effort: 'm',
      acceptance: ['All button-like elements use one of at most 3 defined variants.'],
    },
    check: ({ brand }) =>
      !!brand &&
      brand.buttonVariants.length > 3 &&
      brand.buttonVariants.slice(0, 6).map((b) => ({ selector: b.selector, measured: `${brand.buttonVariants.length} variants`, expected: '<= 3 variants', detail: `Button style variant used ${b.count}x, e.g. "${b.text}".` })),
  },
  {
    id: 'brand.tokens.none',
    category: 'brand',
    severity: 'minor',
    title: 'No design tokens in CSS',
    detail: 'No CSS custom properties were found on :root. Tokens make brand colours, type and spacing consistent and easy to change. (Informational; cross-origin stylesheets cannot be read.)',
    fix: {
      summary: 'Move brand values into CSS custom properties. The brand tokens in this report are a ready-made starting point.',
      steps: ['Paste the generated :root block into your global stylesheet.', 'Replace hard-coded values with var(--…) references, component by component.'],
      effort: 'm',
      acceptance: [':root defines colour, font, spacing and radius custom properties used by components.'],
    },
    check: ({ brand, primary }) => primary && !!brand && Object.keys(brand.profile.cssVariables).length === 0 && { measured: '0 tokens', expected: 'colour, type, spacing tokens' },
  },
];
