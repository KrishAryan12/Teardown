/* Mobile-pass checks, run at 390x844 with touch. Self-contained (see collect.js). */
(function mobileChecks() {
  'use strict';
  var doc = document;
  var vw = window.innerWidth;
  var sx = window.scrollX || 0;
  var sy = window.scrollY || 0;

  function sel(el) {
    var parts = [];
    for (var cur = el, d = 0; cur && cur.nodeType === 1 && d < 4; d++) {
      var tag = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]{0,60}$/.test(cur.id) && doc.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) {
        parts.unshift('#' + cur.id);
        break;
      }
      if (tag === 'body' || tag === 'html') {
        parts.unshift(tag);
        break;
      }
      var p = cur.parentElement;
      var same = 0;
      var idx = 0;
      if (p) {
        for (var i = 0; i < p.children.length; i++) {
          if (p.children[i].tagName === cur.tagName) {
            same++;
            if (p.children[i] === cur) idx = same;
          }
        }
      }
      parts.unshift(same > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
      cur = p;
    }
    return parts.join(' > ').slice(0, 300);
  }
  function snip(el) {
    var h = (el.outerHTML || '').replace(/\s+/g, ' ');
    return h.length > 280 ? h.slice(0, 279) + '…' : h;
  }
  function box(r) {
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) };
  }

  var scrollWidth = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  var overflowX = getComputedStyle(doc.documentElement).overflowX;
  var bodyOverflowX = doc.body ? getComputedStyle(doc.body).overflowX : 'visible';
  var clipped = overflowX === 'hidden' || overflowX === 'clip' || bodyOverflowX === 'hidden' || bodyOverflowX === 'clip';
  var offenders = [];
  if (scrollWidth > vw + 1) {
    var all = doc.body ? doc.body.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && offenders.length < 5 && i < 5000; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && r.width <= scrollWidth + 1) {
        var parentR = all[i].parentElement ? all[i].parentElement.getBoundingClientRect() : null;
        // Report the outermost offender only.
        if (!parentR || parentR.right <= vw + 1) offenders.push({ selector: sel(all[i]), right: Math.round(r.right), snippet: snip(all[i]), bbox: box(r) });
      }
    }
  }

  var targets = [];
  var cands = doc.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [onclick], summary');
  var small24 = 0;
  var small44 = 0;
  var checked = 0;
  // Pass 1: visible targets with their boxes.
  var boxes = [];
  for (var j = 0; j < cands.length && j < 600; j++) {
    var el = cands[j];
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
    var rr = el.getBoundingClientRect();
    // Visually hidden (sr-only / skip links before focus): 1-2px boxes or clipped away.
    if (rr.width <= 2 || rr.height <= 2) continue;
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(st.clip) || /inset\((50|100)%/.test(st.clipPath)) continue;
    if (rr.right <= 0 || rr.left >= vw) continue;
    // Inline links inside running text are exempt from target size (WCAG 2.5.8 exception).
    if (el.tagName === 'A' && st.display === 'inline' && el.parentElement && /^(P|LI|TD|DD|SPAN|BLOCKQUOTE|SMALL|LABEL)$/.test(el.parentElement.tagName)) {
      var ptxt = (el.parentElement.textContent || '').trim().length;
      if (ptxt > (el.textContent || '').trim().length + 5) continue;
    }
    boxes.push({ el: el, r: rr });
  }
  // WCAG 2.5.8 spacing exception: an undersized target passes when a 24px square centred on it
  // overlaps no other target.
  function spaced(i) {
    var r = boxes[i].r;
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var a = { l: cx - 12, t: cy - 12, r: cx + 12, b: cy + 12 };
    for (var k = 0; k < boxes.length; k++) {
      if (k === i) continue;
      var o = boxes[k];
      if (o.el.contains(boxes[i].el) || boxes[i].el.contains(o.el)) continue;
      var q = o.r;
      if (q.left < a.r && q.right > a.l && q.top < a.b && q.bottom > a.t) return false;
    }
    return true;
  }
  for (var i2 = 0; i2 < boxes.length; i2++) {
    var b2 = boxes[i2];
    checked++;
    var w = b2.r.width;
    var h = b2.r.height;
    if (w < 24 || h < 24) {
      if (spaced(i2)) continue;
      small24++;
      if (targets.length < 30) targets.push({ selector: sel(b2.el), w: Math.round(w), h: Math.round(h), level: 24, snippet: snip(b2.el), bbox: box(b2.r) });
    } else if (w < 44 || h < 44) {
      small44++;
      if (targets.length < 30) targets.push({ selector: sel(b2.el), w: Math.round(w), h: Math.round(h), level: 44, snippet: snip(b2.el), bbox: box(b2.r) });
    }
  }

  var meta = doc.querySelector('meta[name="viewport"]');
  return {
    viewportW: vw,
    scrollWidth: scrollWidth,
    clipped: clipped,
    overflow: scrollWidth > vw + 1 && !clipped,
    overflowOffenders: offenders,
    tapTargets: { checked: checked, below24: small24, below44: small44, samples: targets },
    viewportMeta: meta ? meta.getAttribute('content') : null,
    docH: Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0),
    bodyFontPx: doc.body ? parseFloat(getComputedStyle(doc.body).fontSize) : 16,
  };
})
