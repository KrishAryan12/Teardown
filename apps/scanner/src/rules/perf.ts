import type { Rule } from './types';

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export const perfRules: Rule[] = [
  {
    id: 'perf.weight.total',
    category: 'performance',
    severity: 'moderate',
    title: 'Page is heavy',
    detail: 'The page transfers a lot of data. On mobile connections that means slow loads and real cost for visitors on metered data.',
    supersedesLighthouse: ['total-byte-weight'],
    fix: {
      summary: 'Cut transfer size: compress and resize images, drop unused scripts, and lazy-load below-the-fold media.',
      steps: ['Sort the network panel by size and tackle the largest files first.', 'Serve images in WebP/AVIF at display size.', 'Remove or defer third-party scripts that are not essential.'],
      effort: 'm',
      acceptance: ['Total transfer on first load is under 2 MB (ideally under 1 MB).'],
      verify: 'DevTools Network panel, disable cache, reload: check the "transferred" total.',
    },
    check: ({ capture }) => {
      const n = capture.network;
      if (!n || n.transferBytes < 2.5 * 1024 * 1024) return null;
      return { measured: kb(n.transferBytes), expected: '< 2 MB', severity: n.transferBytes > 5 * 1024 * 1024 ? 'serious' : 'moderate' };
    },
  },
  {
    id: 'perf.requests.many',
    category: 'performance',
    severity: 'moderate',
    title: 'Too many requests',
    detail: 'The page makes a very large number of requests, which competes for bandwidth and delays rendering.',
    fix: {
      summary: 'Remove unused resources, bundle small files and lazy-load what is below the fold.',
      steps: ['Audit third-party tags and remove unused ones.', 'Lazy-load offscreen images and embeds.', 'Inline tiny SVG icons or use a sprite.'],
      effort: 'm',
      acceptance: ['The page makes fewer than 80 requests on first load.'],
    },
    check: ({ capture }) => {
      const n = capture.network;
      return !!n && n.requests > 100 && { measured: `${n.requests}${n.capped ? '+ (capped)' : ''} requests`, expected: '< 80' };
    },
  },
  {
    id: 'perf.text.uncompressed',
    category: 'performance',
    severity: 'moderate',
    title: 'Text files sent without compression',
    detail: 'HTML, CSS, JavaScript or SVG files are sent uncompressed. Gzip or Brotli typically cuts them by 70% or more.',
    supersedesLighthouse: ['uses-text-compression'],
    fix: {
      summary: 'Enable Brotli or gzip compression for text responses on the server or CDN.',
      steps: ['Turn on compression in the host/CDN settings, or in the web server (e.g. nginx `gzip on; brotli on;`).', 'Include text/html, text/css, application/javascript, image/svg+xml and application/json.'],
      effort: 'xs',
      acceptance: ['Text responses over 1 KB are served with Content-Encoding: br or gzip.'],
      verify: 'Run `curl -sI -H "Accept-Encoding: br,gzip" <asset-url> | grep -i content-encoding`',
    },
    check: ({ capture }) => capture.network?.uncompressed.map((u) => ({ measured: `${kb(u.bytes)} uncompressed: ${u.url.slice(0, 120)}`, expected: 'br or gzip' })),
  },
  {
    id: 'perf.img.format',
    category: 'performance',
    severity: 'moderate',
    title: 'Large images in old formats',
    detail: 'Large images are served as PNG or JPEG. WebP or AVIF are usually 30-60% smaller at the same quality.',
    supersedesLighthouse: ['modern-image-formats', 'uses-optimized-images'],
    fix: {
      summary: 'Serve large images as AVIF or WebP (with a JPEG fallback if needed) and compress them.',
      steps: ['Convert the listed images (e.g. with Squoosh, sharp or your image CDN).', 'Use <picture> with type="image/avif" and "image/webp" sources, or an image component that negotiates formats.'],
      codeHint: '<picture>\n  <source srcset="hero.avif" type="image/avif">\n  <source srcset="hero.webp" type="image/webp">\n  <img src="hero.jpg" width="1200" height="800" alt="…">\n</picture>',
      effort: 's',
      acceptance: ['No image over 100 KB is served as PNG or JPEG.'],
    },
    check: ({ capture }) =>
      capture.network?.largestImages
        .filter((i) => /png|jpe?g/.test(i.mime) && i.bytes > 100 * 1024)
        .map((i) => ({ measured: `${kb(i.bytes)} ${i.mime.replace('image/', '')}: ${i.url.slice(0, 120)}`, expected: 'AVIF/WebP' })),
  },
  {
    id: 'perf.img.oversized',
    category: 'performance',
    severity: 'moderate',
    title: 'Images much larger than displayed',
    detail: 'These images are downloaded at far more pixels than they are shown at, wasting bandwidth and decode time.',
    supersedesLighthouse: ['uses-responsive-images'],
    fix: {
      summary: 'Resize images to their display size and use srcset/sizes for responsive variants.',
      steps: ['Export each image at about 2x its rendered width.', 'Add srcset with a few widths and a sizes attribute.'],
      codeHint: '<img src="card-640.webp" srcset="card-320.webp 320w, card-640.webp 640w" sizes="(min-width: 800px) 320px, 90vw" width="640" height="400" alt="…">',
      effort: 's',
      acceptance: ['No image’s intrinsic width is more than 2x its rendered width on a 1440px screen.'],
    },
    check: ({ capture }) =>
      capture.facts.images
        .filter((i) => i.visible && i.renderedW > 0 && i.naturalW > 400 && i.naturalW > i.renderedW * 2.5)
        .map((i) => ({ selector: i.selector, snippet: i.snippet, bbox: i.bbox, measured: `${i.naturalW}px shown at ${i.renderedW}px`, expected: `<= ${i.renderedW * 2}px` })),
  },
  {
    id: 'perf.render-blocking',
    category: 'performance',
    severity: 'moderate',
    title: 'Render-blocking scripts and styles',
    detail: 'Synchronous scripts and stylesheets in <head> must download before anything is painted.',
    supersedesLighthouse: ['render-blocking-resources', 'render-blocking-insight'],
    fix: {
      summary: 'Add defer to head scripts, inline critical CSS, and load the rest of the CSS without blocking.',
      steps: ['Add `defer` (or `type="module"`) to scripts in <head>.', 'Inline the small amount of CSS needed for the first screen.', 'Load non-critical CSS with media="print" onload swap, or split it per route.'],
      codeHint: '<script src="app.js" defer></script>',
      effort: 's',
      acceptance: ['No synchronous <script src> in <head>.', 'At most one render-blocking stylesheet.'],
    },
    check: ({ capture }) => {
      const rb = capture.facts.renderBlocking;
      const scripts = rb.filter((r) => r.kind === 'script');
      const sheets = rb.filter((r) => r.kind === 'stylesheet');
      if (scripts.length === 0 && sheets.length <= 1) return null;
      return [...scripts, ...(sheets.length > 1 ? sheets : [])].map((r) => ({ measured: `${r.kind}: ${r.url.slice(0, 140)}`, expected: r.kind === 'script' ? 'defer/async' : 'inlined or deferred' }));
    },
  },
  {
    id: 'perf.third-party.heavy',
    category: 'performance',
    severity: 'moderate',
    title: 'Heavy third-party code',
    detail: 'Third-party resources (analytics, widgets, ads, embeds) make up a large part of the page weight and are outside your control.',
    supersedesLighthouse: ['third-party-summary', 'third-parties-insight'],
    fix: {
      summary: 'Remove third-party tags you do not need and load the rest after the page is interactive.',
      steps: ['List third-party hosts (below) and confirm each one is still needed.', 'Load analytics with async/defer or after consent.', 'Replace heavy embeds with a click-to-load facade.'],
      effort: 'm',
      acceptance: ['Third-party transfer is under 300 KB on first load.'],
    },
    check: ({ capture }) => {
      const n = capture.network;
      if (!n || n.thirdPartyBytes < 500 * 1024) return null;
      return { measured: `${kb(n.thirdPartyBytes)} from ${n.thirdParty.slice(0, 4).map((t) => t.host).join(', ')}`.slice(0, 190), expected: '< 300 KB' };
    },
  },
  {
    id: 'perf.dom.large',
    category: 'performance',
    severity: 'minor',
    title: 'Very large DOM',
    detail: 'The page has a very large number of elements, which slows style calculation, layout and interaction.',
    supersedesLighthouse: ['dom-size', 'dom-size-insight'],
    fix: {
      summary: 'Reduce DOM size: paginate or virtualise long lists, and remove hidden duplicate markup.',
      steps: ['Find repeated or hidden subtrees (e.g. duplicated mobile/desktop menus).', 'Virtualise long lists and lazy-render offscreen sections.'],
      effort: 'm',
      acceptance: ['The page has fewer than 1,500 DOM elements.'],
    },
    check: ({ capture }) => capture.facts.domNodes > 1500 && { measured: `${capture.facts.domNodes} elements`, expected: '< 1,500' },
  },
];
