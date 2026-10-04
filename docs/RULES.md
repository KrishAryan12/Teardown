# Rules and scoring

Ruleset version **1.0.0**. This file is generated from `apps/scanner/src/rules` by `scripts/gen-rules-doc.ts`; edit the rules, then regenerate.

Every finding comes from a deterministic rule (or axe-core, or Lighthouse). The AI layer can reorder groups and reword instructions, but it can never add, remove or re-grade a finding, and acceptance criteria always come from the templates below.

## Scoring

Per category: start at 100 and subtract a penalty per **rule group** (all instances of one rule across the scanned pages):

```
penalty = weight(severity) x min(1 + log2(count), 2.5)
weight: critical 15, serious 8, moderate 4, minor 1   (cap 2.5x)
score = clamp(0, 100, 100 - sum(penalties))
```

Overall = weighted mean: performance 25, accessibility 25, seo 20, ux 15, brand 10, security 5.

More or worse findings never raise a score (property-tested in `packages/core/test/scoring.test.ts`).

### Performance score

The performance score is the engine score: PageSpeed Insights (if `PSI_API_KEY` is set), else local Lighthouse (mobile preset, simulated throttling, indicative lab data). If neither runs, an **estimate**:

```
resource = 100 - min(50, 10 x max(0, MB - 1)) - min(20, max(0, requests - 60) / 4)
               - min(20, 5 x render-blocking resources) - min(10, max(0, elements - 1500) / 300)
estimate = round(0.5 x resource + 0.5 x categoryScore(performance rule groups))
```

In site mode the engine runs on the home page plus up to `PERF_MAX_PAGES_FULL` pages; the report score is their mean.

### Deterministic priority (AI fallback)

Groups are ordered by `penalty x category weight`, then severity, then count. This is the order used when the AI is unavailable, and the one the AI starts from.

## Grouping and caps

Instances are grouped by rule id. Each page keeps at most 10 instances per rule; the true count is kept in `page.ruleCounts` and drives scoring.

Finding ids are `${ruleId}:${shortHash(pageUrl + selector)}`, stable across scans of an unchanged page.

## De-duplication

One concept is reported once. Where our own rule and axe-core overlap, our rule wins and the axe rule is skipped:

- axe rules skipped: `bypass`, `heading-order`, `html-has-lang`, `html-lang-valid`, `image-alt`, `label`, `landmark-one-main`, `link-name`, `no-autoplay-audio`, `page-has-heading-one`, `select-name`, `target-size`.
- `color-contrast` stays with axe (accessibility). The UX contrast rule only reports from brand extraction when axe did not run.
- The SEO "image alt" check is reported once, as `a11y.img.alt` (accessibility), because it is the same fix.
- Lighthouse audits covered by our rules (we keep ours): `target-size` → `ux.tap-target.small`, `unsized-images` → `ux.img.dimensions`, `total-byte-weight` → `perf.weight.total`, `uses-text-compression` → `perf.text.uncompressed`, `modern-image-formats` → `perf.img.format`, `uses-optimized-images` → `perf.img.format`, `uses-responsive-images` → `perf.img.oversized`, `render-blocking-resources` → `perf.render-blocking`, `render-blocking-insight` → `perf.render-blocking`, `third-party-summary` → `perf.third-party.heavy`, `third-parties-insight` → `perf.third-party.heavy`, `dom-size` → `perf.dom.large`, `dom-size-insight` → `perf.dom.large`.

