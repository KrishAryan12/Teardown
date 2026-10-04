/** Color math: parsing computed colors, WCAG contrast, CIELAB, CIEDE2000 and clustering. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` in legacy or space syntax. Returns null otherwise. */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16));
      return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const alpha = (p: string | undefined) => (p === undefined ? 1 : p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));
  const r = channel(parts[0]!);
  const g = channel(parts[1]!);
  const b = channel(parts[2]!);
  const a = alpha(parts[3]);
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Math.max(0, Math.min(1, a)) };
}

export function toHex(c: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return '#' + [c.r, c.g, c.b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('');
}

/** Alpha-composites `top` over an opaque `bottom`. */
export function flatten(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function channelLuminance(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(c: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  return 0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b);
}

/** WCAG 2.x contrast ratio, rounded to 2 decimals. */
export function contrastRatio(fg: Pick<Rgba, 'r' | 'g' | 'b'>, bg: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** WCAG large text: >= 24px, or >= 18.66px (14pt) and bold. */
export function isLargeText(px: number, weight: number): boolean {
  return px >= 24 || (px >= 18.66 && weight >= 700);
}

export function passesAA(ratio: number, large: boolean): boolean {
  return ratio >= (large ? 3 : 4.5);
}

export function passesAAA(ratio: number, large: boolean): boolean {
  return ratio >= (large ? 4.5 : 7);
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function rgbToLab(c: Pick<Rgba, 'r' | 'g' | 'b'>): Lab {
  const r = channelLuminance(c.r);
  const g = channelLuminance(c.g);
  const b = channelLuminance(c.b);
  // sRGB -> XYZ (D65)
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIEDE2000 colour difference. ~2.3 is a just-noticeable difference. */
export function deltaE2000(x: Lab, y: Lab): number {
  const rad = Math.PI / 180;
  const c1 = Math.hypot(x.a, x.b);
  const c2 = Math.hypot(y.a, y.b);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1 = (1 + g) * x.a;
  const a2 = (1 + g) * y.a;
  const c1p = Math.hypot(a1, x.b);
  const c2p = Math.hypot(a2, y.b);
  const hue = (bb: number, aa: number) => {
    if (bb === 0 && aa === 0) return 0;
    const h = Math.atan2(bb, aa) / rad;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(x.b, a1);
  const h2p = hue(y.b, a2);
  const dLp = y.l - x.l;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);
  const lBarp = (x.l + y.l) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBarp = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hBarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hBarp = (h1p + h2p) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarp - 30) * rad) +
    0.24 * Math.cos(2 * hBarp * rad) +
    0.32 * Math.cos((3 * hBarp + 6) * rad) -
    0.2 * Math.cos((4 * hBarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarp ** 7 / (cBarp ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh));
}

/** Saturation in HSL terms, 0..1. */
export function saturation(c: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

export interface ColorSample {
  hex: string;
  weight: number;
  /** Optional per-sample tags (e.g. 'bg', 'text', 'interactive'), merged into the cluster. */
  tags?: string[];
}

export interface ColorCluster {
  hex: string;
  weight: number;
  samples: number;
  members: string[];
  tags: Record<string, number>;
}

/**
 * Greedy clustering in CIELAB: samples sorted by weight; each joins the first cluster whose
 * representative is within `threshold` (CIEDE2000), otherwise starts a new one.
 * The representative is the heaviest member, so it is always a colour that really appears.
 */
export function clusterColors(samples: ColorSample[], threshold = 4): ColorCluster[] {
  const merged = new Map<string, ColorSample & { n: number }>();
  for (const s of samples) {
    const hex = s.hex.toLowerCase();
    const prev = merged.get(hex);
    if (prev) {
      prev.weight += s.weight;
      prev.n += 1;
      prev.tags = [...(prev.tags ?? []), ...(s.tags ?? [])];
    } else merged.set(hex, { hex, weight: s.weight, n: 1, tags: [...(s.tags ?? [])] });
  }
  const sorted = [...merged.values()].sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));
  const clusters: (ColorCluster & { lab: Lab })[] = [];
  for (const s of sorted) {
    const rgb = parseColor(s.hex);
    if (!rgb) continue;
    const lab = rgbToLab(rgb);
    const hit = clusters.find((c) => deltaE2000(c.lab, lab) <= threshold);
    const target = hit ?? { hex: s.hex, weight: 0, samples: 0, members: [], tags: {}, lab };
    if (!hit) clusters.push(target);
    target.weight += s.weight;
    target.samples += s.n;
    target.members.push(s.hex);
    for (const t of s.tags ?? []) target.tags[t] = (target.tags[t] ?? 0) + 1;
  }
  return clusters
    .map(({ lab: _lab, ...c }) => c)
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));
}

/** Counts pairs of distinct clusters that are near-duplicates (visible but tiny difference). */
export function nearDuplicatePairs(hexes: string[], min = 1, max = 6): [string, string][] {
  const labs = hexes.map((h) => ({ h, lab: rgbToLab(parseColor(h)!) }));
  const out: [string, string][] = [];
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE2000(labs[i]!.lab, labs[j]!.lab);
      if (d > min && d <= max) out.push([labs[i]!.h, labs[j]!.h]);
    }
  }
  return out;
}
