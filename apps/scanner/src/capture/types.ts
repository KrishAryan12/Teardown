/** Shapes returned by inpage/collect.js and inpage/mobile.js, plus the capture result. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementRef {
  selector: string;
  snippet?: string;
  bbox?: Rect | null;
}

export interface PageFacts {
  url: string;
  hasLayout: boolean;
  viewport: { w: number; h: number };
  doc: { w: number; h: number };
  head: {
    title: string;
    titleCount: number;
    lang: string | null;
    metaDescription: string | null;
    metaRobots: string | null;
    viewport: string | null;
    charset: string | null;
    generator: string | null;
    themeColor: string | null;
    canonical: string | null;
    canonicalCount: number;
    og: { title: string | null; description: string | null; image: string | null; type: string | null; url: string | null };
    twitter: { card: string | null; title: string | null; image: string | null };
    jsonLd: { valid: boolean; types: string[]; error?: string }[];
    hreflang: { lang: string; href: string }[];
    favicon: string | null;
  };
  headings: { level: number; text: string; selector: string; visible: boolean; bbox: Rect | null }[];
  images: (ElementRef & {
    src: string;
    alt: string | null;
    role: string | null;
    ariaHidden: boolean;
    ariaLabel: string | null;
    inLink: boolean;
    hasDimensions: boolean;
    naturalW: number;
    naturalH: number;
    renderedW: number;
    renderedH: number;
    loading: string | null;
    aboveFold: boolean;
    visible: boolean;
  })[];
  imageCount: number;
  links: (ElementRef & {
    href: string;
    rawHref: string;
    protocol: string;
    text: string;
    accessibleName: string;
    internal: boolean;
    rel: string | null;
    target: string | null;
    visible: boolean;
  })[];
  linkCount: number;
  unlabeledControls: (ElementRef & { placeholder: string | null })[];
  landmarks: { main: number; nav: number; header: number; footer: number };
  skipLink: { found: boolean; selector?: string };
  focus: { tested: number; invisible: ElementRef[] };
  smallText: { chars: number; totalChars: number; samples: (ElementRef & { px: number })[] };
  longLines: (ElementRef & { cpl: number })[];
  primaryAction: { checked: boolean; found: boolean; selector?: string; text?: string };
  overlays: (ElementRef & { coverage: number })[];
  autoplay: ElementRef[];
  renderBlocking: { kind: 'script' | 'stylesheet'; url: string }[];
  mixedContent: { url: string; selector: string }[];
  stackHints: { name: string; confidence: 'low' | 'medium' | 'high' }[];
  domNodes: number;
  textLength: number;
}

interface Counted {
  key: string;
  count: number;
}

export interface BrandRaw {
  sampled: number;
  colors: { kind: 'bg' | 'text' | 'border' | 'svg'; hex: string; interactive: boolean; weight: number; count: number; key: string }[];
  fonts: (Counted & { family: string; weight: number; chars: number; roles: Record<string, number> })[];
  sizes: (Counted & { tags: Record<string, number> })[];
  spacing: Counted[];
  radii: Counted[];
  shadows: Counted[];
  contrast: (Counted & { fg: string; bg: string; large: boolean; ratio: number; chars: number; selector: string; bbox: Rect | null; snippet: string })[];
  contrastUnknown: number;
  buttons: (Counted & { selector: string; text: string })[];
  cssVars: Record<string, string>;
  fontFaces: { family: string; src: string }[];
  fontLinks: string[];
  importsGoogle: boolean;
  assets: { logoUrl: string | null; favicon: string | null; themeColor: string | null; ogImage: string | null };
  /** Added in Node from CDP CSS.getPlatformFontsForNode: declared first family -> rendered family. */
  platformFonts?: Record<string, string>;
}

export interface MobileFacts {
  viewportW: number;
  scrollWidth: number;
  clipped: boolean;
  overflow: boolean;
  overflowOffenders: (ElementRef & { right: number })[];
  tapTargets: { checked: number; below24: number; below44: number; samples: (ElementRef & { w: number; h: number; level: 24 | 44 })[] };
  viewportMeta: string | null;
  docH: number;
  bodyFontPx: number;
}

export interface NetworkEntry {
  url: string;
  type: string;
  mime: string;
  status: number;
  bytes: number;
  encoding: string;
  host: string;
  thirdParty: boolean;
}

export interface NetworkSummary {
  requests: number;
  transferBytes: number;
  byType: Record<string, { count: number; bytes: number }>;
  thirdParty: { host: string; requests: number; bytes: number }[];
  thirdPartyBytes: number;
  imageFormats: Record<string, number>;
  uncompressed: { url: string; bytes: number; type: string }[];
  largestImages: { url: string; bytes: number; mime: string }[];
  blockedRequests: number;
  failedRequests: number;
  capped: boolean;
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  /** Total affected nodes (nodes[] is capped). */
  nodeCount?: number;
  nodes: { target: string; html: string; failureSummary?: string; bbox?: Rect | null; measured?: string; expected?: string }[];
}

export interface Screenshot {
  dataUrl: string;
  /** CSS px of the captured area. */
  w: number;
  h: number;
  bytes: number;
}

export interface PageCapture {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  redirects: { url: string; status: number }[];
  rawHtml: string;
  title: string;
  facts: PageFacts;
  brand: BrandRaw | null;
  mobile: MobileFacts | null;
  network: NetworkSummary | null;
  axe: AxeViolation[] | null;
  screenshots: { desktop?: Screenshot; mobile?: Screenshot };
  timings: Record<string, number>;
  /** True when captured without Chromium (static HTML fallback). */
  reduced: boolean;
  notes: string[];
}