## SEO

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `seo.status.error` | critical | **Page returns an error status.** The page responded with an HTTP error status. Search engines won't index it and visitors see an error. | Make the URL return 200 with the intended content, or redirect it (301) to the right page. (effort s) | The URL responds with HTTP 200 (or a single 301 to a 200 page). |
| `seo.redirect.chain` | moderate | **Redirect chain before the page loads.** The address goes through several redirects before reaching the page. Each hop adds latency and dilutes link signals. | Point links and redirects straight at the final URL so there is at most one redirect. (effort s) | Requesting the original URL reaches the final page in at most one redirect. |
| `seo.title.missing` | serious | **Page has no title.** There is no <title> element. Search results and browser tabs show the URL instead of a name. | Add a unique, descriptive <title> of 30-60 characters inside <head>. (effort xs) | The page has exactly one non-empty <title> of 30-60 characters. |
| `seo.title.short` | moderate | **Title is too short.** The title is too short to describe the page. Search engines may rewrite it, and it wastes the most visible line in results. | Expand the title to 30-60 characters: page topic first, brand last. (effort xs) | The <title> is 30-60 characters and describes the page topic. |
| `seo.title.long` | minor | **Title is too long.** Search results cut titles off at around 60 characters, so the end of this one will be hidden. | Shorten the title to 60 characters or fewer, keeping the key words first. (effort xs) | The <title> is 60 characters or fewer. |
| `seo.meta-description.missing` | moderate | **Meta description is missing.** Without a meta description, search engines pick a snippet from the page, which is often a menu or cookie notice. | Add a meta description of 70-160 characters that summarises the page and invites the click. (effort xs) | The page has one <meta name="description"> with 70-160 characters. |
| `seo.meta-description.length` | minor | **Meta description length is off.** The meta description is very short or long enough to be cut off in search results. | Rewrite the meta description to 70-160 characters. (effort xs) | The meta description is 70-160 characters long. |
| `seo.h1.missing` | moderate | **Page has no main heading (h1).** There's no visible <h1>. Screen reader users and search engines use it to understand what the page is about. | Mark up the main page heading as a single visible <h1>. (effort xs) | The page has exactly one visible <h1> with text. |
| `seo.h1.multiple` | minor | **More than one h1.** Several <h1> elements compete to be the page title, which blurs the outline for assistive tech and search. | Keep one <h1> for the page title and demote the others to <h2>. (effort xs) | The page has exactly one <h1>. |
| `seo.heading.skip` | minor | **Heading levels skip.** Headings jump levels (for example h2 to h4). The outline becomes confusing for screen reader users who navigate by heading. | Use heading levels in order without skipping, and style them with classes rather than picking levels for size. (effort s) | No heading is more than one level deeper than the heading before it. |
| `seo.canonical.missing` | minor | **No canonical URL.** Without a canonical link, URL variants (tracking parameters, trailing slashes) can be indexed as duplicates. | Add a self-referencing canonical link with the absolute, preferred URL. (effort xs) | The page has exactly one <link rel="canonical"> with an absolute URL to itself. |
| `seo.canonical.mismatch` | moderate | **Canonical URL points elsewhere.** The canonical link names a different URL, so search engines may drop this page in favour of that one. | Make the canonical point at this page's own preferred URL, unless it really is a duplicate. (effort xs) | The canonical URL matches the page URL (ignoring a trailing slash), or the page is intentionally a duplicate. |
| `seo.robots.noindex` | serious | **Page is set to noindex.** A robots directive tells search engines not to index this page, so it will not appear in results. | Remove noindex from the robots meta tag and X-Robots-Tag header if the page should be found in search. (effort xs) | Neither the robots meta tag nor the X-Robots-Tag header contains noindex. |
| `seo.viewport.missing` | serious | **No mobile viewport tag.** Without a viewport meta tag, phones render the page at desktop width and shrink it. Search engines treat it as not mobile-friendly. | Add the standard responsive viewport meta tag. (effort xs) | The page has <meta name="viewport" content="width=device-width, initial-scale=1">. Zoom is not disabled. |
| `seo.social.missing` | minor | **Social sharing tags are incomplete.** Open Graph and Twitter tags control the preview card when the page is shared. Missing tags give a bare link or a random image. | Add og:title, og:description, og:image (1200x630) and twitter:card. (effort s) | og:title, og:description and og:image are present with absolute image URL. twitter:card is present. |
| `seo.structured-data.missing` | minor | **No structured data (JSON-LD).** Structured data helps search engines show rich results (organisation, articles, products, breadcrumbs). | Add a JSON-LD block describing the page (Organization or WebSite on the home page, the right type elsewhere). (effort s) | The page has at least one valid JSON-LD block with an @type. |
| `seo.structured-data.invalid` | moderate | **Structured data can't be parsed.** A JSON-LD block contains invalid JSON, so search engines ignore it. | Fix the JSON syntax in the JSON-LD block. (effort xs) | Every <script type="application/ld+json"> block parses as JSON. |
| `seo.link.generic` | minor | **Links with generic text.** Link text like "click here" or "read more" says nothing about the destination, for search engines or for screen reader users scanning links. | Rewrite link text to describe where the link goes. (effort s) | No link’s accessible name is only a generic phrase such as "click here", "here", "read more" or "learn more". |
| `seo.links.broken` | moderate | **Broken internal links.** Some internal links lead to error pages. Visitors hit dead ends and crawlers waste budget. | Fix or remove links that return 4xx/5xx, or redirect the old URLs. (effort s) | Every internal link on the page returns 200 (or a single redirect to 200). |
| `seo.robots-txt.missing` | minor | **No robots.txt.** There's no robots.txt at the site root. Crawlers fall back to defaults and can't find your sitemap from it. | Add /robots.txt that allows crawling and links the sitemap. (effort xs) | GET /robots.txt returns 200 with text/plain and a Sitemap line. |
| `seo.sitemap.missing` | minor | **No XML sitemap found.** No sitemap was found at /sitemap.xml or in robots.txt. A sitemap helps search engines discover every page. | Publish /sitemap.xml listing your public pages and reference it in robots.txt. (effort s) | /sitemap.xml (or the URL in robots.txt) returns valid XML listing the public pages. |
| `seo.hreflang.invalid` | minor | **hreflang tags have problems.** Alternate-language links are present but have invalid language codes or no self-reference, so search engines may ignore them. | Use valid ISO language(-region) codes and include a self-referencing hreflang. (effort s) | Every hreflang value is a valid code or x-default. The page lists itself among its alternates. |

