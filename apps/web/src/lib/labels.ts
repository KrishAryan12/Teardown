import type { Category, Report, Severity } from '@teardown/core';

export const CATEGORY_LABEL: Record<Category, string> = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  seo: 'SEO',
  ux: 'UX',
  brand: 'Brand',
  security: 'Security',
};

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

export function perfSourceLabel(r: Pick<Report, 'scores'>): string {
  const s = r.scores.performance.source;
  return s === 'psi' ? 'PageSpeed Insights' : s === 'lighthouse' ? 'Local lab, indicative' : 'Estimate';
}

export function band(score: number): 'good' | 'fair' | 'poor' {
  return score >= 90 ? 'good' : score >= 50 ? 'fair' : 'poor';
}

export function fileStem(r: Pick<Report, 'target' | 'generatedAt'>): string {
  return `teardown-${r.target.host.replace(/[^a-z0-9.-]/gi, '')}-${r.generatedAt.slice(0, 10)}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function hoursAgo(iso?: string): string {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes ago`;
  return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
}
