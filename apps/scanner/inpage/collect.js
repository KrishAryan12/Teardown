/*
 * Runs inside the scanned page (via page.evaluate) or, in the no-browser fallback, in Node against
 * a linkedom document. It must stay self-contained: no imports, no closures over outer scope.
 * Every layout API is optional, because the fallback DOM has no layout.
 *
 * Returns { facts, brand } — plain JSON.
 */
(function collect(opts) {
  'use strict';
  opts = opts || {};
  var MAX_ELEMENTS = opts.maxElements || 3000;
  var doc = document;
  var win = typeof window !== 'undefined' ? window : {};
  var hasLayout = typeof doc.documentElement.getBoundingClientRect === 'function' && typeof getComputedStyle === 'function' && !opts.noLayout;
  var vw = hasLayout ? win.innerWidth : 1440;
  var vh = hasLayout ? win.innerHeight : 900;
  var sx = hasLayout ? win.scrollX || 0 : 0;
  var sy = hasLayout ? win.scrollY || 0 : 0;

  function cs(el) {
    if (!hasLayout) return null;
    try {
      return getComputedStyle(el);
    } catch (e) {
      return null;
    }
  }

  function txt(s, max) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    max = max || 200;
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c;
    });
  }

  /* Short, mostly-unique selector: id when unique, else tag:nth-of-type chain (max 5 levels). */
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    var cur = el;
    for (var depth = 0; cur && cur.nodeType === 1 && depth < 5; depth++) {
      var tag = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]{0,60}$/.test(cur.id)) {
        var byId = doc.querySelectorAll('#' + cssEscape(cur.id));
        if (byId.length === 1) {
          parts.unshift('#' + cur.id);
          break;
        }
      }
      if (tag === 'html' || tag === 'body') {
        parts.unshift(tag);
        break;
      }
      var part = tag;
      var cls = (typeof cur.className === 'string' ? cur.className : '')
        .split(/\s+/)
        .filter(function (c) {
          return /^[A-Za-z][\w-]{1,40}$/.test(c) && !/^(css|sc|jsx|svelte|astro|tw)-/.test(c);
        })
        .slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      var parent = cur.parentElement;
      if (parent) {
        var same = 0;
        var idx = 0;
        for (var i = 0; i < parent.children.length; i++) {
          var sib = parent.children[i];
          if (sib.tagName === cur.tagName) {
            same++;
            if (sib === cur) idx = same;
          }
        }
        if (same > 1) part += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ').slice(0, 300);
  }

  function snippet(el) {
    if (!el || !el.outerHTML) return '';
    var clone = el.cloneNode(true);
    if (clone.querySelectorAll) {
      var scripts = clone.querySelectorAll('script,style');
      for (var i = 0; i < scripts.length; i++) scripts[i].textContent = '';
    }
    var h = clone.outerHTML || '';
    var open = h.indexOf('>');
    // Prefer the opening tag plus a little content.
    return txt(h.length > 300 && open > 0 && open < 290 ? h.slice(0, Math.min(h.length, 280)) : h, 290);
  }

  function rectOf(el) {
    if (!hasLayout || !el.getBoundingClientRect) return null;
    var st = cs(el);
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return null;
    var r = el.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return null;
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function isVisible(el, st) {
    if (!hasLayout) return true;
    st = st || cs(el);
    if (!st) return false;
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse' || parseFloat(st.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function abs(u) {
    try {
      return new URL(u, doc.baseURI || location.href).href;
    } catch (e) {
      return u || null;
    }
  }

  var pageUrl = (function () {
    try {
      return location.href;
    } catch (e) {
      return opts.url || '';
    }
  })();
  var host = (function () {
    try {
      return new URL(pageUrl).hostname;
    } catch (e) {
      return '';
    }
  })();

  /* ------------------------------ head facts ------------------------------ */

  var metas = {};
  var metaEls = doc.querySelectorAll('meta');
  for (var mi = 0; mi < metaEls.length; mi++) {
    var m = metaEls[mi];
    var key = (m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '').toLowerCase();
    if (key && !(key in metas)) metas[key] = txt(m.getAttribute('content') || '', 400);
    if (m.getAttribute('charset')) metas.charset = m.getAttribute('charset');
  }

  var jsonLd = [];
  var ldEls = doc.querySelectorAll('script[type="application/ld+json"]');
  for (var li = 0; li < ldEls.length && li < 20; li++) {
    var raw = ldEls[li].textContent || '';
    try {
      var parsed = JSON.parse(raw);
      var types = [];
      var collectTypes = function (o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(collectTypes);
        if (o['@type']) types = types.concat(o['@type']);
        if (o['@graph']) collectTypes(o['@graph']);
      };
      collectTypes(parsed);
      jsonLd.push({ valid: true, types: types.map(String).slice(0, 10) });
    } catch (e) {
      jsonLd.push({ valid: false, types: [], error: txt(String(e && e.message), 120) });
    }
  }

  var hreflang = [];
  var altEls = doc.querySelectorAll('link[rel="alternate"][hreflang]');
  for (var ai = 0; ai < altEls.length && ai < 100; ai++) {
    hreflang.push({ lang: altEls[ai].getAttribute('hreflang') || '', href: abs(altEls[ai].getAttribute('href') || '') });
  }

  var canonicalEls = doc.querySelectorAll('link[rel="canonical"]');

  var head = {
    title: txt(doc.title, 300),
    titleCount: doc.querySelectorAll('head title').length,
    lang: doc.documentElement.getAttribute('lang'),
    metaDescription: metas.description !== undefined ? metas.description : null,
    metaRobots: metas.robots || null,
    viewport: metas.viewport !== undefined ? metas.viewport : null,
    charset: metas.charset || metas['content-type'] || null,
    generator: metas.generator || null,
    themeColor: metas['theme-color'] || null,
    canonical: canonicalEls.length ? abs(canonicalEls[0].getAttribute('href')) : null,
    canonicalCount: canonicalEls.length,
    og: {
      title: metas['og:title'] || null,
      description: metas['og:description'] || null,
      image: metas['og:image'] ? abs(metas['og:image']) : null,
      type: metas['og:type'] || null,
      url: metas['og:url'] || null,
    },
    twitter: { card: metas['twitter:card'] || null, title: metas['twitter:title'] || null, image: metas['twitter:image'] || null },
    jsonLd: jsonLd,
    hreflang: hreflang,
    favicon: (function () {
      var f = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      return f ? abs(f.getAttribute('href')) : null;
    })(),
  };

  /* -------------------------------- headings ------------------------------ */

  var headings = [];
  var hEls = doc.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var hi = 0; hi < hEls.length && hi < 200; hi++) {
    var hEl = hEls[hi];
    headings.push({
      level: Number(hEl.tagName[1]),
      text: txt(hEl.textContent, 120),
      selector: selectorOf(hEl),
      visible: isVisible(hEl),
      bbox: rectOf(hEl),
    });
  }

  /* --------------------------------- images ------------------------------- */

  var images = [];
  var imgEls = doc.querySelectorAll('img');
  for (var ii = 0; ii < imgEls.length && ii < 300; ii++) {
    var img = imgEls[ii];
    var ist = cs(img);
    var rect = rectOf(img);
    var src = img.currentSrc || img.getAttribute('src') || '';
    var widthAttr = img.getAttribute('width');
    var heightAttr = img.getAttribute('height');
    var aspect = ist ? ist.aspectRatio : '';
    images.push({
      selector: selectorOf(img),
      snippet: snippet(img),
      src: txt(abs(src) || '', 400),
      alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
      role: img.getAttribute('role'),
      ariaHidden: img.getAttribute('aria-hidden') === 'true',
      ariaLabel: img.getAttribute('aria-label') || img.getAttribute('aria-labelledby') || null,
      inLink: !!(img.closest && img.closest('a')),
      hasDimensions: !!(widthAttr && heightAttr) || (!!aspect && aspect !== 'auto'),
      naturalW: img.naturalWidth || 0,
      naturalH: img.naturalHeight || 0,
      renderedW: rect ? rect.w : 0,
      renderedH: rect ? rect.h : 0,
      loading: img.getAttribute('loading'),
      bbox: rect,
      aboveFold: !!rect && rect.y < vh,
      visible: !!rect,
    });
  }

  /* ---------------------------------- links ------------------------------- */

  var links = [];
  var aEls = doc.querySelectorAll('a[href]');
  for (var ki = 0; ki < aEls.length && ki < 600; ki++) {
    var a = aEls[ki];
    var hrefRaw = a.getAttribute('href') || '';
    var href = abs(hrefRaw);
    var internal = false;
    var protocol = '';
    try {
      var hu = new URL(href);
      internal = hu.hostname === host;
      protocol = hu.protocol;
    } catch (e) {
      /* ignore */
    }
    var label = txt(a.textContent, 120);
    var imgAlt = '';
    var innerImgs = a.querySelectorAll('img[alt]');
    for (var q = 0; q < innerImgs.length; q++) imgAlt += ' ' + (innerImgs[q].getAttribute('alt') || '');
    links.push({
      href: txt(href || '', 500),
      rawHref: txt(hrefRaw, 200),
      protocol: protocol,
      text: label,
      accessibleName: txt(a.getAttribute('aria-label') || label || imgAlt || a.getAttribute('title') || '', 120),
      internal: internal,
      rel: a.getAttribute('rel'),
      target: a.getAttribute('target'),
      selector: selectorOf(a),
      snippet: snippet(a),
      visible: isVisible(a),
      bbox: rectOf(a),
    });
  }

  /* ---------------------------------- forms ------------------------------- */

  var unlabeled = [];
  var controls = doc.querySelectorAll('input, select, textarea');
  for (var ci = 0; ci < controls.length && ci < 200; ci++) {
    var c = controls[ci];
    var type = (c.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].indexOf(type) >= 0) continue;
    if (!isVisible(c)) continue;
    var labelled =
      (c.id && doc.querySelector('label[for="' + cssEscape(c.id) + '"]')) ||
      (c.closest && c.closest('label')) ||
      c.getAttribute('aria-label') ||
      c.getAttribute('aria-labelledby') ||
      c.getAttribute('title');
    if (!labelled) {
      unlabeled.push({ selector: selectorOf(c), snippet: snippet(c), placeholder: c.getAttribute('placeholder'), bbox: rectOf(c) });
    }
  }

  /* -------------------------------- landmarks ----------------------------- */

  var landmarks = {
    main: doc.querySelectorAll('main, [role="main"]').length,
    nav: doc.querySelectorAll('nav, [role="navigation"]').length,
    header: doc.querySelectorAll('header, [role="banner"]').length,
    footer: doc.querySelectorAll('footer, [role="contentinfo"]').length,
  };

  var skipLink = (function () {
    var focusables = doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
    // Cookie banners often come first in the DOM, so look a little further than the very first link.
    for (var i = 0; i < focusables.length && i < 10; i++) {
      var el = focusables[i];
      var h = el.getAttribute('href') || '';
      if (h.charAt(0) === '#' && h.length > 1) {
        var id = h.slice(1);
        var targetExists = doc.getElementById(id) || doc.querySelector('[name="' + cssEscape(id) + '"]');
        if (targetExists || /skip|jump to|main content/i.test(el.textContent || '')) return { found: true, selector: selectorOf(el) };
      }
    }
    return { found: false };
  })();

  /* ---------------------------- focus visibility ------------------------- */

  var focus = (function () {
    if (!hasLayout || !opts.checkFocus) return { tested: 0, invisible: [] };
    var candidates = doc.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
    var tested = 0;
    var invisible = [];
    var prev = doc.activeElement;
    for (var i = 0; i < candidates.length && tested < 8; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.top + sy > vh * 3) continue;
      tested++;
      var before = cs(el);
      var b = {
        o: before.outlineStyle + before.outlineWidth + before.outlineColor,
        s: before.boxShadow,
        bd: before.borderColor + before.borderWidth,
        bg: before.backgroundColor,
        c: before.color,
        td: before.textDecorationLine,
      };
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        continue;
      }
      var after = cs(el);
      var outlineVisible = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0;
      var changed =
        outlineVisible ||
        after.boxShadow !== b.s ||
        after.borderColor + after.borderWidth !== b.bd ||
        after.backgroundColor !== b.bg ||
        after.color !== b.c ||
        after.textDecorationLine !== b.td;
      if (!changed) invisible.push({ selector: selectorOf(el), snippet: snippet(el), bbox: rectOf(el) });
      try {
        el.blur();
      } catch (e) {
        /* ignore */
      }
    }
    try {
      if (prev && prev.focus) prev.focus({ preventScroll: true });
    } catch (e) {
      /* ignore */
    }
    return { tested: tested, invisible: invisible };
  })();

  /* --------------------------- text, line length -------------------------- */

  var canvas = hasLayout && doc.createElement ? doc.createElement('canvas') : null;
  var ctx2d = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var smallText = { chars: 0, totalChars: 0, samples: [] };
  var longLines = [];
  var textEls = doc.querySelectorAll('p, li, dd, td, blockquote, figcaption, label, span, a');
  var visited = 0;
  for (var ti = 0; ti < textEls.length && visited < 1500; ti++) {
    var t = textEls[ti];
    var own = '';
    for (var n = t.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, ' ').trim();
    if (own.length < 20) continue;
    var st = cs(t);
    if (!st || !isVisible(t, st)) continue;
    visited++;
    var fs = parseFloat(st.fontSize);
    smallText.totalChars += own.length;
    if (fs < 16 && t.closest && !t.closest('footer, nav, small, sup, sub, figcaption, [role="contentinfo"], label')) {
      smallText.chars += own.length;
      if (smallText.samples.length < 10) smallText.samples.push({ selector: selectorOf(t), px: fs, snippet: snippet(t), bbox: rectOf(t) });
    }
    if (/^(P|LI|DD|BLOCKQUOTE)$/.test(t.tagName) && ctx2d && own.length > 120) {
      ctx2d.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
      var avg = ctx2d.measureText('The quick brown fox jumps over the lazy dog, 0123456789.').width / 56;
      var width = t.getBoundingClientRect().width - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
      var cpl = avg > 0 ? Math.round(width / avg) : 0;
      if (cpl > 90 && longLines.length < 10) longLines.push({ selector: selectorOf(t), cpl: cpl, snippet: snippet(t), bbox: rectOf(t) });
    }
  }

  /* --------------------------- primary action ---------------------------- */

  function transparent(c) {
    return !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  }

  var primaryAction = (function () {
    if (!hasLayout) return { checked: false, found: false };
    var cands = doc.querySelectorAll('a[href], button, input[type="submit"], [role="button"]');
    for (var i = 0; i < cands.length && i < 400; i++) {
      var el = cands[i];
      var st = cs(el);
      if (!isVisible(el, st)) continue;
      var r = el.getBoundingClientRect();
      if (r.top + sy > vh || r.width < 60 || r.height < 28 || r.right <= 0 || r.left >= vw || r.bottom <= 0) continue;
      var styled = !transparent(st.backgroundColor) || (parseFloat(st.borderTopWidth) >= 1 && st.borderTopStyle !== 'none' && parseFloat(st.paddingLeft) >= 8);
      if (styled && txt(el.textContent || el.value || '', 60).length > 1) return { checked: true, found: true, selector: selectorOf(el), text: txt(el.textContent || el.value, 60) };
    }
    return { checked: true, found: false };
  })();

  /* -------------------------------- overlays ------------------------------ */

  var overlays = [];
  if (hasLayout) {
    var all = doc.body ? doc.body.querySelectorAll('*') : [];
    for (var oi = 0; oi < all.length && oi < 4000; oi++) {
      var el = all[oi];
      var st = cs(el);
      if (!st || (st.position !== 'fixed' && st.position !== 'sticky')) continue;
      if (!isVisible(el, st)) continue;
      var r = el.getBoundingClientRect();
      var w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      var h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      var cover = (w * h) / (vw * vh);
      if (cover > 0.4 && !(el.tagName === 'HEADER' && r.height < vh * 0.3)) {
        overlays.push({ selector: selectorOf(el), coverage: Math.round(cover * 100) / 100, snippet: snippet(el), bbox: rectOf(el) });
      }
    }
  }

  /* --------------------------------- media -------------------------------- */

  var autoplay = [];
  var media = doc.querySelectorAll('video, audio');
  for (var vi = 0; vi < media.length && vi < 50; vi++) {
    var mel = media[vi];
    var audible = !mel.muted && !mel.hasAttribute('muted') && (mel.volume === undefined || mel.volume > 0);
    var playing = mel.hasAttribute('autoplay') || (mel.paused === false && hasLayout);
    if (playing && audible) autoplay.push({ selector: selectorOf(mel), snippet: snippet(mel), bbox: rectOf(mel) });
  }

  /* -------------------------- scripts and styles -------------------------- */

  var renderBlocking = [];
  var headEl = doc.head;
  if (headEl) {
    var sync = headEl.querySelectorAll('script[src]:not([async]):not([defer]):not([type="module"])');
    for (var si = 0; si < sync.length && si < 30; si++) renderBlocking.push({ kind: 'script', url: abs(sync[si].getAttribute('src')) });
    var sheets = headEl.querySelectorAll('link[rel="stylesheet"]');
    for (var sj = 0; sj < sheets.length && sj < 30; sj++) {
      var media2 = sheets[sj].getAttribute('media');
      if (!media2 || media2 === 'all' || media2 === 'screen') renderBlocking.push({ kind: 'stylesheet', url: abs(sheets[sj].getAttribute('href')) });
    }
  }

  var mixed = [];
  if (pageUrl.indexOf('https:') === 0) {
    var res = doc.querySelectorAll('img[src], script[src], link[href][rel="stylesheet"], iframe[src], video[src], audio[src], source[src]');
    for (var ri = 0; ri < res.length && mixed.length < 20; ri++) {
      var u = res[ri].getAttribute('src') || res[ri].getAttribute('href') || '';
      if (/^http:\/\//i.test(u)) mixed.push({ url: txt(u, 300), selector: selectorOf(res[ri]) });
    }
  }

  /* --------------------------------- stack -------------------------------- */

  var stackHints = [];
  function hint(name, conf) {
    stackHints.push({ name: name, confidence: conf });
  }
  var html = doc.documentElement.outerHTML.slice(0, 400000);
  if (win.__NEXT_DATA__ || doc.getElementById('__next') || /\/_next\/static\//.test(html)) hint('Next.js', 'high');
  if (win.__NUXT__ || doc.getElementById('__nuxt') || /\/_nuxt\//.test(html)) hint('Nuxt', 'high');
  if (/\/wp-content\/|\/wp-includes\//.test(html)) hint('WordPress', 'high');
  if (win.Shopify || /cdn\.shopify\.com/.test(html)) hint('Shopify', 'high');
  if (doc.querySelector('[data-wf-page], [data-wf-site]')) hint('Webflow', 'high');
  if (/static1\.squarespace\.com|squarespace-cdn/.test(html)) hint('Squarespace', 'high');
  if (/static\.wixstatic\.com|wix\.com/.test(html) && /wix/i.test(head.generator || html.slice(0, 5000))) hint('Wix', 'medium');
  if (win.___gatsby || doc.getElementById('___gatsby')) hint('Gatsby', 'high');
  if (doc.querySelector('astro-island, [data-astro-cid], [class*="astro-"]')) hint('Astro', 'high');
  if (doc.querySelector('[ng-version]')) hint('Angular', 'high');
  if (doc.querySelector('[data-v-app], [data-server-rendered]') || win.__VUE__) hint('Vue', 'medium');
  if (doc.querySelector('[class*="svelte-"]') || win.__svelte) hint('Svelte', 'medium');
  if (doc.querySelector('[data-reactroot]') || win.__REACT_DEVTOOLS_GLOBAL_HOOK__ || /react-dom|data-reactid/.test(html)) hint('React', 'medium');
  if (win.jQuery) hint('jQuery', 'high');
  if (/\b(?:sm|md|lg|xl):[a-z-]+\b/.test(html) && /\b(?:px|py|mx|my)-\d\b/.test(html)) hint('Tailwind CSS', 'medium');
  if (/bootstrap(\.min)?\.(css|js)/.test(html)) hint('Bootstrap', 'medium');
  if (/googletagmanager\.com|google-analytics\.com/.test(html)) hint('Google Analytics / Tag Manager', 'high');

  /* ---------------------------------- brand ------------------------------- */

  var brand = null;
  if (opts.brand && hasLayout) brand = collectBrand();

  function collectBrand() {
    var colorMap = {};
    var fontMap = {};
    var sizeMap = {};
    var spaceMap = {};
    var radiusMap = {};
    var shadowMap = {};
    var contrastMap = {};
    var buttonMap = {};
    var contrastUnknown = 0;
    var sampled = 0;

    function rgba(str) {
      if (!str) return null;
      var m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      var p = m[1].split(/[\s,/]+/).filter(Boolean);
      var a = p[3] === undefined ? 1 : p[3].indexOf('%') > 0 ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return { r: +p[0], g: +p[1], b: +p[2], a: isNaN(a) ? 1 : a };
    }
    function hex(c) {
      function h(n) {
        n = Math.max(0, Math.min(255, Math.round(n)));
        return (n < 16 ? '0' : '') + n.toString(16);
      }
      return '#' + h(c.r) + h(c.g) + h(c.b);
    }
    function blend(top, bottom) {
      var a = top.a;
      return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
    }
    function addColor(str, kind, weight, interactive) {
      var c = rgba(str);
      if (!c || c.a < 0.05 || !(weight > 0)) return;
      var k = kind + '|' + hex(c) + '|' + (interactive ? 1 : 0);
      var e = colorMap[k] || (colorMap[k] = { kind: kind, hex: hex(c), interactive: !!interactive, weight: 0, count: 0 });
      e.weight += weight;
      e.count++;
    }
    function bump(map, key, extra) {
      var e = map[key] || (map[key] = { count: 0 });
      e.count++;
      if (extra) extra(e);
    }

    /* Effective background: walk up, compositing translucent layers; image/gradient = unknown. */
    var bgCache = new Map();
    function effectiveBg(el) {
      var layers = [];
      var cur = el;
      while (cur && cur.nodeType === 1) {
        if (bgCache.has(cur)) {
          var cached = bgCache.get(cur);
          if (cached === 'unknown') return 'unknown';
          var base = cached;
          for (var i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
          return base;
        }
        var st = cs(cur);
        if (st) {
          if (st.backgroundImage && st.backgroundImage !== 'none') return 'unknown';
          var c = rgba(st.backgroundColor);
          if (c && c.a > 0) {
            if (c.a >= 1) {
              var res = c;
              for (var j = layers.length - 1; j >= 0; j--) res = blend(layers[j], res);
              return res;
            }
            layers.push(c);
          }
        }
        cur = cur.parentElement;
      }
      var res2 = { r: 255, g: 255, b: 255, a: 1 };
      for (var k = layers.length - 1; k >= 0; k--) res2 = blend(layers[k], res2);
      return res2;
    }

    function lum(c) {
      function ch(v) {
        v = v / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    }
    function ratio(a, b) {
      var l1 = lum(a);
      var l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    var els = doc.body ? doc.body.querySelectorAll('*') : [];
    var docArea = Math.max(1, vw * Math.max(vh, doc.documentElement.scrollHeight || vh));
    var rootSt = cs(doc.documentElement);
    var bodySt = doc.body ? cs(doc.body) : null;
    addColor(rootSt && rootSt.backgroundColor, 'bg', docArea / 1000, false);
    if (bodySt) addColor(bodySt.backgroundColor, 'bg', docArea / 1000, false);

    for (var i = 0; i < els.length && sampled < MAX_ELEMENTS; i++) {
      var el = els[i];
      var tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'head') continue;
      var st = cs(el);
      if (!st || !isVisible(el, st)) continue;
      sampled++;
      var r = el.getBoundingClientRect();
      var area = (r.width * r.height) / 1000;
      var interactive = /^(a|button|input|select|textarea|summary)$/.test(tag) || el.getAttribute('role') === 'button';

      addColor(st.backgroundColor, 'bg', area, interactive);
      if (parseFloat(st.borderTopWidth) > 0 && st.borderTopStyle !== 'none') addColor(st.borderTopColor, 'border', (r.width + r.height) / 100, interactive);
      if (tag === 'svg' || el.closest('svg')) {
        if (st.fill && st.fill !== 'none') addColor(st.fill, 'svg', Math.max(area, 0.5), interactive);
        if (st.stroke && st.stroke !== 'none') addColor(st.stroke, 'svg', Math.max(area / 4, 0.2), interactive);
      }

      ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap'].forEach(function (p) {
        var v = parseFloat(st[p]);
        if (v > 0 && v <= 256) bump(spaceMap, String(Math.round(v * 2) / 2));
      });
      var rad = parseFloat(st.borderTopLeftRadius);
      if (rad > 0) bump(radiusMap, String(rad >= 999 ? 9999 : Math.round(rad)));
      if (st.boxShadow && st.boxShadow !== 'none') bump(shadowMap, st.boxShadow.slice(0, 200));

      // Own text
      var own = '';
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.textContent;
      own = own.replace(/\s+/g, ' ').trim();
      if (own.length > 0) {
        var chars = own.length;
        var fsz = parseFloat(st.fontSize);
        var fw = parseInt(st.fontWeight, 10) || 400;
        addColor(st.color, 'text', chars, interactive);
        var fam = st.fontFamily;
        var role = /^h[1-3]$/.test(tag) ? 'heading' : /^(code|pre|kbd|samp)$/.test(tag) || el.closest('pre,code') ? 'mono' : /^(button|input|select|label|nav)$/.test(tag) || el.closest('nav,button') ? 'ui' : 'body';
        bump(fontMap, fam + '|' + fw, function (e) {
          e.family = fam;
          e.weight = fw;
          e.chars = (e.chars || 0) + chars;
          e.roles = e.roles || {};
          e.roles[role] = (e.roles[role] || 0) + chars;
        });
        bump(sizeMap, String(Math.round(fsz * 10) / 10), function (e) {
          e.tags = e.tags || {};
          e.tags[tag] = (e.tags[tag] || 0) + 1;
        });

        var fg = rgba(st.color);
        if (fg && fg.a > 0) {
          var bg = effectiveBg(el);
          if (bg === 'unknown') contrastUnknown++;
          else {
            var fgFlat = fg.a < 1 ? blend(fg, bg) : fg;
            var large = fsz >= 24 || (fsz >= 18.66 && fw >= 700);
            var key = hex(fgFlat) + '|' + hex(bg) + '|' + (large ? 1 : 0);
            var rt = Math.round(ratio(fgFlat, bg) * 100) / 100;
            bump(contrastMap, key, function (e) {
              e.fg = hex(fgFlat);
              e.bg = hex(bg);
              e.large = large;
              e.ratio = rt;
              e.chars = (e.chars || 0) + chars;
              if (!e.selector) {
                e.selector = selectorOf(el);
                e.bbox = rectOf(el);
                e.snippet = snippet(el);
              }
            });
          }
        }
      }

      // Button-like elements, clustered by visual signature.
      if (interactive && (tag === 'button' || tag === 'a' || tag === 'input') && !transparent(st.backgroundColor) && r.height >= 24 && r.width >= 40) {
        var sig = [rgba(st.backgroundColor) ? hex(rgba(st.backgroundColor)) : '', rgba(st.color) ? hex(rgba(st.color)) : '', Math.round(rad || 0), Math.round(parseFloat(st.paddingTop)), Math.round(parseFloat(st.paddingLeft)), Math.round(parseFloat(st.fontSize)), st.fontWeight, st.borderTopWidth].join('|');
        bump(buttonMap, sig, function (e) {
          if (!e.selector) e.selector = selectorOf(el);
          e.text = e.text || txt(own || el.value || '', 40);
        });
      }
    }

    // :root custom properties (same-origin stylesheets only; cross-origin rules are unreadable).
    var cssVars = {};
    var varNames = [];
    try {
      for (var s = 0; s < doc.styleSheets.length && varNames.length < 400; s++) {
        var rules;
        try {
          rules = doc.styleSheets[s].cssRules;
        } catch (e) {
          continue;
        }
        for (var ri = 0; rules && ri < rules.length && varNames.length < 400; ri++) {
          var rule = rules[ri];
          if (rule.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) {
            for (var pi = 0; pi < rule.style.length; pi++) {
              var name = rule.style[pi];
              if (name.indexOf('--') === 0 && varNames.indexOf(name) < 0) varNames.push(name);
            }
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    var rootComputed = cs(doc.documentElement);
    varNames.forEach(function (nm) {
      var v = (rootComputed.getPropertyValue(nm) || '').trim();
      if (v && v.length <= 200) cssVars[nm] = v;
    });

    // Font sources.
    var fontFaces = [];
    try {
      for (var s2 = 0; s2 < doc.styleSheets.length; s2++) {
        var rules2;
        try {
          rules2 = doc.styleSheets[s2].cssRules;
        } catch (e) {
          continue;
        }
        for (var r2 = 0; rules2 && r2 < rules2.length && fontFaces.length < 60; r2++) {
          var fr = rules2[r2];
          if (fr.type === 5 || (fr.constructor && fr.constructor.name === 'CSSFontFaceRule')) {
            fontFaces.push({ family: (fr.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(), src: txt(fr.style.getPropertyValue('src'), 300) });
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    var fontLinks = [];
    var lks = doc.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="fonts.bunny.net"], link[href*="use.typekit.net"], link[href*="fonts.gstatic.com"]');
    for (var fl = 0; fl < lks.length; fl++) fontLinks.push(txt(lks[fl].getAttribute('href'), 400));
    var importsGoogle = /fonts\.googleapis\.com/.test(html);

    // Logo guess: an img/svg inside a link to "/" in the header, else any img with "logo".
    var logo = null;
    var logoCands = doc.querySelectorAll('header a[href="/"] img, header a[href="/"] svg, a[href="/"] img, [class*="logo"] img, img[alt*="logo" i], img[src*="logo" i]');
    for (var lc = 0; lc < logoCands.length && !logo; lc++) {
      var le = logoCands[lc];
      if (!isVisible(le)) continue;
      logo = le.tagName.toLowerCase() === 'img' ? abs(le.currentSrc || le.getAttribute('src')) : 'inline-svg';
    }

    function entries(map) {
      return Object.keys(map).map(function (k) {
        var v = map[k];
        v.key = k;
        return v;
      });
    }

    return {
      sampled: sampled,
      colors: entries(colorMap),
      fonts: entries(fontMap),
      sizes: entries(sizeMap),
      spacing: entries(spaceMap),
      radii: entries(radiusMap),
      shadows: entries(shadowMap),
      contrast: entries(contrastMap),
      contrastUnknown: contrastUnknown,
      buttons: entries(buttonMap),
      cssVars: cssVars,
      fontFaces: fontFaces,
      fontLinks: fontLinks,
      importsGoogle: importsGoogle,
      assets: { logoUrl: logo, favicon: head.favicon, themeColor: head.themeColor, ogImage: head.og.image },
    };
  }

  return {
    facts: {
      url: pageUrl,
      hasLayout: hasLayout,
      viewport: { w: vw, h: vh },
      doc: {
        w: hasLayout ? doc.documentElement.scrollWidth : 0,
        h: hasLayout ? Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0) : 0,
      },
      head: head,
      headings: headings,
      images: images,
      imageCount: imgEls.length,
      links: links,
      linkCount: aEls.length,
      unlabeledControls: unlabeled,
      landmarks: landmarks,
      skipLink: skipLink,
      focus: focus,
      smallText: smallText,
      longLines: longLines,
      primaryAction: primaryAction,
      overlays: overlays,
      autoplay: autoplay,
      renderBlocking: renderBlocking,
      mixedContent: mixed,
      stackHints: stackHints,
      domNodes: doc.getElementsByTagName('*').length,
      textLength: doc.body ? (doc.body.textContent || '').replace(/\s+/g, ' ').length : 0,
    },
    brand: brand,
  };
})
