import type { Rule, RuleHit } from './types';

const GENERIC_LINK = /^(click here|here|read more|more|learn more|link|this|this link|go|continue|details|more info|info|see more|find out more)$/i;

const sameDoc = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const norm = (u: URL) => `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
    return norm(x) === norm(y);
  } catch {
    return false;
  }
};

export const seoRules: Rule[] = [
  {
    id: 'seo.status.error',
    category: 'seo',
    severity: 'critical',
    title: 'Page returns an error status',
    detail: "The page responded with an HTTP error status. Search engines won't index it and visitors see an error.",
    fix: {
      summary: 'Make the URL return 200 with the intended content, or redirect it (301) to the right page.',
      steps: ['Check the server or hosting logs for this URL.', 'Restore the page, or add a 301 redirect to its replacement.', 'Remove internal links that point to dead URLs.'],
      effort: 's',
      acceptance: ['The URL responds with HTTP 200 (or a single 301 to a 200 page).'],
      verify: 'Run `curl -sI <url>` and check the status line.',
    },
    check: ({ capture }) => capture.status >= 400 && { measured: `HTTP ${capture.status}`, expected: 'HTTP 200' },
  },
  {
    id: 'seo.redirect.chain',
    category: 'seo',
    severity: 'moderate',
    title: 'Redirect chain before the page loads',
    detail: 'The address goes through several redirects before reaching the page. Each hop adds latency and dilutes link signals.',
    fix: {
      summary: 'Point links and redirects straight at the final URL so there is at most one redirect.',
      steps: ['List the hops with `curl -sIL <url>`.', 'Change the first redirect to go directly to the final URL.', 'Update internal links, canonical tags and the sitemap to use the final URL.'],
      effort: 's',
      acceptance: ['Requesting the original URL reaches the final page in at most one redirect.'],
      verify: 'Run `curl -sIL <url> | grep -i ^location` and count the hops.',
    },
    check: ({ capture }) =>
      capture.redirects.length >= 2 && { measured: `${capture.redirects.length} redirects`, expected: '<= 1 redirect', detail: `Redirect hops: ${capture.redirects.map((r) => `${r.status} ${r.url}`).join(' → ')}`.slice(0, 1900) },
  },
  {
    id: 'seo.title.missing',
    category: 'seo',
    severity: 'serious',
    title: 'Page has no title',
    detail: 'There is no <title> element. Search results and browser tabs show the URL instead of a name.',
    fix: {
      summary: 'Add a unique, descriptive <title> of 30-60 characters inside <head>.',
      steps: ['Write a title that names the page topic first and the brand last.', 'Add it inside <head>, once per page.'],
      codeHint: '<title>Page topic | Brand</title>',
      effort: 'xs',
      acceptance: ['The page has exactly one non-empty <title> of 30-60 characters.'],
    },
    check: ({ capture }) => !capture.facts.head.title && { expected: '1 title, 30-60 characters' },
  },
  {
    id: 'seo.title.short',
    category: 'seo',
    severity: 'moderate',
    title: 'Title is too short',
    detail: 'The title is too short to describe the page. Search engines may rewrite it, and it wastes the most visible line in results.',
    fix: {
      summary: 'Expand the title to 30-60 characters: page topic first, brand last.',
      steps: ['Describe what the page offers in plain words.', 'Append the brand name after a separator.'],
      codeHint: '<title>Fast, accessible websites for small teams | Northwind</title>',
      effort: 'xs',
      acceptance: ['The <title> is 30-60 characters and describes the page topic.'],
    },
    check: ({ capture }) => {
      const t = capture.facts.head.title;
      if (!t || t.length >= 30) return null;
      return { measured: `${t.length} characters ("${t.slice(0, 40)}")`, expected: '30-60 characters', severity: t.length < 15 ? 'moderate' : 'minor' };
    },
  },
  {
    id: 'seo.title.long',
    category: 'seo',
    severity: 'minor',
    title: 'Title is too long',
    detail: 'Search results cut titles off at around 60 characters, so the end of this one will be hidden.',
    fix: {
      summary: 'Shorten the title to 60 characters or fewer, keeping the key words first.',
      steps: ['Remove filler words and repeated brand names.', 'Keep the most important words in the first 50 characters.'],
      effort: 'xs',
      acceptance: ['The <title> is 60 characters or fewer.'],
    },
    check: ({ capture }) => {
      const t = capture.facts.head.title;
      return t.length > 65 && { measured: `${t.length} characters`, expected: '<= 60 characters' };
    },
  },
  {
    id: 'seo.title.duplicate',
    category: 'seo',
    severity: 'moderate',
    title: 'Several pages share the same title',
    detail: 'Pages with identical titles look like duplicates to search engines and are hard to tell apart in tabs and results.',
    fix: {
      summary: 'Give every page a unique title that names its own topic.',
      steps: ['Generate titles from each page’s own heading or content in your layout.', 'Keep the brand suffix, but make the first part unique.'],
      effort: 's',
      acceptance: ['No two scanned pages have the same <title>.'],
    },
    check: ({ site, capture }) =>
      !!site.duplicateTitleOf?.length && {
        measured: `"${capture.facts.head.title.slice(0, 60)}" also on ${site.duplicateTitleOf.length} other page(s)`,
        expected: 'unique title',
        detail: `Same title as: ${site.duplicateTitleOf.slice(0, 5).join(', ')}`.slice(0, 1900),
      },
  },
  {
    id: 'seo.meta-description.missing',
    category: 'seo',
    severity: 'moderate',
    title: 'Meta description is missing',
    detail: 'Without a meta description, search engines pick a snippet from the page, which is often a menu or cookie notice.',
    fix: {
      summary: 'Add a meta description of 70-160 characters that summarises the page and invites the click.',
      steps: ['Write one or two sentences about what the visitor gets on this page.', 'Add it to <head>.'],
      codeHint: '<meta name="description" content="What this page offers, in one or two sentences.">',
      effort: 'xs',
      acceptance: ['The page has one <meta name="description"> with 70-160 characters.'],
    },
    check: ({ capture }) => !capture.facts.head.metaDescription && { expected: '70-160 characters' },
  },
  {
    id: 'seo.meta-description.length',
    category: 'seo',
    severity: 'minor',
    title: 'Meta description length is off',
    detail: 'The meta description is very short or long enough to be cut off in search results.',
    fix: {
      summary: 'Rewrite the meta description to 70-160 characters.',
      steps: ['Lead with the benefit, include the main keyword once, and stop before 160 characters.'],
      effort: 'xs',
      acceptance: ['The meta description is 70-160 characters long.'],
    },
    check: ({ capture }) => {
      const d = capture.facts.head.metaDescription;
      return !!d && (d.length < 50 || d.length > 170) && { measured: `${d.length} characters`, expected: '70-160 characters' };
    },
  },
  {
    id: 'seo.h1.missing',
    category: 'seo',
    severity: 'moderate',
    title: 'Page has no main heading (h1)',
    detail: "There's no visible <h1>. Screen reader users and search engines use it to understand what the page is about.",
    supersedesAxe: ['page-has-heading-one'],
    fix: {
      summary: 'Mark up the main page heading as a single visible <h1>.',
      steps: ['Find the largest heading at the top of the page.', 'Change its element to <h1> (keep the styling with a class).', 'Make sure no other element on the page is an <h1>.'],
      codeHint: '<h1 class="hero-title">What this page is about</h1>',
      effort: 'xs',
      acceptance: ['The page has exactly one visible <h1> with text.'],
      verify: "In DevTools console: `document.querySelectorAll('h1').length === 1`",
    },
    check: ({ capture }) => !capture.facts.headings.some((h) => h.level === 1 && h.visible && h.text) && { measured: '0 h1', expected: '1 h1' },
  },
  {
    id: 'seo.h1.multiple',
    category: 'seo',
    severity: 'minor',
    title: 'More than one h1',
    detail: 'Several <h1> elements compete to be the page title, which blurs the outline for assistive tech and search.',
    fix: {
      summary: 'Keep one <h1> for the page title and demote the others to <h2>.',
      steps: ['Pick the heading that names the page.', 'Change the other <h1> elements to <h2> or lower, keeping their styles via classes.'],
      effort: 'xs',
      acceptance: ['The page has exactly one <h1>.'],
    },
    check: ({ capture }) => {
      const h1 = capture.facts.headings.filter((h) => h.level === 1 && h.visible);
      return h1.length > 1 && h1.slice(1).map((h) => ({ selector: h.selector, bbox: h.bbox, measured: `${h1.length} h1 elements`, expected: '1 h1' }));
    },
  },
  {
    id: 'seo.heading.skip',
    category: 'seo',
    severity: 'minor',
    title: 'Heading levels skip',
    detail: 'Headings jump levels (for example h2 to h4). The outline becomes confusing for screen reader users who navigate by heading.',
    supersedesAxe: ['heading-order'],
    fix: {
      summary: 'Use heading levels in order without skipping, and style them with classes rather than picking levels for size.',
      steps: ['List headings in order (DevTools or a headings bookmarklet).', 'Change each skipped level to the next level down from its parent.', 'Move visual sizing into CSS classes.'],
      effort: 's',
      acceptance: ['No heading is more than one level deeper than the heading before it.'],
    },
    check: ({ capture }) => {
      const hs = capture.facts.headings.filter((h) => h.visible);
      const hits: RuleHit[] = [];
      let prev = 0;
      for (const h of hs) {
        if (prev && h.level > prev + 1) hits.push({ selector: h.selector, bbox: h.bbox, measured: `h${prev} → h${h.level}`, expected: `h${prev} → h${prev + 1}` });
        if (!prev && h.level > 2) hits.push({ selector: h.selector, bbox: h.bbox, measured: `first heading is h${h.level}`, expected: 'start at h1' });
        prev = h.level;
      }
      return hits;
    },
  },
  {
    id: 'seo.canonical.missing',
    category: 'seo',
    severity: 'minor',
    title: 'No canonical URL',
    detail: "Without a canonical link, URL variants (tracking parameters, trailing slashes) can be indexed as duplicates.",
    fix: {
      summary: 'Add a self-referencing canonical link with the absolute, preferred URL.',
      steps: ["Add <link rel=\"canonical\"> to <head> with the page's preferred absolute URL.", 'Generate it per page in your layout or SEO component.'],
      codeHint: '<link rel="canonical" href="https://example.com/page">',
      effort: 'xs',
      acceptance: ['The page has exactly one <link rel="canonical"> with an absolute URL to itself.'],
    },
    check: ({ capture }) => capture.facts.head.canonicalCount === 0 && capture.status < 400 && { expected: '1 canonical link' },
  },
  {
    id: 'seo.canonical.mismatch',
    category: 'seo',
    severity: 'moderate',
    title: 'Canonical URL points elsewhere',
    detail: 'The canonical link names a different URL, so search engines may drop this page in favour of that one.',
    fix: {
      summary: "Make the canonical point at this page's own preferred URL, unless it really is a duplicate.",
      steps: ['Check whether this page is meant to be a duplicate of the canonical target.', 'If not, change the canonical to this page’s absolute URL.', 'Use one canonical tag only.'],
      effort: 'xs',
      acceptance: ['The canonical URL matches the page URL (ignoring a trailing slash), or the page is intentionally a duplicate.'],
    },
    check: ({ capture, url }) => {
      const c = capture.facts.head.canonical;
      if (capture.facts.head.canonicalCount > 1) return { measured: `${capture.facts.head.canonicalCount} canonical tags`, expected: '1 canonical tag' };
      return !!c && !sameDoc(c, url) && { measured: c.slice(0, 180), expected: url.slice(0, 180) };
    },
  },
  {
    id: 'seo.robots.noindex',
    category: 'seo',
    severity: 'serious',
    title: 'Page is set to noindex',
    detail: 'A robots directive tells search engines not to index this page, so it will not appear in results.',
    fix: {
      summary: 'Remove noindex from the robots meta tag and X-Robots-Tag header if the page should be found in search.',
      steps: ['Search the layout for `noindex` in meta tags.', 'Check the server/CDN config for an `X-Robots-Tag` header.', 'Remove it for public pages (keep it on staging only).'],
      effort: 'xs',
      acceptance: ['Neither the robots meta tag nor the X-Robots-Tag header contains noindex.'],
    },
    check: ({ capture }) => {
      const meta = capture.facts.head.metaRobots ?? '';
      const header = capture.headers['x-robots-tag'] ?? '';
      return (/noindex/i.test(meta) || /noindex/i.test(header)) && { measured: (meta || header).slice(0, 100), expected: 'index' };
    },
  },
  {
    id: 'seo.viewport.missing',
    category: 'seo',
    severity: 'serious',
    supersedesLighthouse: ['viewport', 'viewport-insight'],
    title: 'No mobile viewport tag',
    detail: 'Without a viewport meta tag, phones render the page at desktop width and shrink it. Search engines treat it as not mobile-friendly.',
    fix: {
      summary: 'Add the standard responsive viewport meta tag.',
      steps: ['Add the tag to <head> on every page.', 'Do not disable zoom (no user-scalable=no or maximum-scale=1).'],
      codeHint: '<meta name="viewport" content="width=device-width, initial-scale=1">',
      effort: 'xs',
      acceptance: ['The page has <meta name="viewport" content="width=device-width, initial-scale=1">.', 'Zoom is not disabled.'],
    },
    check: ({ capture }) => {
      const v = capture.facts.head.viewport;
      if (v === null) return { expected: 'width=device-width, initial-scale=1' };
      if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(v))
        return { measured: v.slice(0, 120), expected: 'zoom allowed', detail: 'The viewport tag disables zoom, which blocks people who need to enlarge text.', severity: 'serious' };
      return null;
    },
  },
  {
    id: 'seo.social.missing',
    category: 'seo',
    severity: 'minor',
    title: 'Social sharing tags are incomplete',
    detail: 'Open Graph and Twitter tags control the preview card when the page is shared. Missing tags give a bare link or a random image.',
    fix: {
      summary: 'Add og:title, og:description, og:image (1200x630) and twitter:card.',
      steps: ['Create a 1200x630 share image.', 'Add the Open Graph tags and twitter:card to <head>, per page.'],
      codeHint:
        '<meta property="og:title" content="Page title">\n<meta property="og:description" content="One-sentence summary.">\n<meta property="og:image" content="https://example.com/og.png">\n<meta name="twitter:card" content="summary_large_image">',
      effort: 's',
      acceptance: ['og:title, og:description and og:image are present with absolute image URL.', 'twitter:card is present.'],
    },
    check: ({ capture }) => {
      const { og, twitter } = capture.facts.head;
      const missing = [!og.title && 'og:title', !og.description && 'og:description', !og.image && 'og:image', !twitter.card && 'twitter:card'].filter(Boolean);
      return missing.length > 0 && { measured: `missing: ${missing.join(', ')}`, expected: 'all present' };
    },
  },
  {
    id: 'seo.structured-data.missing',
    category: 'seo',
    severity: 'minor',
    title: 'No structured data (JSON-LD)',
    detail: 'Structured data helps search engines show rich results (organisation, articles, products, breadcrumbs).',
    fix: {
      summary: 'Add a JSON-LD block describing the page (Organization or WebSite on the home page, the right type elsewhere).',
      steps: ['Pick the schema.org type that matches the page.', 'Add a <script type="application/ld+json"> block.', 'Validate it with the Rich Results Test.'],
      codeHint: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Brand","url":"https://example.com/"}</script>',
      effort: 's',
      acceptance: ['The page has at least one valid JSON-LD block with an @type.'],
    },
    check: ({ capture, primary }) => primary && capture.facts.head.jsonLd.length === 0 && { expected: '1+ JSON-LD block' },
  },
  {
    id: 'seo.structured-data.invalid',
    category: 'seo',
    severity: 'moderate',
    title: "Structured data can't be parsed",
    detail: 'A JSON-LD block contains invalid JSON, so search engines ignore it.',
    fix: {
      summary: 'Fix the JSON syntax in the JSON-LD block.',
      steps: ['Copy the block into a JSON validator.', 'Fix trailing commas, unescaped quotes or HTML entities.', 'Generate it with JSON.stringify where possible.'],
      effort: 'xs',
      acceptance: ['Every <script type="application/ld+json"> block parses as JSON.'],
    },
    check: ({ capture }) =>
      capture.facts.head.jsonLd.filter((j) => !j.valid).map((j) => ({ measured: j.error ?? 'invalid JSON', expected: 'valid JSON' })),
  },
  {
    id: 'seo.link.generic',
    category: 'seo',
    severity: 'minor',
    title: 'Links with generic text',
    detail: 'Link text like "click here" or "read more" says nothing about the destination, for search engines or for screen reader users scanning links.',
    fix: {
      summary: 'Rewrite link text to describe where the link goes.',
      steps: ['Replace "click here"/"read more" with the destination, e.g. "Read the pricing guide".', 'If the design needs short text, add the rest in visually hidden text.'],
      codeHint: '<a href="/pricing">See pricing<span class="visually-hidden"> for teams</span></a>',
      effort: 's',
      acceptance: ['No link’s accessible name is only a generic phrase such as "click here", "here", "read more" or "learn more".'],
    },
    check: ({ capture }) =>
      capture.facts.links
        .filter((l) => l.visible && GENERIC_LINK.test(l.accessibleName.trim()))
        .map((l) => ({ selector: l.selector, snippet: l.snippet, bbox: l.bbox, measured: `"${l.accessibleName}"`, expected: 'descriptive text' })),
  },
  {
    id: 'seo.links.broken',
    category: 'seo',
    severity: 'moderate',
    title: 'Broken internal links',
    detail: 'Some internal links lead to error pages. Visitors hit dead ends and crawlers waste budget.',
    fix: {
      summary: 'Fix or remove links that return 4xx/5xx, or redirect the old URLs.',
      steps: ['Update each link to the correct URL.', 'If the page moved, add a 301 redirect from the old URL.'],
      effort: 's',
      acceptance: ['Every internal link on the page returns 200 (or a single redirect to 200).'],
    },
    check: ({ site }) =>
      site.linkChecks.filter((l) => l.status >= 400 || l.status === 0).map((l) => ({ selector: l.selector, measured: l.status ? `HTTP ${l.status}` : 'no response', expected: 'HTTP 200', detail: `Broken link to ${l.url.slice(0, 300)}` })),
  },
  {
    id: 'seo.robots-txt.missing',
    category: 'seo',
    severity: 'minor',
    title: 'No robots.txt',
    detail: "There's no robots.txt at the site root. Crawlers fall back to defaults and can't find your sitemap from it.",
    fix: {
      summary: 'Add /robots.txt that allows crawling and links the sitemap.',
      steps: ['Create robots.txt at the site root.', 'Reference the sitemap URL in it.'],
      codeHint: 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml',
      effort: 'xs',
      acceptance: ['GET /robots.txt returns 200 with text/plain and a Sitemap line.'],
    },
    check: ({ site, primary }) => primary && !!site.robots && site.robots.status >= 400 && { measured: `HTTP ${site.robots.status}`, expected: 'HTTP 200' },
  },
  {
    id: 'seo.sitemap.missing',
    category: 'seo',
    severity: 'minor',
    title: 'No XML sitemap found',
    detail: 'No sitemap was found at /sitemap.xml or in robots.txt. A sitemap helps search engines discover every page.',
    fix: {
      summary: 'Publish /sitemap.xml listing your public pages and reference it in robots.txt.',
      steps: ['Generate a sitemap (most frameworks have a plugin).', 'Add a `Sitemap:` line to robots.txt.', 'Submit it in Google Search Console.'],
      effort: 's',
      acceptance: ['/sitemap.xml (or the URL in robots.txt) returns valid XML listing the public pages.'],
    },
    check: ({ site, primary }) => primary && !!site.sitemap && !site.sitemap.found && { expected: 'sitemap.xml' },
  },
  {
    id: 'seo.hreflang.invalid',
    category: 'seo',
    severity: 'minor',
    title: 'hreflang tags have problems',
    detail: 'Alternate-language links are present but have invalid language codes or no self-reference, so search engines may ignore them.',
    fix: {
      summary: 'Use valid ISO language(-region) codes and include a self-referencing hreflang.',
      steps: ['Check each code is like `en`, `en-GB` or `x-default`.', 'Add an hreflang entry for the page itself.', 'Make the alternates link back to each other.'],
      effort: 's',
      acceptance: ['Every hreflang value is a valid code or x-default.', 'The page lists itself among its alternates.'],
    },
    check: ({ capture, url }) => {
      const list = capture.facts.head.hreflang;
      if (!list.length) return null;
      const bad = list.filter((h) => !/^([a-z]{2,3}(-[A-Za-z]{2,4})?(-[A-Za-z]{2})?|x-default)$/.test(h.lang));
      const self = list.some((h) => sameDoc(h.href, url));
      if (!bad.length && self) return null;
      return {
        measured: [bad.length ? `invalid codes: ${bad.map((b) => b.lang).join(', ')}` : '', self ? '' : 'no self-reference'].filter(Boolean).join('; ').slice(0, 190),
        expected: 'valid codes incl. self-reference',
      };
    },
  },
];
