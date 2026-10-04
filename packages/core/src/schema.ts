import { z } from 'zod';

/** Bump the major schema id on any breaking change to Report. */
export const REPORT_SCHEMA = 'teardown.report/v1' as const;
/** Bump when rules, thresholds or scoring change. Part of the cache key. */
export const RULESET_VERSION = '1.0.0';

export const CategorySchema = z.enum(['performance', 'seo', 'accessibility', 'ux', 'brand', 'security']);
export type Category = z.infer<typeof CategorySchema>;
export const CATEGORIES: readonly Category[] = CategorySchema.options;

export const SeveritySchema = z.enum(['critical', 'serious', 'moderate', 'minor']);
export type Severity = z.infer<typeof SeveritySchema>;
export const SEVERITIES: readonly Severity[] = SeveritySchema.options;

export const ViewportSchema = z.enum(['desktop', 'mobile']);
export type Viewport = z.infer<typeof ViewportSchema>;

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  viewport: ViewportSchema,
});
export type BBox = z.infer<typeof BBoxSchema>;

export const EffortSchema = z.enum(['xs', 's', 'm', 'l']);
export type Effort = z.infer<typeof EffortSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1).max(200),
  ruleId: z.string().min(1).max(120),
  category: CategorySchema,
  severity: SeveritySchema,
  source: z.enum(['rule', 'axe', 'lighthouse']),
  pageUrl: z.string().max(2048),
  title: z.string().max(300),
  detail: z.string().max(2000),
  evidence: z.object({
    selector: z.string().max(500).optional(),
    htmlSnippet: z.string().max(300).optional(),
    bbox: BBoxSchema.optional(),
    measured: z.string().max(200).optional(),
    expected: z.string().max(200).optional(),
    /** Extra machine-readable reference, e.g. the axe rule id or Lighthouse audit id. */
    ref: z.string().max(120).optional(),
  }),
  fix: z.object({
    summary: z.string().max(600),
    steps: z.array(z.string().max(600)).max(12),
    codeHint: z.string().max(1500).optional(),
    effort: EffortSchema,
    acceptance: z.array(z.string().max(400)).max(10),
    verify: z.string().max(400).optional(),
  }),
  ai: z
    .object({
      priority: z.number().int().min(1),
      rationale: z.string().max(300),
      instruction: z.string().max(600),
    })
    .optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const ColorRoleSchema = z.enum(['background', 'text', 'accent', 'border', 'other']);
export type ColorRole = z.infer<typeof ColorRoleSchema>;

export const FontUseSchema = z.enum(['heading', 'body', 'mono', 'ui']);
export type FontUse = z.infer<typeof FontUseSchema>;

