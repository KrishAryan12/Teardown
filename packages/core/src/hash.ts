/**
 * Short, stable, non-cryptographic hash (FNV-1a 32-bit, base36).
 * Used for finding ids so the same issue on the same element keeps its id across scans.
 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

export function findingId(ruleId: string, pageUrl: string, selector = ''): string {
  return `${ruleId}:${shortHash(pageUrl + selector)}`;
}
