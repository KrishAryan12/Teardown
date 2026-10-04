import { INPAGE_COLLECT, INPAGE_MOBILE } from '../generated/embedded';

/**
 * In-page scripts are written as plain JS in apps/scanner/inpage (functions passed to
 * page.evaluate can pick up bundler helpers; see DECISIONS D-03) and compiled into
 * src/generated/embedded.ts so every bundle carries them.
 */
const SOURCES = { collect: INPAGE_COLLECT, mobile: INPAGE_MOBILE } as const;

/** Returns the script source, an expression evaluating to a function. */
export function inpageSource(name: 'collect' | 'mobile'): string {
  return SOURCES[name];
}

/** Builds a self-invoking expression for page.evaluate. */
export function inpageCall(name: 'collect' | 'mobile', arg?: unknown): string {
  return `(${inpageSource(name)})(${arg === undefined ? '' : JSON.stringify(arg)})`;
}
