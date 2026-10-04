import type { Finding, Severity } from '@teardown/core';
import type { AxeViolation } from '../capture/types';
import { MAX_INSTANCES, SUPERSEDED_AXE, dedupeIds, toFinding } from './index';
import type { FixTemplate } from './types';

const IMPACT: Record<string, Severity> = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' };

/** Hand-written fixes for the axe rules that show up most. Others get a generic template. */
const AXE_FIX: Record<string, FixTemplate> = {
  'color-contrast': {
    summary: 'Raise the contrast of each listed text to at least 4.5:1 (3:1 for large text) by darkening the text or lightening the background.',
    steps: ['Find the colour token or rule that sets this text colour.', 'Adjust lightness until the pair passes, staying within the brand palette.', 'Recheck hover, focus and disabled states too.'],
    effort: 's',
    acceptance: ['axe-core reports no color-contrast violations.', 'Every listed text/background pair has at least 4.5:1 contrast (3:1 for large text).'],
    verify: 'DevTools > Elements > hover the colour swatch to see the contrast ratio, or run axe DevTools.',
  },
  'button-name': {
    summary: 'Give each button an accessible name: visible text, aria-label, or alt on an image inside it.',
    steps: ['For icon buttons, add aria-label describing the action.', 'Mark the decorative icon aria-hidden="true".'],
    codeHint: '<button aria-label="Close menu"><svg aria-hidden="true">…</svg></button>',
    effort: 'xs',
    acceptance: ['Every <button> and role="button" has a non-empty accessible name.'],
  },
  'aria-allowed-attr': {
    summary: 'Remove ARIA attributes that are not allowed on the element’s role.',
    steps: ['Check the role of each listed element.', 'Remove or replace the disallowed aria-* attribute.'],
    effort: 'xs',
    acceptance: ['axe-core reports no aria-allowed-attr violations.'],
  },
  'aria-hidden-focus': {
    summary: 'Do not hide focusable elements with aria-hidden; remove aria-hidden or make the content unfocusable (inert).',
    steps: ['Use the inert attribute on hidden panels instead of aria-hidden.', 'Or remove tabindex/links from the hidden content.'],
    effort: 's',
    acceptance: ['No element inside an aria-hidden="true" container is focusable.'],
  },
  'duplicate-id-aria': {
    summary: 'Make IDs referenced by ARIA or labels unique on the page.',
    steps: ['Rename duplicated ids, and update the for/aria-labelledby references.'],
    effort: 'xs',
    acceptance: ['Every id referenced by aria-* or label[for] is unique.'],
  },
  'list': {
    summary: 'Make <ul>/<ol> contain only <li> (plus script/template) as direct children.',
    steps: ['Wrap stray children in <li> or move them outside the list.'],
    effort: 'xs',
    acceptance: ['Lists contain only <li> direct children.'],
  },
  'listitem': {
    summary: 'Put every <li> inside a <ul> or <ol>.',
    steps: ['Wrap orphan <li> elements in a list element.'],
    effort: 'xs',
    acceptance: ['Every <li> has a <ul>, <ol> or <menu> parent.'],
  },
  region: {
    summary: 'Put all visible content inside landmarks (header, nav, main, footer, aside).',
    steps: ['Wrap stray top-level content in <main> or the right landmark.'],
    effort: 's',
    acceptance: ['axe-core reports no region violations.'],
  },
  'frame-title': {
    summary: 'Give every iframe a title describing its content.',
    steps: ['Add a title attribute to each <iframe>.'],
    codeHint: '<iframe src="…" title="Map of our office"></iframe>',
    effort: 'xs',
    acceptance: ['Every <iframe> has a non-empty title.'],
  },
  'meta-viewport': {
    summary: 'Allow zoom: remove user-scalable=no and maximum-scale below 5 from the viewport tag.',
    steps: ['Edit the viewport meta tag.'],
    codeHint: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    effort: 'xs',
    acceptance: ['The viewport tag does not restrict zoom.'],
  },
  'nested-interactive': {
    summary: 'Don’t put links or buttons inside other links or buttons.',
    steps: ['Restructure so interactive elements are siblings, not nested.'],
    effort: 's',
    acceptance: ['No interactive element contains another interactive element.'],
  },
};

function genericFix(v: AxeViolation): FixTemplate {
  return {
    summary: `${v.help}.`,
    steps: [`Read the rule guidance: ${v.helpUrl.split('?')[0]}`, 'Fix each listed element.', 'Re-run an axe check to confirm.'],
    effort: 's',
    acceptance: [`axe-core rule "${v.id}" reports no violations on this page.`],
    verify: 'Run the axe DevTools extension on the page.',
  };
}

function wcagRef(tags: string[]): string {
  const sc = tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, '$1.$2.$3'));
  return sc.length ? ` (WCAG ${sc.join(', ')})` : '';
}

/** Converts axe violations to findings, skipping rules our own checks already cover. */
export function axeToFindings(violations: AxeViolation[], pageUrl: string): { findings: Finding[]; counts: Record<string, number> } {
  const findings: Finding[] = [];
  const counts: Record<string, number> = {};
  for (const v of violations) {
    if (SUPERSEDED_AXE.has(v.id)) continue;
    const ruleId = `a11y.axe.${v.id}`;
    const rule = {
      id: ruleId,
      category: 'accessibility' as const,
      severity: IMPACT[v.impact ?? ''] ?? ('moderate' as const),
      title: v.help.charAt(0).toUpperCase() + v.help.slice(1),
      detail: `${v.description}${wcagRef(v.tags)}`,
      fix: AXE_FIX[v.id] ?? genericFix(v),
    };
    counts[ruleId] = v.nodeCount ?? v.nodes.length;
    for (const n of v.nodes.slice(0, MAX_INSTANCES)) {
      findings.push(
        toFinding(
          rule,
          { selector: n.target, snippet: n.html, bbox: n.bbox ?? undefined, measured: n.measured, expected: n.expected, detail: n.failureSummary ? `${rule.detail.replace(/([^.])$/, '$1.')} ${n.failureSummary.replace(/\s+/g, ' ')}`.slice(0, 1900) : undefined },
          pageUrl,
          'axe',
          v.id,
        ),
      );
    }
  }
  return { findings: dedupeIds(findings), counts };
}
