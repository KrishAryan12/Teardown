import {
  clusterColors,
  contrastRatio,
  nearDuplicatePairs,
  parseColor,
  passesAA,
  passesAAA,
  saturation,
  type BrandProfile,
  type ColorRole,
  type FontUse,
} from '@teardown/core';
import type { BrandRaw } from '../capture/types';

/** Extra analysis the brand rules need, not part of the public profile. */
export interface BrandAnalysis {
  profile: BrandProfile;
  nearDuplicates: [string, string][];
  buttonVariants: { count: number; selector: string; text: string }[];
  weightCount: number;
  distinctSizes: number;
  sampled: number;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const SYSTEM = new Set([
  'arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia', 'verdana', 'tahoma', 'trebuchet ms',
  'courier', 'courier new', 'segoe ui', 'roboto', 'sf pro', 'sf pro text', 'sf pro display', 'menlo', 'monaco', 'consolas',
  'lucida grande', 'lucida console', 'comic sans ms', 'impact', 'garamond', 'palatino', 'cambria', 'calibri', 'noto sans',
  'ubuntu', 'cantarell', 'oxygen', 'fira sans', 'liberation sans', 'dejavu sans', 'apple color emoji', 'segoe ui emoji',
]);

const KNOWN_RATIOS: [number, string][] = [
  [1.067, 'minor second'],
  [1.125, 'major second'],
  [1.2, 'minor third'],
  [1.25, 'major third'],
  [1.333, 'perfect fourth'],
  [1.414, 'augmented fourth'],
  [1.5, 'perfect fifth'],
  [1.618, 'golden ratio'],
];

export function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').replace(/["']/g, '').trim();
}

function fontSource(family: string, raw: BrandRaw): BrandProfile['fonts'][number]['source'] {
  const f = family.toLowerCase();
  const googleLinked = raw.fontLinks.some((l) => /fonts\.googleapis\.com|fonts\.bunny\.net/.test(l) && decodeURIComponent(l).toLowerCase().replace(/\+/g, ' ').includes(f));
  const face = raw.fontFaces.find((ff) => ff.family.toLowerCase() === f);
  if (googleLinked || (face && /fonts\.gstatic\.com/.test(face.src))) return 'google';
  if (face) return 'self-hosted';
  if (GENERIC.has(f) || SYSTEM.has(f)) return 'system';
  if (raw.importsGoogle && raw.fontLinks.length === 0) return 'unknown';
  return 'unknown';
}

function roleFor(tags: Record<string, number>, sat: number, lightness: number, kindWeights: Record<string, number>): ColorRole {
  const bg = kindWeights.bg ?? 0;
  const text = kindWeights.text ?? 0;
  const border = kindWeights.border ?? 0;
  const interactive = tags.interactive ?? 0;
  const total = bg + text + border + (kindWeights.svg ?? 0) || 1;
  if (sat > 0.35 && interactive > 0 && lightness > 0.08 && lightness < 0.92) return 'accent';
  if (bg / total > 0.5) return 'background';
  if (text / total > 0.5) return sat > 0.45 ? 'accent' : 'text';
  if (border / total > 0.5) return 'border';
  if (sat > 0.45) return 'accent';
  return 'other';
}

