import type { Finding } from '@teardown/core';
import type { PageCapture } from '../capture/types';
import { processBrand, type BrandAnalysis } from '../brand/process';
import { runRules } from '../rules';
import { axeToFindings } from '../rules/axe';
import type { SiteSignals } from '../rules/types';

export interface PageAnalysis {
  findings: Finding[];
  counts: Record<string, number>;
  brand: BrandAnalysis | null;
  errors: string[];
}

/** Rules + axe for one captured page. Pure: no I/O. */
export function analyzePage(capture: PageCapture, site: SiteSignals, primary: boolean): PageAnalysis {
  const brand = capture.brand ? processBrand([capture.brand]) : null;
  const axeRan = capture.axe !== null;
  const ctx = {
    url: capture.finalUrl,
    capture,
    brand,
    site,
    primary,
    axeRan,
    axeIds: new Set((capture.axe ?? []).map((v) => v.id)),
  };
  const rules = runRules(ctx);
  const axe = capture.axe ? axeToFindings(capture.axe, capture.finalUrl) : { findings: [], counts: {} };
  return {
    findings: [...rules.findings, ...axe.findings],
    counts: { ...rules.counts, ...axe.counts },
    brand,
    errors: rules.errors,
  };
}
