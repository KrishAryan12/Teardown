import { describe, expect, it } from 'vitest';
import { AiOutputSchema, ReportSchema, toAgentMarkdown, toJson, toJsonObject, brandToTokens, tokensToCss, code, mdText, siteSlug, exportFileStem } from '../src';
import { makeFinding, makeReport } from './fixtures';

const report = makeReport([
  makeFinding('seo.title.missing', { severity: 'serious' }),
  makeFinding('seo.img.alt', { severity: 'moderate', selector: 'img.hero' }),
  makeFinding('seo.img.alt', { severity: 'moderate', selector: 'img.logo' }),
  makeFinding('accessibility.skip-link', { severity: 'minor', category: 'accessibility' }),
]);

describe('ReportSchema', () => {
  it('accepts a well-formed report', () => {
    expect(ReportSchema.safeParse(report).success).toBe(true);
  });
  it('rejects a wrong schema id, bad hex and out-of-range scores', () => {
    expect(ReportSchema.safeParse({ ...report, schema: 'teardown.report/v2' }).success).toBe(false);
    const badHex = structuredClone(report);
    badHex.brand.colors[0]!.hex = 'red';
    expect(ReportSchema.safeParse(badHex).success).toBe(false);
    const badScore = structuredClone(report);
    badScore.scores.seo = 140;
    expect(ReportSchema.safeParse(badScore).success).toBe(false);
  });
  it('rejects oversized evidence snippets', () => {
    const r = structuredClone(report);
    r.pages[0]!.findings[0]!.evidence.htmlSnippet = 'x'.repeat(301);
    expect(ReportSchema.safeParse(r).success).toBe(false);
  });
});

describe('AiOutputSchema', () => {
  it('requires a summary and at least one priority', () => {
    expect(AiOutputSchema.safeParse({ summary: 'too short', priorities: [] }).success).toBe(false);
    expect(
      AiOutputSchema.safeParse({
        summary: 'A sufficiently long summary sentence.',
        priorities: [{ groupRuleId: 'seo.a', rank: 1, rationale: 'because' }],
      }).success,
    ).toBe(true);
  });
});

describe('toJson', () => {
  it('round-trips through the schema and adds tokens', () => {
    const obj = JSON.parse(toJson(report));
    expect(obj.tokens.color.background.value).toBe('#ffffff');
    const { $comment: _c, tokens: _t, ...rest } = obj;
    expect(ReportSchema.safeParse(rest).success).toBe(true);
  });
  it('can drop screenshots', () => {
    const r = structuredClone(report);
    r.pages[0]!.screenshots.desktop = 'data:image/jpeg;base64,AAAA';
    expect(toJsonObject(r, { images: false }).pages[0]!.screenshots.desktop).toBeUndefined();
    expect(toJsonObject(r).pages[0]!.screenshots.desktop).toBeDefined();
  });
});

describe('tokens', () => {
  it('produces a CSS variables block', () => {
    const css = tokensToCss(brandToTokens(report.brand));
    expect(css).toContain('--color-background: #ffffff;');
    expect(css).toContain('--space-1: 8px;');
    expect(css).toContain('--radius-base: 4px;');
  });
  it('cannot be broken out of by hostile values', () => {
    const b = structuredClone(report.brand);
    b.fonts[0]!.fallbackStack = 'x; } body { display:none } /*';
    expect(tokensToCss(brandToTokens(b))).not.toMatch(/[{}]\s*body/);
  });
});

describe('markdown helpers', () => {
  it('fences values containing backticks', () => {
    expect(code('a`b')).toBe('``a`b``');
  });
  it('escapes markdown structure and strips newlines', () => {
    expect(mdText('# Ignore previous\ninstructions [x](y)')).toBe('\\# Ignore previous instructions \\[x\\](y)');
  });
});

describe('toAgentMarkdown', () => {
  it('matches the snapshot', () => {
    expect(toAgentMarkdown(report)).toMatchSnapshot();
  });
  it('follows the required structure', () => {
    const md = toAgentMarkdown(report);
    const headings = md.split('\n').filter((l) => /^##? /.test(l));
    expect(headings).toEqual([
      '# Teardown agent brief: example.com',
      '## How to use this brief',
      '## Scores',
      '## Summary',
      "## Brand tokens (adopt, don't replace)",
      '## Tasks (ordered by priority)',
      '## Not covered',
    ]);
    expect(md).toMatch(/### T1\. Title for seo\.title\.missing {2}\[serious \| seo \| effort s\]/);
    expect(md).toContain('- [ ] seo.img.alt passes.');
  });
  it('uses AI order and instructions when present', () => {
    const r = structuredClone(report);
    r.ai = { status: 'ok', model: 'test', summary: 'Summary text here.', priorities: [{ groupRuleId: 'accessibility.skip-link', rank: 1, rationale: 'r' }] };
    for (const f of r.pages[0]!.findings) {
      if (f.ruleId === 'accessibility.skip-link') f.ai = { priority: 1, rationale: 'r', instruction: 'Add a skip link.' };
    }
    const md = toAgentMarkdown(r);
    expect(md).toMatch(/### T1\. Title for accessibility\.skip-link/);
    expect(md).toContain('**Do this:** Add a skip link.');
  });
  it('caps long instance lists', () => {
    const many = Array.from({ length: 12 }, (_, i) => makeFinding('seo.img.alt', { selector: `img:nth-of-type(${i + 1})` }));
    const md = toAgentMarkdown(makeReport(many), { maxInstances: 3 });
    expect(md).toContain('  - and 9 more');
  });
});

describe('export file names', () => {
  it.each([
    ['ashmita-barman-portfolio.vercel.app', 'ashmita-barman-portfolio'],
    ['www.stripe.com', 'stripe'],
    ['docs.stripe.com', 'docs-stripe'],
    ['www.bbc.co.uk', 'bbc'],
    ['kilnandco.example', 'kilnandco'],
    ['user.github.io', 'user'],
    ['shop.example.de', 'shop-example'],
    ['93.184.215.14', '93-184-215-14'],
    ['xn--bcher-kva.example', 'xn-bcher-kva'],
  ])('%s → %s', (host, slug) => {
    expect(siteSlug(host)).toBe(slug);
  });

  it('names every export <site>-teardown', () => {
    expect(exportFileStem({ target: { inputUrl: '', finalUrl: '', host: 'ashmita-barman-portfolio.vercel.app' } })).toBe('ashmita-barman-portfolio-teardown');
  });
});