## Accessibility

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `a11y.lang.missing` | serious | **Page language is not set.** The <html> element has no lang attribute, so screen readers may read the content with the wrong voice and pronunciation. Search engines also use it. | Add a lang attribute with the page language to the <html> element. (effort xs) | <html> has a valid, non-empty lang attribute matching the content language. |
| `a11y.lang.invalid` | serious | **Page language code is invalid.** The lang attribute isn't a valid language code, so assistive tech can't use it. | Use a valid BCP 47 language code such as en, en-GB or fr. (effort xs) | <html lang> is a valid BCP 47 code. |
| `a11y.img.alt` | serious | **Images without alt text.** Images have no alt attribute. Screen readers announce the file name instead, and search engines get no description. (This also covers the SEO alt-text check.) | Give every meaningful image a short alt text describing it, and decorative images alt="". (effort s) | Every <img> has an alt attribute (empty for decorative images) or role="presentation". Linked images have alt text describing the link. |
| `a11y.link.empty` | serious | **Links with no accessible name.** These links have no text, label or alt text, so screen readers announce only "link". | Give icon-only links an accessible name with aria-label or visually hidden text. (effort xs) | Every link has a non-empty accessible name. |
| `a11y.form.label` | serious | **Form fields without labels.** These inputs have no label. Placeholder text isn't a label: it disappears while typing and many screen readers ignore it. | Connect a visible <label> to each field with for/id, or wrap the field in the label. (effort s) | Every visible input, select and textarea has a programmatically associated label. |
| `a11y.skip-link.missing` | moderate | **No skip link.** Keyboard users have to tab through the whole header and navigation on every page before reaching the content. | Add a "Skip to content" link as the first focusable element, visible on focus, pointing at the main content. (effort xs) | Pressing Tab once on page load focuses a visible "Skip to content" link. Activating it moves focus to the main content. |
| `a11y.focus.invisible` | serious | **Keyboard focus is invisible.** When these elements receive keyboard focus nothing visibly changes, so keyboard users lose track of where they are (WCAG 2.4.7). | Give every interactive element a clearly visible :focus-visible style, and never remove outlines without a replacement. (effort s) | Every focusable element shows a visible focus indicator with at least 3:1 contrast against its surroundings. |
| `a11y.landmark.main` | moderate | **No main landmark.** There's no <main> element. Screen reader users can't jump straight to the content, and skip links have nothing to target. | Wrap the primary content in a single <main> element, and use <header>, <nav> and <footer> for the rest. (effort s) | The page has exactly one <main> (or role="main"). Navigation is inside <nav>. |

