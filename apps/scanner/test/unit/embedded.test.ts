import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEmbedded, EMBEDDED_PATH } from '../../scripts/gen-embedded';

describe('src/generated/embedded.ts', () => {
  it('is up to date with inpage/*.js and the font packages (run `pnpm --filter @teardown/scanner gen`)', () => {
    expect(readFileSync(EMBEDDED_PATH, 'utf8')).toBe(buildEmbedded());
  });
});
