import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * In-page scripts are plain JS files read at runtime (see DECISIONS D-03). They live in
 * apps/scanner/inpage in the repo and next to dist/main.js in the bundle.
 */
function inpageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.INPAGE_DIR,
    join(here, 'inpage'),
    resolve(here, '../inpage'),
    resolve(here, '../../inpage'),
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) if (existsSync(join(c, 'collect.js'))) return c;
  throw new Error(`In-page scripts not found (looked in ${candidates.join(', ')})`);
}

const cache = new Map<string, string>();

/** Returns the script source, an expression evaluating to a function. */
export function inpageSource(name: 'collect' | 'mobile'): string {
  let src = cache.get(name);
  if (!src) {
    src = readFileSync(join(inpageDir(), `${name}.js`), 'utf8')
      .replace(/^\/\/ @ts-nocheck\s*/m, '')
      .trim();
    cache.set(name, src);
  }
  return src;
}

/** Builds a self-invoking expression for page.evaluate. */
export function inpageCall(name: 'collect' | 'mobile', arg?: unknown): string {
  return `(${inpageSource(name)})(${arg === undefined ? '' : JSON.stringify(arg)})`;
}