## UX

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `ux.tap-target.small` | serious | **Tap targets smaller than 24px.** On a phone these controls are smaller than 24x24 CSS pixels, the WCAG 2.2 minimum (2.5.8), so people mis-tap. | Make each control at least 24x24px (44x44px is better) using padding, without changing the visual size of icons. (effort s) | At 390px width, every tap target is at least 24x24 CSS px (or has 24px spacing to its neighbours). |
| `ux.tap-target.comfort` | minor | **Tap targets under 44px.** These controls meet the 24px minimum but are smaller than the comfortable 44x44px recommended for touch. | Grow touch targets to 44x44px where the layout allows, using padding. (effort s) | Primary controls are at least 44x44 CSS px on mobile. |
| `ux.text.small` | moderate | **Body text smaller than 16px.** A large share of the running text is under 16px, which is hard to read on phones and for many older readers. | Set body text to at least 16px (1rem) and size other text relative to it. (effort s) | Paragraph and list text renders at 16px or larger at all viewport widths. |
| `ux.line-length` | minor | **Lines of text are too long.** Paragraph lines run past ~90 characters. Long lines make it hard to find the start of the next line. | Limit text columns to about 60-75 characters with max-width. (effort xs) | Paragraphs on a 1440px-wide screen have at most ~80 characters per line. |
| `ux.mobile.overflow` | serious | **Page scrolls sideways on mobile.** At phone width the page is wider than the screen, so content is cut off and the page wobbles sideways while scrolling. | Find the element wider than the viewport and make it fluid. (effort s) | At 390px width, document.documentElement.scrollWidth equals window.innerWidth. |
| `ux.img.dimensions` | moderate | **Images without width and height.** Images without width/height (or aspect-ratio) make the layout jump as they load (cumulative layout shift). | Add width and height attributes matching the intrinsic size, and let CSS scale them. (effort xs) | Every content <img> has width and height attributes or a CSS aspect-ratio. |
| `ux.primary-action.missing` | minor | **No clear call to action above the fold.** Teardown found no button-styled primary action in the first screen (heuristic). Visitors may not know what to do next. | Place one visually prominent primary action in the first viewport. (effort s) | A button-styled primary action is visible without scrolling at 1440x900 and 390x844. |
| `ux.overlay.intrusive` | serious | **Overlay covers most of the screen on load.** A fixed overlay (cookie wall, popup or modal) covers over 40% of the screen when the page loads, blocking the content. | Shrink the overlay to a small banner, or delay it until the visitor has engaged. (effort m) | No overlay covers more than 30% of the viewport on initial load. |
| `ux.media.autoplay` | moderate | **Media autoplays with sound.** Audio or video starts playing with sound on its own, which startles visitors and interferes with screen readers (WCAG 1.4.2). | Remove autoplay, or autoplay muted with visible controls. (effort xs) | No media plays sound without a user action. |
| `ux.contrast.low` | serious | **Low-contrast text.** Text colours against their backgrounds fall below the WCAG AA contrast ratio, so they are hard to read, especially outdoors or for people with low vision. | Darken the text (or lighten the background) until each pair reaches 4.5:1 (3:1 for large text). (effort s) | Every text/background pair has at least 4.5:1 contrast (3:1 for 24px+ or 18.66px+ bold). |

