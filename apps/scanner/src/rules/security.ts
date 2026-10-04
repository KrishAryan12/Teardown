import type { Rule } from './types';

const header = (h: Record<string, string>, name: string) => h[name.toLowerCase()];

export const securityRules: Rule[] = [
  {
    id: 'sec.https.missing',
    category: 'security',
    severity: 'serious',
    title: 'Page is served without HTTPS',
    detail: 'The final page loads over plain HTTP. Anyone on the network can read or change it, and browsers mark it "Not secure".',
    fix: {
      summary: 'Serve the site over HTTPS and redirect all HTTP requests to it.',
      steps: ['Enable a TLS certificate (most hosts offer free automatic certificates).', 'Redirect http:// to https:// with a 301.', 'Update internal links and canonical URLs to https.'],
      effort: 'm',
      acceptance: ['http:// requests 301-redirect to https://.', 'The page loads over HTTPS with a valid certificate.'],
    },
    check: ({ url, primary }) => primary && url.startsWith('http:') && { measured: 'http', expected: 'https' },
  },
  {
    id: 'sec.hsts.missing',
    category: 'security',
    severity: 'minor',
    title: 'No HSTS header',
    detail: 'Without Strict-Transport-Security, a first visit over http:// can be intercepted before the redirect to HTTPS.',
    fix: {
      summary: 'Send a Strict-Transport-Security header on HTTPS responses.',
      steps: ['Add the header at the host/CDN level.', 'Start with a short max-age, then raise it to a year.'],
      codeHint: 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
      effort: 'xs',
      acceptance: ['HTTPS responses include Strict-Transport-Security with max-age >= 15552000.'],
      verify: 'Run `curl -sI https://<site> | grep -i strict-transport`',
    },
    check: ({ url, capture, primary }) => primary && url.startsWith('https:') && !header(capture.headers, 'strict-transport-security') && { expected: 'max-age >= 15552000' },
  },
  {
    id: 'sec.mixed-content',
    category: 'security',
    severity: 'moderate',
    title: 'Insecure resources on a secure page',
    detail: 'The HTTPS page loads resources over plain HTTP. Browsers block many of them and warn about the rest.',
    fix: {
      summary: 'Load every resource over https:// (or relative URLs).',
      steps: ['Change each http:// URL to https://.', 'Add `Content-Security-Policy: upgrade-insecure-requests` as a safety net.'],
      effort: 'xs',
      acceptance: ['No resource on the page is requested over http://.'],
    },
    check: ({ capture }) => capture.facts.mixedContent.map((m) => ({ selector: m.selector, measured: m.url.slice(0, 180), expected: 'https://' })),
  },
  {
    id: 'sec.headers.csp',
    category: 'security',
    severity: 'minor',
    title: 'No Content Security Policy',
    detail: 'A Content-Security-Policy limits where scripts can load from, which blunts cross-site scripting.',
    fix: {
      summary: 'Add a Content-Security-Policy header, starting in report-only mode.',
      steps: ['Start with `Content-Security-Policy-Report-Only` to see what would break.', 'List the script, style, image and font sources you need.', 'Switch to enforcing once reports are clean.'],
      codeHint: "Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
      effort: 'm',
      acceptance: ['Responses include a Content-Security-Policy header (enforcing or report-only).'],
    },
    check: ({ capture, primary }) =>
      primary && !header(capture.headers, 'content-security-policy') && !header(capture.headers, 'content-security-policy-report-only') && { expected: 'Content-Security-Policy header' },
  },
  {
    id: 'sec.headers.nosniff',
    category: 'security',
    severity: 'minor',
    title: 'No X-Content-Type-Options header',
    detail: 'Without `X-Content-Type-Options: nosniff`, browsers may guess file types, which can turn uploads into scripts.',
    fix: {
      summary: 'Send `X-Content-Type-Options: nosniff` on all responses.',
      steps: ['Add the header in your host, CDN or server config.'],
      codeHint: 'X-Content-Type-Options: nosniff',
      effort: 'xs',
      acceptance: ['Responses include X-Content-Type-Options: nosniff.'],
    },
    check: ({ capture, primary }) => primary && !/nosniff/i.test(header(capture.headers, 'x-content-type-options') ?? '') && { expected: 'nosniff' },
  },
  {
    id: 'sec.headers.referrer',
    category: 'security',
    severity: 'minor',
    title: 'No Referrer-Policy header',
    detail: 'Without a Referrer-Policy, full URLs (which can include private query strings) may leak to other sites.',
    fix: {
      summary: 'Send `Referrer-Policy: strict-origin-when-cross-origin`.',
      steps: ['Add the header in your host, CDN or server config.'],
      codeHint: 'Referrer-Policy: strict-origin-when-cross-origin',
      effort: 'xs',
      acceptance: ['Responses include a Referrer-Policy header.'],
    },
    check: ({ capture, primary }) => primary && !header(capture.headers, 'referrer-policy') && { expected: 'strict-origin-when-cross-origin' },
  },
  {
    id: 'sec.headers.framing',
    category: 'security',
    severity: 'minor',
    title: 'Page can be framed by other sites',
    detail: 'No X-Frame-Options or CSP frame-ancestors, so other sites can embed this page and trick visitors into clicking (clickjacking).',
    fix: {
      summary: "Send `Content-Security-Policy: frame-ancestors 'self'` (or X-Frame-Options: SAMEORIGIN).",
      steps: ['Add the directive to your CSP, or add X-Frame-Options.'],
      codeHint: "Content-Security-Policy: frame-ancestors 'self'\nX-Frame-Options: SAMEORIGIN",
      effort: 'xs',
      acceptance: ['Responses include frame-ancestors in CSP or X-Frame-Options.'],
    },
    check: ({ capture, primary }) =>
      primary && !header(capture.headers, 'x-frame-options') && !/frame-ancestors/i.test(header(capture.headers, 'content-security-policy') ?? '') && { expected: "frame-ancestors 'self'" },
  },
  {
    id: 'sec.version.exposed',
    category: 'security',
    severity: 'minor',
    title: 'Software versions are exposed',
    detail: 'Headers or meta tags reveal exact software versions, which helps attackers match known vulnerabilities.',
    fix: {
      summary: 'Remove version numbers from the generator meta tag and Server/X-Powered-By headers.',
      steps: ['Remove or genericise <meta name="generator">.', 'Disable X-Powered-By and version tokens in the server config.'],
      effort: 'xs',
      acceptance: ['No response header or meta tag contains a software version number.'],
    },
    check: ({ capture, primary }) => {
      if (!primary) return null;
      const hits = [
        ['meta generator', capture.facts.head.generator],
        ['X-Powered-By', header(capture.headers, 'x-powered-by')],
        ['Server', header(capture.headers, 'server')],
      ].filter(([, v]) => v && /\d+\.\d+/.test(v));
      return hits.map(([k, v]) => ({ measured: `${k}: ${String(v).slice(0, 80)}`, expected: 'no version' }));
    },
  },
];
