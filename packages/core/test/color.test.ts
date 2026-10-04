import { describe, expect, it } from 'vitest';
import {
  clusterColors,
  contrastRatio,
  deltaE2000,
  flatten,
  isLargeText,
  parseColor,
  passesAA,
  rgbToLab,
  toHex,
} from '../src/color';

describe('parseColor', () => {
  it('parses hex, rgb and rgba forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0D2B4B')).toEqual({ r: 13, g: 43, b: 75, a: 1 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('transparent')?.a).toBe(0);
  });
  it('rejects junk', () => {
    expect(parseColor('linear-gradient(red, blue)')).toBeNull();
    expect(parseColor('#zzz')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBe(21);
    expect(contrastRatio(parseColor('#fff')!, parseColor('#fff')!)).toBe(1);
    // #767676 on white is the classic 4.54:1 boundary grey.
    expect(contrastRatio(parseColor('#767676')!, parseColor('#fff')!)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(parseColor('#777777')!, parseColor('#fff')!)).toBeLessThan(4.5);
  });
  it('is symmetric', () => {
    const a = parseColor('#336699')!;
    const b = parseColor('#eeeeee')!;
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });
  it('applies large-text thresholds', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
    expect(passesAA(3.2, true)).toBe(true);
    expect(passesAA(3.2, false)).toBe(false);
  });
  it('flattens alpha over an opaque background', () => {
    const half = flatten({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(toHex(half)).toBe('#808080');
  });
});

describe('Lab and deltaE', () => {
  it('maps white and black to Lab extremes', () => {
    expect(rgbToLab(parseColor('#fff')!).l).toBeCloseTo(100, 0);
    expect(rgbToLab(parseColor('#000')!).l).toBeCloseTo(0, 0);
  });
  it('matches a published CIEDE2000 pair (Sharma et al. test data, pair 1)', () => {
    expect(deltaE2000({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3);
  });
  it('is zero for identical colours', () => {
    const lab = rgbToLab(parseColor('#336699')!);
    expect(deltaE2000(lab, lab)).toBe(0);
  });
});

describe('clusterColors', () => {
  it('merges near-identical colours and keeps distinct ones apart', () => {
    const clusters = clusterColors(
      [
        { hex: '#ffffff', weight: 100 },
        { hex: '#fefefe', weight: 10 },
        { hex: '#fdfdfd', weight: 5 },
        { hex: '#0055ff', weight: 20 },
        { hex: '#0056fe', weight: 3 },
        { hex: '#111111', weight: 50 },
      ],
      4,
    );
    expect(clusters.map((c) => c.hex)).toEqual(['#ffffff', '#111111', '#0055ff']);
    expect(clusters[0]!.weight).toBe(115);
    expect(clusters[2]!.members).toContain('#0056fe');
  });
  it('uses the heaviest member as representative', () => {
    const [c] = clusterColors([
      { hex: '#fefefe', weight: 1 },
      { hex: '#ffffff', weight: 9 },
    ]);
    expect(c!.hex).toBe('#ffffff');
  });
});