export const BrandProfileSchema = z.object({
  colors: z
    .array(
      z.object({
        hex: HexSchema,
        role: ColorRoleSchema.optional(),
        share: z.number().min(0).max(1),
        samples: z.number().int().min(0),
      }),
    )
    .max(48),
  cssVariables: z.record(z.string().max(120), z.string().max(300)),
  fonts: z
    .array(
      z.object({
        family: z.string().max(120),
        source: z.enum(['google', 'self-hosted', 'system', 'unknown']),
        weights: z.array(z.number().int()).max(12),
        usedFor: z.array(FontUseSchema),
        fallbackStack: z.string().max(300),
        /** Font the browser actually rendered (CDP), when it differs from the declared family. */
        rendered: z.string().max(120).optional(),
      }),
    )
    .max(16),
  typeScale: z
    .array(z.object({ px: z.number(), count: z.number().int(), sampleTag: z.string().max(20).optional() }))
    .max(32),
  typeScaleRatio: z.number().optional(),
  spacing: z.object({
    baseUnit: z.number().optional(),
    onGridRatio: z.number().min(0).max(1),
    values: z.array(z.object({ px: z.number(), count: z.number().int() })).max(40),
  }),
  radii: z.array(z.object({ px: z.number(), count: z.number().int() })).max(24),
  shadows: z.array(z.string().max(300)).max(12),
  contrast: z
    .array(
      z.object({
        fg: HexSchema,
        bg: HexSchema,
        ratio: z.number(),
        passAA: z.boolean(),
        passAAA: z.boolean(),
        count: z.number().int(),
        sampleSelector: z.string().max(500).optional(),
        largeText: z.boolean().optional(),
      }),
    )
    .max(40),
  /** Text samples whose background is a gradient or image: contrast unknown, not guessed. */
  contrastUnknown: z.number().int().min(0).default(0),
  assets: z.object({
    logoUrl: z.string().max(2048).optional(),
    favicon: z.string().max(2048).optional(),
    themeColor: z.string().max(60).optional(),
    ogImage: z.string().max(2048).optional(),
  }),
  consistency: z.object({
    colorCount: z.number().int(),
    fontCount: z.number().int(),
    notes: z.array(z.string().max(300)).max(12),
  }),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const PerfSourceSchema = z.enum(['psi', 'lighthouse', 'estimated']);
export type PerfSource = z.infer<typeof PerfSourceSchema>;

const Score = z.number().min(0).max(100);

export const ScoresSchema = z.object({
  overall: Score,
  performance: z.object({ score: Score, source: PerfSourceSchema }),
  seo: Score,
  accessibility: Score,
  ux: Score,
  brand: Score,
  security: Score,
});
export type Scores = z.infer<typeof ScoresSchema>;

export const PageSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(300).optional(),
  status: z.number().int(),
  timings: z.record(z.string().max(60), z.number()),
  screenshots: z.object({
    desktop: z.string().optional(),
    mobile: z.string().optional(),
  }),
  /** Document height in CSS px of the captured desktop screenshot area (for pin placement). */
  screenshotSize: z
    .object({
      desktop: z.object({ w: z.number(), h: z.number() }).optional(),
      mobile: z.object({ w: z.number(), h: z.number() }).optional(),
    })
    .optional(),
  findings: z.array(FindingSchema),
  /** Number of instances per rule on this page, including ones beyond the per-page cap. */
  ruleCounts: z.record(z.string().max(120), z.number().int()).optional(),
  scores: z.record(z.string().max(30), z.number()).optional(),
  metrics: z.record(z.string().max(60), z.number()).optional(),
});
export type Page = z.infer<typeof PageSchema>;

export const GroupSchema = z.object({
  ruleId: z.string(),
  category: CategorySchema,
  title: z.string().max(300),
  count: z.number().int().min(1),
  worstSeverity: SeveritySchema,
  findingIds: z.array(z.string()),
});
export type Group = z.infer<typeof GroupSchema>;

export const AiStatusSchema = z.enum(['ok', 'fallback', 'skipped']);
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const ReportSchema = z.object({
  schema: z.literal(REPORT_SCHEMA),
  generatedAt: z.string(),
  rulesetVersion: z.string(),
  mode: z.enum(['single', 'site']),
  target: z.object({ inputUrl: z.string().max(2048), finalUrl: z.string().max(2048), host: z.string().max(255) }),
  stack: z.array(z.object({ name: z.string().max(60), confidence: z.enum(['low', 'medium', 'high']) })).max(20),
  scores: ScoresSchema,
  lighthouse: z
    .object({
      source: z.enum(['psi', 'local']),
      performance: Score,
      seo: Score.optional(),
      accessibility: Score.optional(),
      bestPractices: Score.optional(),
      metrics: z.record(z.string().max(60), z.number()).optional(),
    })
    .optional(),
  pages: z.array(PageSchema).min(1).max(50),
  brand: BrandProfileSchema,
  groups: z.array(GroupSchema),
  ai: z.object({
    status: AiStatusSchema,
    model: z.string().max(200).optional(),
    summary: z.string().max(2000),
    priorities: z.array(z.object({ groupRuleId: z.string(), rank: z.number().int().min(1), rationale: z.string().max(300) })),
    notes: z.string().max(600).optional(),
  }),
  limits: z.object({
    pagesScanned: z.number().int(),
    pagesSkipped: z.number().int(),
    truncated: z.boolean(),
    screenshotsDropped: z.number().int().optional(),
    notes: z.array(z.string().max(300)).optional(),
  }),
  /** True when Chromium was unavailable and the HTML/CSS-only fallback produced this report. */
  reducedAccuracy: z.boolean().optional(),
});
export type Report = z.infer<typeof ReportSchema>;

