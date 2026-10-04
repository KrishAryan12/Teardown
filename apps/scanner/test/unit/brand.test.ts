import { describe, expect, it } from 'vitest';
import { BrandProfileSchema, brandToTokens, tokensToCss } from '@teardown/core';
import { fitRatio, processBrand, firstFamily } from '../../src/brand/process';
import { loadCapture } from './helpers';

describe('brand extraction: good fixture matches its known design', () => {
  const { profile } = processBrand([loadCapture('good').brand!]);

  it('is schema-valid', () => {
    expect(BrandProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('finds the palette with sensible roles', () => {
    const byHex = Object.fromEntries(profile.colors.map((c) => [c.hex, c.role]));
    expect(byHex['#fbfaf7']).toBe('background'); // --color-paper
    expect(byHex['#13201f']).toBe('text'); // --color-ink
    expect(byHex['#0f3d3e']).toBe('accent'); // --color-brand
    expect(profile.colors[0]!.hex).toBe('#fbfaf7');
  });

  it('finds the two type families and their roles', () => {
    const fams = profile.fonts.map((f) => f.family);
    expect(fams).toEqual(expect.arrayContaining(['Georgia', 'Arial']));
    expect(profile.fonts.find((f) => f.family === 'Arial')!.usedFor).toContain('heading');
    expect(profile.fonts.find((f) => f.family === 'Georgia')!.source).toBe('system');
  });

  it('detects the 8px spacing grid and the 8px radius', () => {
    expect(profile.spacing.baseUnit).toBe(8);
    expect(profile.spacing.onGridRatio).toBeGreaterThanOrEqual(0.8);
    expect(profile.radii.map((r) => r.px)).toContain(8);
  });

  it('reads the :root design tokens', () => {
    expect(profile.cssVariables['--color-brand']).toBe('#0f3d3e');
    expect(profile.cssVariables['--space-2']).toBe('16px');
  });

  it('reports passing contrast for the body text', () => {
    const body = profile.contrast.find((c) => c.fg === '#13201f' && c.bg === '#fbfaf7');
    expect(body?.passAAA).toBe(true);
  });

  it('exports tokens and a CSS block', () => {
    const css = tokensToCss(brandToTokens(profile));
    expect(css).toContain('--color-background: #fbfaf7;');
    expect(css).toContain('--space-1: 8px;');
  });
});

describe('brand extraction: bad fixture', () => {
  const a = processBrand([loadCapture('bad').brand!]);
  it('flags five-plus families, near-duplicate blues and an off-grid layout', () => {
    expect(a.profile.fonts.length).toBeGreaterThanOrEqual(5);
    expect(a.nearDuplicates.length).toBeGreaterThanOrEqual(2);
    expect(a.profile.spacing.baseUnit).toBeUndefined();
    expect(a.profile.contrast.some((c) => !c.passAA)).toBe(true);
  });
  it('merges pages by re-clustering the union', () => {
    const b = loadCapture('bad').brand!;
    const g = loadCapture('good').brand!;
    const merged = processBrand([b, g]).profile;
    expect(merged.fonts.length).toBeGreaterThanOrEqual(a.profile.fonts.length);
    expect(merged.colors.map((c) => c.hex)).toEqual(expect.arrayContaining(['#ffffff']));
    // Processing must not mutate the inputs.
    expect(processBrand([loadCapture('good').brand!]).profile).toEqual(processBrand([g]).profile);
  });
});

describe('fitRatio', () => {
  it('fits a major-third scale', () => {
    expect(fitRatio([16, 20, 25, 31.25, 39.06])).toBeCloseTo(1.25, 2);
  });
  it('rejects arbitrary sizes and tiny sets', () => {
    expect(fitRatio([13, 17, 22, 29, 41, 11])).toBeUndefined();
    expect(fitRatio([16, 20])).toBeUndefined();
  });
});

describe('firstFamily', () => {
  it('strips quotes and fallbacks', () => {
    expect(firstFamily('"Comic Sans MS", cursive')).toBe('Comic Sans MS');
  });
});