/** Turns raw in-page samples (one page or the union of several) into a BrandProfile. */
export function processBrand(raws: BrandRaw[]): BrandAnalysis {
  const raw = mergeRaw(raws);

  /* Colours: normalise each kind to the same total so text (chars) and backgrounds (area) compare. */
  const KIND_IMPORTANCE: Record<string, number> = { bg: 0.45, text: 0.35, border: 0.1, svg: 0.1 };
  const kindTotals: Record<string, number> = {};
  for (const c of raw.colors) kindTotals[c.kind] = (kindTotals[c.kind] ?? 0) + c.weight;
  const samples = raw.colors.map((c) => ({
    hex: c.hex,
    weight: ((KIND_IMPORTANCE[c.kind] ?? 0.1) * c.weight) / (kindTotals[c.kind] || 1),
    tags: [c.kind, ...(c.interactive ? ['interactive'] : [])],
  }));
  const clusters = clusterColors(samples, 4).filter((c) => c.weight > 0.002);
  const totalWeight = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  const colors = clusters.slice(0, 16).map((c) => {
    const rgb = parseColor(c.hex)!;
    const lightness = (Math.max(rgb.r, rgb.g, rgb.b) + Math.min(rgb.r, rgb.g, rgb.b)) / 510;
    const kindWeights: Record<string, number> = {};
    for (const s of samples) if (c.members.includes(s.hex)) kindWeights[s.tags[0]!] = (kindWeights[s.tags[0]!] ?? 0) + s.weight;
    return {
      hex: c.hex,
      role: roleFor(c.tags, saturation(rgb), lightness, kindWeights),
      share: Math.round((c.weight / totalWeight) * 1000) / 1000,
      samples: c.samples,
    };
  });

  /* Fonts: group by first family. */
  const famMap = new Map<string, { stack: string; weights: Set<number>; chars: number; roles: Record<string, number> }>();
  for (const f of raw.fonts) {
    const fam = firstFamily(f.family);
    if (!fam) continue;
    const e = famMap.get(fam) ?? { stack: f.family, weights: new Set<number>(), chars: 0, roles: {} };
    e.weights.add(f.weight);
    e.chars += f.chars;
    for (const [r, n] of Object.entries(f.roles ?? {})) e.roles[r] = (e.roles[r] ?? 0) + n;
    famMap.set(fam, e);
  }
  const totalChars = [...famMap.values()].reduce((s, f) => s + f.chars, 0) || 1;
  const fonts = [...famMap.entries()]
    .filter(([, f]) => f.chars / totalChars > 0.005)
    .sort((a, b) => b[1].chars - a[1].chars)
    .slice(0, 8)
    .map(([family, f]) => {
      const usedFor = (Object.entries(f.roles) as [FontUse, number][])
        .filter(([, n]) => n / f.chars > 0.15)
        .sort((a, b) => b[1] - a[1])
        .map(([r]) => r);
      const source = fontSource(family, raw);
      // CDP names for web fonts are internal font names (often garbage); only useful for system fallbacks.
      const renderedRaw = raw.platformFonts?.[family];
      const rendered = (source === 'system' || source === 'unknown') && renderedRaw && /^[\w .&'-]{2,60}$/.test(renderedRaw) ? renderedRaw : undefined;
      return {
        family,
        source,
        weights: [...f.weights].sort((a, b) => a - b),
        usedFor: usedFor.length ? usedFor : (['body'] as FontUse[]),
        fallbackStack: f.stack.slice(0, 300),
        ...(rendered && rendered.toLowerCase() !== family.toLowerCase() ? { rendered } : {}),
      };
    });

  /* Type scale */
  const sizes = raw.sizes
    .map((s) => ({ px: Number(s.key), count: s.count, sampleTag: topKey(s.tags) }))
    .filter((s) => s.px > 0)
    .sort((a, b) => b.count - a.count);
  const typeScale = sizes.slice(0, 16).sort((a, b) => a.px - b.px);
  const typeScaleRatio = fitRatio(typeScale.filter((s) => s.count >= 2).map((s) => s.px));

  /* Spacing */
  const spacingValues = raw.spacing.map((s) => ({ px: Number(s.key), count: s.count })).filter((s) => s.px > 0);
  const spacingTotal = spacingValues.reduce((s, v) => s + v.count, 0) || 1;
  const onGrid = (u: number) => spacingValues.filter((v) => Math.abs(v.px / u - Math.round(v.px / u)) < 0.06 || v.px === 1 || v.px === 2).reduce((s, v) => s + v.count, 0) / spacingTotal;
  const r8 = onGrid(8);
  const r4 = onGrid(4);
  const r5 = onGrid(5);
  // 8 and 4 first (most systems), then 5 (e.g. GOV.UK's scale).
  const baseUnit = r8 >= 0.8 ? 8 : r4 >= 0.75 ? 4 : r5 >= 0.75 ? 5 : undefined;
  const spacing = {
    ...(baseUnit ? { baseUnit } : {}),
    onGridRatio: Math.round((baseUnit === 8 ? r8 : baseUnit === 5 ? r5 : r4) * 100) / 100,
    values: spacingValues.sort((a, b) => b.count - a.count).slice(0, 24).sort((a, b) => a.px - b.px),
  };

  const radii = raw.radii.map((r) => ({ px: Number(r.key), count: r.count })).sort((a, b) => b.count - a.count).slice(0, 12).sort((a, b) => a.px - b.px);
  const shadows = raw.shadows.sort((a, b) => b.count - a.count).slice(0, 6).map((s) => s.key);

  /* Contrast pairs, recomputed with the shared WCAG math. */
  const pairMap = new Map<string, BrandProfile['contrast'][number] & { chars: number }>();
  for (const c of raw.contrast) {
    const fg = parseColor(c.fg);
    const bg = parseColor(c.bg);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    const key = `${c.fg}|${c.bg}|${c.large ? 1 : 0}`;
    const prev = pairMap.get(key);
    if (prev) {
      prev.count += c.count;
      prev.chars += c.chars;
    } else
      pairMap.set(key, {
        fg: c.fg,
        bg: c.bg,
        ratio,
        passAA: passesAA(ratio, c.large),
        passAAA: passesAAA(ratio, c.large),
        count: c.count,
        sampleSelector: c.selector?.slice(0, 300),
        largeText: c.large,
        chars: c.chars,
      });
  }
  const contrast = [...pairMap.values()]
    .sort((a, b) => Number(a.passAA) - Number(b.passAA) || b.chars - a.chars)
    .slice(0, 24)
    .map(({ chars: _chars, ...p }) => p);

  const cssVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.cssVars)) {
    if (Object.keys(cssVariables).length >= 60) break;
    if (/^(#|rgb|hsl|oklch|lab|color\()/i.test(v) || /^-?[\d.]+(px|rem|em|%|vw|vh|ch)$/.test(v) || /,|serif|sans|mono/.test(v)) cssVariables[k] = v;
  }

  // Near-duplicates: distinct exact values that clustering merged (ΔE <= 4), plus representatives within ΔE 6.
  const nearDuplicates: [string, string][] = [
    ...clusters.flatMap((c) => c.members.filter((m) => m !== c.hex).map((m) => [c.hex, m] as [string, string])),
    ...nearDuplicatePairs(colors.map((c) => c.hex), 4, 6),
  ].slice(0, 20);
  const weightCount = new Set(raw.fonts.map((f) => f.weight)).size;
  const buttonVariants = raw.buttons
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((b) => ({ count: b.count, selector: b.selector, text: b.text }));

  const notes: string[] = [];
  if (fonts.length > 3) notes.push(`${fonts.length} font families in use; most systems need 2 or 3.`);
  if (nearDuplicates.length >= 2) notes.push(`${nearDuplicates.length} pairs of colours are near-duplicates and could be merged.`);
  if (!baseUnit) notes.push(`Spacing doesn't follow a 4, 5 or 8px grid (${Math.round(r4 * 100)}% of values are multiples of 4).`);
  if (typeScaleRatio) notes.push(`Type sizes roughly follow a ${typeScaleRatio.toFixed(3)} ratio${ratioName(typeScaleRatio)}.`);
  if (Object.keys(cssVariables).length === 0) notes.push('No CSS custom properties (design tokens) were found on :root.');
  if (buttonVariants.length > 3) notes.push(`${buttonVariants.length} different button styles were found.`);

  const profile: BrandProfile = {
    colors,
    cssVariables,
    fonts,
    typeScale,
    ...(typeScaleRatio ? { typeScaleRatio } : {}),
    spacing,
    radii,
    shadows,
    contrast,
    contrastUnknown: raw.contrastUnknown,
    assets: {
      ...(raw.assets.logoUrl ? { logoUrl: raw.assets.logoUrl.slice(0, 2000) } : {}),
      ...(raw.assets.favicon ? { favicon: raw.assets.favicon.slice(0, 2000) } : {}),
      ...(raw.assets.themeColor ? { themeColor: raw.assets.themeColor.slice(0, 60) } : {}),
      ...(raw.assets.ogImage ? { ogImage: raw.assets.ogImage.slice(0, 2000) } : {}),
    },
    consistency: { colorCount: clusters.length, fontCount: fonts.length, notes: notes.slice(0, 12) },
  };
  return { profile, nearDuplicates, buttonVariants, weightCount, distinctSizes: sizes.length, sampled: raw.sampled };
}

function topKey(m: Record<string, number> | undefined): string | undefined {
  if (!m) return undefined;
  return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function ratioName(r: number): string {
  const hit = KNOWN_RATIOS.find(([k]) => Math.abs(k - r) < 0.02);
  return hit ? ` (${hit[1]})` : '';
}

/**
 * Fits a modular scale: the geometric mean of consecutive size ratios, accepted only when
 * every step is within 12% of a whole power of it.
 */
export function fitRatio(pxs: number[]): number | undefined {
  const sizes = [...new Set(pxs.map((p) => Math.round(p)))].filter((p) => p >= 10).sort((a, b) => a - b);
  if (sizes.length < 4) return undefined;
  const base = sizes.find((s) => s >= 14 && s <= 18) ?? sizes[0]!;
  let best: { r: number; err: number } | undefined;
  // Ratios below ~1.12 fit almost any set of sizes, so they say nothing about rhythm.
  for (let r = 1.12; r <= 1.7; r += 0.005) {
    let err = 0;
    const steps = new Set<number>();
    for (const s of sizes) {
      const k = Math.round(Math.log(s / base) / Math.log(r));
      steps.add(k);
      err = Math.max(err, Math.abs(base * r ** k - s) / s);
    }
    // A real scale uses its steps densely; a small ratio that skips most steps fits anything.
    const span = Math.max(...steps) - Math.min(...steps) + 1;
    if (span > sizes.length + 2 || steps.size < sizes.length - 1) continue;
    if (!best || err < best.err) best = { r, err };
  }
  return best && best.err <= 0.06 ? Math.round(best.r * 1000) / 1000 : undefined;
}

function mergeRaw(raws: BrandRaw[]): BrandRaw {
  if (raws.length === 1) return raws[0]!;
  const sumBy = <T extends { key: string; count: number }>(lists: T[][], merge?: (a: T, b: T) => void): T[] => {
    const m = new Map<string, T>();
    for (const list of lists)
      for (const e of list) {
        const prev = m.get(e.key);
        if (prev) {
          prev.count += e.count;
          merge?.(prev, e);
        } else m.set(e.key, structuredClone(e));
      }
    return [...m.values()];
  };
  const first = raws[0]!;
  return {
    sampled: raws.reduce((s, r) => s + r.sampled, 0),
    colors: sumBy(raws.map((r) => r.colors), (a, b) => (a.weight += b.weight)),
    fonts: sumBy(raws.map((r) => r.fonts), (a, b) => {
      a.chars += b.chars;
      for (const [k, v] of Object.entries(b.roles)) a.roles[k] = (a.roles[k] ?? 0) + v;
    }),
    sizes: sumBy(raws.map((r) => r.sizes), (a, b) => {
      for (const [k, v] of Object.entries(b.tags)) a.tags[k] = (a.tags[k] ?? 0) + v;
    }),
    spacing: sumBy(raws.map((r) => r.spacing)),
    radii: sumBy(raws.map((r) => r.radii)),
    shadows: sumBy(raws.map((r) => r.shadows)),
    contrast: sumBy(raws.map((r) => r.contrast), (a, b) => (a.chars += b.chars)),
    contrastUnknown: raws.reduce((s, r) => s + r.contrastUnknown, 0),
    buttons: sumBy(raws.map((r) => r.buttons)),
    cssVars: Object.assign({}, ...raws.map((r) => r.cssVars)),
    fontFaces: raws.flatMap((r) => r.fontFaces).slice(0, 100),
    fontLinks: [...new Set(raws.flatMap((r) => r.fontLinks))],
    importsGoogle: raws.some((r) => r.importsGoogle),
    assets: first.assets,
    platformFonts: Object.assign({}, ...raws.map((r) => r.platformFonts ?? {})),
  };
}

/** Profile used when no computed-style data exists (static fallback). */
export function emptyBrand(assets: Partial<BrandProfile['assets']> = {}): BrandProfile {
  return {
    colors: [],
    cssVariables: {},
    fonts: [],
    typeScale: [],
    spacing: { onGridRatio: 0, values: [] },
    radii: [],
    shadows: [],
    contrast: [],
    contrastUnknown: 0,
    assets: Object.fromEntries(Object.entries(assets).filter(([, v]) => v)) as BrandProfile['assets'],
    consistency: { colorCount: 0, fontCount: 0, notes: ['Brand data needs a real browser; this scan ran in reduced-accuracy mode.'] },
  };
}