## Security hygiene

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `sec.https.missing` | serious | **Page is served without HTTPS.** The final page loads over plain HTTP. Anyone on the network can read or change it, and browsers mark it "Not secure". | Serve the site over HTTPS and redirect all HTTP requests to it. (effort m) | http:// requests 301-redirect to https://. The page loads over HTTPS with a valid certificate. |
| `sec.hsts.missing` | minor | **No HSTS header.** Without Strict-Transport-Security, a first visit over http:// can be intercepted before the redirect to HTTPS. | Send a Strict-Transport-Security header on HTTPS responses. (effort xs) | HTTPS responses include Strict-Transport-Security with max-age >= 15552000. |
| `sec.mixed-content` | moderate | **Insecure resources on a secure page.** The HTTPS page loads resources over plain HTTP. Browsers block many of them and warn about the rest. | Load every resource over https:// (or relative URLs). (effort xs) | No resource on the page is requested over http://. |
| `sec.headers.csp` | minor | **No Content Security Policy.** A Content-Security-Policy limits where scripts can load from, which blunts cross-site scripting. | Add a Content-Security-Policy header, starting in report-only mode. (effort m) | Responses include a Content-Security-Policy header (enforcing or report-only). |
| `sec.headers.nosniff` | minor | **No X-Content-Type-Options header.** Without `X-Content-Type-Options: nosniff`, browsers may guess file types, which can turn uploads into scripts. | Send `X-Content-Type-Options: nosniff` on all responses. (effort xs) | Responses include X-Content-Type-Options: nosniff. |
| `sec.headers.referrer` | minor | **No Referrer-Policy header.** Without a Referrer-Policy, full URLs (which can include private query strings) may leak to other sites. | Send `Referrer-Policy: strict-origin-when-cross-origin`. (effort xs) | Responses include a Referrer-Policy header. |
| `sec.headers.framing` | minor | **Page can be framed by other sites.** No X-Frame-Options or CSP frame-ancestors, so other sites can embed this page and trick visitors into clicking (clickjacking). | Send `Content-Security-Policy: frame-ancestors 'self'` (or X-Frame-Options: SAMEORIGIN). (effort xs) | Responses include frame-ancestors in CSP or X-Frame-Options. |
| `sec.version.exposed` | minor | **Software versions are exposed.** Headers or meta tags reveal exact software versions, which helps attackers match known vulnerabilities. | Remove version numbers from the generator meta tag and Server/X-Powered-By headers. (effort xs) | No response header or meta tag contains a software version number. |

## Brand consistency

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `brand.colors.near-duplicates` | moderate | **Near-duplicate colours.** Several colours in use are almost identical. They usually come from one-off hex values instead of shared tokens, and make the palette feel slightly off. | Merge each near-duplicate pair into one token and replace the stray values. (effort m) | No two colours in the extracted palette are within ΔE 6 of each other unless intentionally distinct. |
| `brand.fonts.too-many` | moderate | **Too many font families.** More than three typefaces are in use. It dilutes the brand and every web font adds download weight. | Reduce to two families (one for headings, one for body), plus a monospace if you show code. (effort m) | At most 3 font families render on the page. |
| `brand.fonts.weights` | minor | **Many font weights.** More than five font weights are in use. Each web-font weight is a separate download and the hierarchy gets muddy. | Limit the system to 2-4 weights (e.g. 400, 600, 700). (effort s) | At most 4 distinct font weights render on the page. |
| `brand.type-scale.irregular` | minor | **Font sizes follow no scale.** Many different font sizes are used and they don't follow a consistent ratio, so the hierarchy looks improvised. | Define a type scale (e.g. 1.25 ratio from 16px) as tokens and map every size to a step. (effort m) | Text uses at most 8 distinct sizes, each a step of one scale. |
| `brand.spacing.off-grid` | minor | **Spacing is off-grid.** Margins and paddings use arbitrary values instead of multiples of a base unit, so rhythm and alignment drift. | Adopt a 4px or 8px spacing scale as tokens and snap values to it. (effort m) | At least 80% of margin, padding and gap values are multiples of 4px. |
| `brand.radii.inconsistent` | minor | **Inconsistent corner radii.** Many different border radii are in use, so cards, buttons and inputs look like they come from different systems. | Define 2-3 radius tokens (small, medium, pill) and use only those. (effort s) | At most 3 distinct non-zero border radii are used. |
| `brand.buttons.inconsistent` | moderate | **Buttons come in many styles.** Button-like elements use several different combinations of colour, padding, radius and type, which weakens the visual hierarchy. | Define primary, secondary and tertiary button styles and apply them everywhere. (effort m) | All button-like elements use one of at most 3 defined variants. |
| `brand.tokens.none` | minor | **No design tokens in CSS.** No CSS custom properties were found on :root. Tokens make brand colours, type and spacing consistent and easy to change. (Informational; cross-origin stylesheets cannot be read.) | Move brand values into CSS custom properties. The brand tokens in this report are a ready-made starting point. (effort m) | :root defines colour, font, spacing and radius custom properties used by components. |