/* ----------------------------- API contracts ----------------------------- */

export const ScanModeSchema = z.enum(['single', 'site']);
export type ScanMode = z.infer<typeof ScanModeSchema>;

export const ScanRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  mode: ScanModeSchema.default('single'),
  turnstileToken: z.string().max(4096).optional(),
  /** Skip the cache and run a fresh scan (counts against limits). */
  fresh: z.boolean().optional(),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const ErrorCodeSchema = z.enum([
  'INVALID_URL',
  'BLOCKED_TARGET',
  'RATE_LIMITED',
  'CAPACITY',
  'QUEUE_FULL',
  'UNREACHABLE',
  'TIMEOUT',
  'NOT_HTML',
  'SCAN_FAILED',
  'TURNSTILE_FAILED',
  'NOT_FOUND',
  'BAD_REQUEST',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    resetAt: z.string().optional(),
    suggestMode: ScanModeSchema.optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const QuotaSchema = z.object({
  single: z.object({ remainingHour: z.number(), remainingDay: z.number(), resetAt: z.string() }),
  site: z.object({ remainingDay: z.number(), resetAt: z.string(), capacityAvailable: z.boolean() }),
  capacity: z.object({ single: z.boolean(), site: z.boolean() }),
  aiAvailable: z.boolean(),
  perfEngine: z.enum(['psi', 'lighthouse', 'estimated']),
  limits: z.object({
    singlePerHour: z.number(),
    singlePerDay: z.number(),
    sitePerDay: z.number(),
    siteMaxPages: z.number(),
    pdfPerHour: z.number(),
  }),
});
export type Quota = z.infer<typeof QuotaSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  queue: z.object({ running: z.number(), waiting: z.number() }),
});
export type Health = z.infer<typeof HealthSchema>;

export const StepStatusSchema = z.enum(['running', 'done', 'skipped', 'failed']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

/** Server-sent events emitted on /api/scan/:id/events. */
export type ScanEvent =
  | { type: 'queued'; data: { position: number } }
  | { type: 'started'; data: { mode: ScanMode; cached?: boolean; cachedAt?: string } }
  | { type: 'step'; data: { name: string; status: StepStatus; ms?: number; note?: string } }
  | { type: 'page_started'; data: { url: string; index: number; total: number } }
  | { type: 'page_done'; data: { url: string; scores: Record<string, number>; findingCount: number } }
  | { type: 'ai_started'; data: Record<string, never> }
  | { type: 'report'; data: { report: Report; cached: boolean; cachedAt?: string } }
  | { type: 'error'; data: { code: ErrorCode; message: string } }
  | { type: 'done'; data: Record<string, never> };

export type ScanEventType = ScanEvent['type'];

/* ------------------------------- AI output -------------------------------- */

export const AiOutputSchema = z.object({
  summary: z.string().min(20).max(1200),
  priorities: z
    .array(
      z.object({
        groupRuleId: z.string().max(120),
        rank: z.number().int().min(1),
        rationale: z.string().max(240),
      }),
    )
    .min(1),
  instructions: z
    .array(
      z.object({
        groupRuleId: z.string().max(120),
        instruction: z.string().min(10).max(500),
      }),
    )
    .default([]),
});
export type AiOutput = z.infer<typeof AiOutputSchema>;
