import type { BrandProfile } from './schema';

export interface DesignTokens {
  $description: string;
  color: Record<string, { value: string; role?: string; share: number }>;
  font: Record<string, { family: string; stack: string; weights: number[]; source: string }>;
  fontSize: Record<string, string>;
  space: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  sourceVariables: Record<string, string>;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'x';

/** Names colours by inferred role, numbering repeats: background, background-2, text, accent... */
function colorNames(brand: BrandProfile): [string, BrandProfile['colors'][number]][] {
  const used = new Map<string, number>();
  return brand.colors.slice(0, 12).map((c) => {
    const base = c.role ?? 'other';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return [n === 1 ? base : `${base}-${n}`, c];
  });
}

function fontName(usedFor: string[], i: number): string {
  if (usedFor.includes('heading') && usedFor.includes('body')) return i === 0 ? 'base' : `family-${i + 1}`;
  return usedFor[0] ?? `family-${i + 1}`;
}

export function brandToTokens(brand: BrandProfile): DesignTokens {
  const color: DesignTokens['color'] = {};
  for (const [name, c] of colorNames(brand)) color[name] = { value: c.hex, role: c.role, share: round(c.share, 3) };

  const font: DesignTokens['font'] = {};
  const seen = new Set<string>();
  brand.fonts.slice(0, 6).forEach((f, i) => {
    let name = fontName(f.usedFor, i);
    if (seen.has(name)) name = `${name}-${i + 1}`;
    seen.add(name);
    font[name] = { family: f.family, stack: f.fallbackStack, weights: f.weights, source: f.source };
  });

  const fontSize: Record<string, string> = {};
  [...brand.typeScale]
    .sort((a, b) => a.px - b.px)
    .slice(0, 10)
    .forEach((t, i) => (fontSize[`step-${i}`] = `${round(t.px / 16, 4)}rem`));

  const space: Record<string, string> = {};
  if (brand.spacing.baseUnit) {
    const u = brand.spacing.baseUnit;
    [1, 2, 3, 4, 6, 8, 12, 16].forEach((m) => (space[String(m)] = `${u * m}px`));
  } else {
    [...brand.spacing.values]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .sort((a, b) => a.px - b.px)
      .forEach((v, i) => (space[`step-${i}`] = `${v.px}px`));
  }

  const radius: Record<string, string> = {};
  [...brand.radii]
    .filter((r) => r.px > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .sort((a, b) => a.px - b.px)
    .forEach((r, i, arr) => (radius[arr.length === 1 ? 'base' : ['sm', 'md', 'lg', 'xl'][i]!] = r.px >= 999 ? '9999px' : `${r.px}px`));

  const shadow: Record<string, string> = {};
  brand.shadows.slice(0, 3).forEach((s, i) => (shadow[['sm', 'md', 'lg'][i]!] = s));

  return {
    $description: 'Design tokens extracted by Teardown from computed styles. Adopt these instead of inventing new values.',
    color,
    font,
    fontSize,
    space,
    radius,
    shadow,
    sourceVariables: brand.cssVariables,
  };
}

/** A ready-to-paste `:root { ... }` block. */
export function tokensToCss(tokens: DesignTokens): string {
  const lines: string[] = [];
  const push = (k: string, v: string) => lines.push(`  --${k}: ${sanitizeCssValue(v)};`);
  for (const [k, v] of Object.entries(tokens.color)) push(`color-${slug(k)}`, v.value);
  for (const [k, v] of Object.entries(tokens.font)) push(`font-${slug(k)}`, v.stack || v.family);
  for (const [k, v] of Object.entries(tokens.fontSize)) push(`font-size-${slug(k)}`, v);
  for (const [k, v] of Object.entries(tokens.space)) push(`space-${slug(k)}`, v);
  for (const [k, v] of Object.entries(tokens.radius)) push(`radius-${slug(k)}`, v);
  for (const [k, v] of Object.entries(tokens.shadow)) push(`shadow-${slug(k)}`, v);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Keeps values from breaking out of a declaration or comment. */
function sanitizeCssValue(v: string): string {
  return v.replace(/[;{}<>]|\/\*|\*\//g, '').trim();
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
