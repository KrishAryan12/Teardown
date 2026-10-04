import type { BrandProfile, Category, Effort, Severity, Viewport } from '@teardown/core';
import type { PageCapture, Rect } from '../capture/types';
import type { BrandAnalysis } from '../brand/process';

export interface SiteSignals {
  /** robots.txt fetch result (homepage only). null = not checked. */
  robots: { status: number; body: string } | null;
  sitemap: { found: boolean; url?: string } | null;
  /** HEAD/GET results for a capped sample of internal links. */
  linkChecks: { url: string; status: number; selector?: string }[];
}

export interface RuleContext {
  url: string;
  capture: PageCapture;
  brand: BrandAnalysis | null;
  site: SiteSignals;
  /** First page of the scan: site-level rules (robots, sitemap, headers) run only here. */
  primary: boolean;
  /** axe rule ids that ran and reported violations, for de-duplication. */
  axeIds: Set<string>;
  axeRan: boolean;
}

export interface RuleHit {
  selector?: string;
  snippet?: string;
  bbox?: Rect | null;
  viewport?: Viewport;
  measured?: string;
  expected?: string;
  /** Overrides the rule's detail text for this instance. */
  detail?: string;
  severity?: Severity;
}

export interface FixTemplate {
  summary: string;
  steps: string[];
  codeHint?: string;
  effort: Effort;
  acceptance: string[];
  verify?: string;
}

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  fix: FixTemplate;
  /** Lighthouse audit ids this rule supersedes (we prefer our own rule). */
  supersedesLighthouse?: string[];
  /** axe rule ids this rule supersedes. */
  supersedesAxe?: string[];
  check(ctx: RuleContext): RuleHit[] | RuleHit | null | undefined | false;
}

export type { BrandProfile };