## Performance (local checks)

| Rule | Severity | What it checks | Fix | Acceptance |
|---|---|---|---|---|
| `perf.weight.total` | moderate | **Page is heavy.** The page transfers a lot of data. On mobile connections that means slow loads and real cost for visitors on metered data. | Cut transfer size: compress and resize images, drop unused scripts, and lazy-load below-the-fold media. (effort m) | Total transfer on first load is under 2 MB (ideally under 1 MB). |
| `perf.requests.many` | moderate | **Too many requests.** The page makes a very large number of requests, which competes for bandwidth and delays rendering. | Remove unused resources, bundle small files and lazy-load what is below the fold. (effort m) | The page makes fewer than 80 requests on first load. |
| `perf.text.uncompressed` | moderate | **Text files sent without compression.** HTML, CSS, JavaScript or SVG files are sent uncompressed. Gzip or Brotli typically cuts them by 70% or more. | Enable Brotli or gzip compression for text responses on the server or CDN. (effort xs) | Text responses over 1 KB are served with Content-Encoding: br or gzip. |
| `perf.img.format` | moderate | **Large images in old formats.** Large images are served as PNG or JPEG. WebP or AVIF are usually 30-60% smaller at the same quality. | Serve large images as AVIF or WebP (with a JPEG fallback if needed) and compress them. (effort s) | No image over 100 KB is served as PNG or JPEG. |
| `perf.img.oversized` | moderate | **Images much larger than displayed.** These images are downloaded at far more pixels than they are shown at, wasting bandwidth and decode time. | Resize images to their display size and use srcset/sizes for responsive variants. (effort s) | No image’s intrinsic width is more than 2x its rendered width on a 1440px screen. |
| `perf.render-blocking` | moderate | **Render-blocking scripts and styles.** Synchronous scripts and stylesheets in <head> must download before anything is painted. | Add defer to head scripts, inline critical CSS, and load the rest of the CSS without blocking. (effort s) | No synchronous <script src> in <head>. At most one render-blocking stylesheet. |
| `perf.third-party.heavy` | moderate | **Heavy third-party code.** Third-party resources (analytics, widgets, ads, embeds) make up a large part of the page weight and are outside your control. | Remove third-party tags you do not need and load the rest after the page is interactive. (effort m) | Third-party transfer is under 300 KB on first load. |
| `perf.dom.large` | minor | **Very large DOM.** The page has a very large number of elements, which slows style calculation, layout and interaction. | Reduce DOM size: paginate or virtualise long lists, and remove hidden duplicate markup. (effort m) | The page has fewer than 1,500 DOM elements. |

## axe-core

All other axe-core violations (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice) become `a11y.axe.<axe-id>` findings. Impact maps 1:1 to severity (critical, serious, moderate, minor). The axe rule id is kept in `evidence.ref`. Common rules have hand-written fix templates; the rest use a generic template that links to the axe guidance.

## Lighthouse

Lighthouse (or PSI) audits scoring below 0.9 become `perf.lh.<audit-id>` findings: the core metrics (LCP, CLS, TBT, FCP, Speed Index) and the top opportunities with estimated savings, minus audits listed above as covered by our own rules.
