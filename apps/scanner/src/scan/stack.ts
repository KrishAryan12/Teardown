import type { Report } from '@teardown/core';
import type { PageFacts } from '../capture/types';

type StackItem = Report['stack'][number];
const RANK = { low: 0, medium: 1, high: 2 } as const;

/** Lightweight stack detection from in-page hints, response headers and the generator tag. */
export function detectStack(facts: PageFacts, headers: Record<string, string>): StackItem[] {
  const out = new Map<string, StackItem>();
  const add = (name: string, confidence: StackItem['confidence']) => {
    const prev = out.get(name);
    if (!prev || RANK[confidence] > RANK[prev.confidence]) out.set(name, { name, confidence });
  };
  for (const h of facts.stackHints) add(h.name, h.confidence);
  const h = (k: string) => headers[k] ?? '';
  if (h('x-vercel-id') || /vercel/i.test(h('server'))) add('Vercel', 'high');
  if (h('x-nf-request-id') || /netlify/i.test(h('server'))) add('Netlify', 'high');
  if (h('cf-ray') || /cloudflare/i.test(h('server'))) add('Cloudflare', 'high');
  if (h('x-github-request-id')) add('GitHub Pages', 'high');
  if (/^nginx/i.test(h('server'))) add('nginx', 'medium');
  if (/apache/i.test(h('server'))) add('Apache', 'medium');
  if (/express/i.test(h('x-powered-by'))) add('Express', 'high');
  if (/next\.js/i.test(h('x-powered-by'))) add('Next.js', 'high');
  if (/php/i.test(h('x-powered-by'))) add('PHP', 'medium');
  if (h('x-shopify-stage') || h('x-shopid')) add('Shopify', 'high');
  if (h('x-wix-request-id')) add('Wix', 'high');
  const gen = facts.head.generator ?? '';
  const genName = gen.replace(/\s*[\d.]+.*$/, '').trim();
  if (genName && genName.length < 40) add(genName, 'high');
  return [...out.values()].slice(0, 12);
}
