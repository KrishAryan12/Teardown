/**
 * Minimal structured logger. Policy (docs/SECURITY.md): log hostname, mode, outcome, duration
 * and error code only. Never full URLs with query strings, page content or client IPs.
 */
type Fields = Record<string, string | number | boolean | undefined | null>;

const silent = process.env.NODE_ENV === 'test' && !process.env.DEBUG_LOGS;

function write(level: 'info' | 'warn' | 'error', fields: Fields) {
  if (silent) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...fields });
  (level === 'info' ? process.stdout : process.stderr).write(line + '\n');
}

export const log = {
  info: (f: Fields) => write('info', f),
  warn: (f: Fields) => write('warn', f),
  error: (f: Fields) => write('error', f),
};

/** Hostname only, for logs. */
export function logHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}
