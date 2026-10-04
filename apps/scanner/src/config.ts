import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).optional().default(def);

const list = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v === undefined || v.trim() === '' ? def : v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  PORT: int(7860, 1, 65535),
  HOST: z.string().optional().default('0.0.0.0'),
  /** Comma-separated origins allowed by CORS. `*` is refused in production. */
  ALLOWED_ORIGINS: list('http://localhost:3000'),
  /** Number of trusted reverse-proxy hops in front of the app (HF Spaces = 1). */
  TRUST_PROXY_HOPS: int(1, 0, 5),
  /** Public contact URL placed in the TeardownBot user agent. */
  CONTACT_URL: z.string().optional().default('https://github.com/teardown-app/teardown'),
  ALLOW_PRIVATE_TARGETS: bool(false),

  // AI
  AI_PROVIDERS: list('gemini,groq,huggingface,openrouter'),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODELS: list('gemini-3.5-flash-lite,gemini-3.1-flash-lite'),
  GEMINI_BASE_URL: z.string().optional().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  GROQ_API_KEY: optionalSecret,
  GROQ_MODELS: list('llama-3.1-8b-instant'),
  GROQ_BASE_URL: z.string().optional().default('https://api.groq.com/openai/v1'),
  HF_TOKEN: optionalSecret,
  HF_MODELS: list('meta-llama/Llama-3.1-8B-Instruct:cheapest'),
  HF_BASE_URL: z.string().optional().default('https://router.huggingface.co/v1'),
  OPENROUTER_API_KEY: optionalSecret,
  OPENROUTER_MODELS: list('google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free'),
  OPENROUTER_BASE_URL: z.string().optional().default('https://openrouter.ai/api/v1'),
  AI_DAILY_CALLS: int(400),
  AI_DAILY_CALLS_GEMINI: int(200),
  AI_DAILY_CALLS_GROQ: int(300),
  AI_DAILY_CALLS_HUGGINGFACE: int(20),
  AI_DAILY_CALLS_OPENROUTER: int(40),
  AI_TIMEOUT_MS: int(45_000, 1000),
  /** Total time the AI chain may spend per scan across all providers and retries. */
  AI_TOTAL_BUDGET_MS: int(120_000, 5000),
  /** Hard ceiling for one scan (serverless hosts kill longer calls). */
  SCAN_DEADLINE_MS: int(30 * 60 * 1000, 30_000),

  // Performance
  PERF_ENGINE: z.enum(['auto', 'psi', 'lighthouse', 'estimate']).optional().default('auto'),
  PSI_API_KEY: optionalSecret,
  PSI_DAILY_CAP: int(500),
  /** Run local Lighthouse when PSI is unavailable. Off by default on serverless hosts, which don't ship it. */
  LIGHTHOUSE_ENABLED: bool(true),
  LIGHTHOUSE_TIMEOUT_MS: int(90_000, 10_000),
  PERF_MAX_PAGES_FULL: int(2, 0, 10),

  // Abuse protection
  TURNSTILE_SECRET: optionalSecret,
  SINGLE_PER_HOUR: int(5, 1),
  SINGLE_PER_DAY: int(15, 1),
  SITE_PER_DAY: int(1, 0),
  DOMAIN_PER_DAY: int(10, 1),
  GLOBAL_SINGLE_PER_DAY: int(600, 1),
  GLOBAL_SITE_PER_DAY: int(40, 0),
  PDF_PER_HOUR: int(10, 1),
  MAX_CONCURRENT_SCANS: int(2, 1, 8),
  MAX_QUEUE: int(15, 0),
  REPORT_MAX_BYTES: int(10 * 1024 * 1024, 100_000),
  CACHE_TTL_MS: int(6 * 60 * 60 * 1000, 0),
  CACHE_MAX_ENTRIES: int(100, 0),
  CACHE_MAX_BYTES: int(200 * 1024 * 1024, 0),

  // Scan caps
  SITE_MAX_PAGES: int(15, 1, 50),
  SITE_CONCURRENCY: int(2, 1, 4),
  SITE_BUDGET_MS: int(6 * 60 * 1000, 30_000),
  NAV_TIMEOUT_MS: int(25_000, 5000),
  PAGE_BUDGET_MS: int(40_000, 10_000),
  MAX_HTML_BYTES: int(5 * 1024 * 1024, 100_000),
  MAX_SUBREQUESTS: int(400, 10),
  BROWSER_NO_SANDBOX: bool(true),
});

export type Config = z.infer<typeof EnvSchema>;

/**
 * Defaults for serverless hosts (Vercel: 2 GB, 1 vCPU, 300 s per call, 4.5 MB bodies). Applied
 * only to settings the environment doesn't set explicitly.
 */
export const SERVERLESS_DEFAULTS: Record<string, string> = {
  REPORT_MAX_BYTES: String(4_000_000),
  SITE_MAX_PAGES: '5',
  SITE_CONCURRENCY: '1',
  SITE_BUDGET_MS: String(150_000),
  PERF_MAX_PAGES_FULL: '0',
  MAX_CONCURRENT_SCANS: '3',
  PAGE_BUDGET_MS: String(45_000),
  AI_TIMEOUT_MS: String(20_000),
  AI_TOTAL_BUDGET_MS: String(45_000),
  SCAN_DEADLINE_MS: String(270_000),
  TRUST_PROXY_HOPS: '0',
  LIGHTHOUSE_ENABLED: 'false',
};

export function withPlatformDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.VERCEL) return env;
  const out = { ...env };
  for (const [k, v] of Object.entries(SERVERLESS_DEFAULTS)) if (out[k] === undefined || out[k] === '') out[k] = v;
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(withPlatformDefaults(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.ALLOW_PRIVATE_TARGETS && cfg.NODE_ENV === 'production') {
    throw new Error('ALLOW_PRIVATE_TARGETS=true is forbidden when NODE_ENV=production.');
  }
  if (cfg.NODE_ENV === 'production' && cfg.ALLOWED_ORIGINS.includes('*')) {
    throw new Error('ALLOWED_ORIGINS must list explicit origins in production, not "*".');
  }
  return cfg;
}

export const VERSION = '1.0.0';

export function userAgent(cfg: Pick<Config, 'CONTACT_URL'>, mobile = false): string {
  const base = mobile
    ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  return `${base} TeardownBot/${VERSION} (+${cfg.CONTACT_URL})`;
}
