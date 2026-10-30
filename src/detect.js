// src/detect.js — locate the coupon field, open a collapsed section, and find
// the Apply button. Multilingual keywords + structural signals so it works on
// Shopify/WooCommerce/Sellfy/custom checkouts in any language.
(() => {
  const CT = globalThis.CT;
  if (!CT || !CT.dom || CT.detect) return;
  const { RE, sleep, clean, qAll, visible, text, attrText, deepClosest, safeClick } = CT.dom;

  // Fields that are definitely NOT the coupon box (multilingual).
  const BAD = /email|e-?mail|phone|telefono|postal|\bzip\b|citt[aà]|provincia|indirizzo|address|cerca|\bsearch\b|quantity|quantit[aà]|first\s*name|last\s*name|\bnome\b|\bcognome\b|\bcity\b|\bstate\b|country|paese|password|newsletter|subscribe|filtro|\bfilter\b|percentuale|discount\s*percent|\bnome\s+sulla\s+carta\b/i;

  // Payment / identity fields. Never a coupon box, whatever else the page says
  // near them ("gift card" is stripped first so gift-card coupon boxes survive).
  const PAYMENT = /\bcards?\b|cc-|\bcc\b|cvv|cvc|csc|cvn|security\s*code|verification|expir|exp[\s._-]*(?:date|month|year|mm|yy)|\bmm\s*\/?\s*yy|iban|swift|routing|account\s*(?:number|no)|sort\s*code|cardholder|holder|carta|scadenza|tarjeta|vencimiento|karte|kartennummer|prüfnummer|carte|cryptogramme|cart[aã]o|validade|\bssn\b|\bvat\b|tax\s*id|\bpin\b|one-time|otp/i;
  // autocomplete tokens that identify personal / payment data.
  const BAD_AUTOCOMPLETE = /^(?:cc-|name|given-name|additional-name|family-name|honorific|nickname|username|new-password|current-password|one-time-code|organization|street-address|address-|postal-code|country|tel|email|bday|sex|transaction|url|photo)/i;
  const NON_TEXT_TYPES = /^(?:checkbox|radio|password|email|tel|number|date|datetime-local|month|week|time|file|range|color|image|button|submit|reset|search)$/i;

  function labelText(el) {
    const bits = [];
    try {
      if (el.labels) for (const l of el.labels) bits.push(l.textContent);
    } catch {}
    try {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const root = el.getRootNode && el.getRootNode();
      for (const id of ids) {
        const n = root && root.getElementById ? root.getElementById(id) : document.getElementById(id);
        if (n) bits.push(n.textContent);
      }
    } catch {}
    try { const l = el.closest && el.closest('label'); if (l) bits.push(l.textContent); } catch {}
    // Floating-label designs: label is a sibling right before the input.
    try {
      let s = el.previousElementSibling;
      if (s && /^(?:label|span|div)$/i.test(s.tagName) && !s.querySelector('input,textarea,button')) bits.push(s.textContent);
    } catch {}
    return clean(bits.join(' ')).slice(0, 160);
  }
  function describe(el) {
    const attrs = `${attrText(el)} ${clean(el.placeholder || '')}`.trim();
    return { attrs, label: labelText(el), all: `${attrs} ${labelText(el)}`.trim() };
  }
  const withoutGiftCard = (s) => s.replace(/gift\s*-?\s*cards?|carte\s+cadeau|tarjeta\s+de\s+regalo|carta\s+regalo/gi, ' giftcoupon ');
  // Hard exclusion: wrong input kind, or text/autocomplete says it is personal/payment data.
  function isExcluded(el, d) {
    const type = (el.getAttribute && el.getAttribute('type')) || '';
    if (el.tagName === 'INPUT' && NON_TEXT_TYPES.test(type)) return true;
    if (el.disabled || el.readOnly) return true;
    const ac = (el.getAttribute && el.getAttribute('autocomplete')) || '';
    if (ac && ac.split(/\s+/).some((tok) => BAD_AUTOCOMPLETE.test(tok))) return true;
    const own = withoutGiftCard(d.all);
    if (PAYMENT.test(own) || BAD.test(own)) return true;
    return false;
  }
  function isPaymentContext(el) {
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) {
      const attrs = `${p.id || ''} ${typeof p.className === 'string' ? p.className : ''} ${p.getAttribute('data-testid') || ''} ${p.getAttribute('aria-label') || ''}`;
      if (/payment|credit|card-?(?:number|form|field|details)|cvv|billing|stripe|braintree|adyen|checkout-?com/i.test(withoutGiftCard(attrs)) && !RE.coupon.test(attrs)) return true;
    }
    return false;
  }

  // ---- dialog scoping -----------------------------------------------------
  function contextText(el) {
    let out = '';
    let p = el && el.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      let t = '';
      try { t = clean(p.innerText || ''); } catch { t = ''; }
      if (t && t.length < 400) out += ` ${t}`;
    }
    return out;
  }
  function scopeRoots() {
    const preferred = [];
    for (const sel of ['[role="dialog"]', 'dialog[open]', '[aria-modal="true"]']) {
      for (const el of qAll(sel)) {
        if (!visible(el) || el === document.body) continue;
        const t = clean(el.innerText || '');
        if (t.length > 30000) continue;
        let nodes = [];
        try { nodes = el.querySelectorAll('input:not([type="hidden"]),textarea'); } catch {}
        const couponish = [...nodes].some((i) => visible(i) && (RE.coupon.test(attrText(i)) || RE.coupon.test(contextText(i))));
        if (couponish || RE.coupon.test(t)) preferred.push(el);
      }
    }
    return preferred.length ? preferred : [document];
  }
  function scopedQAll(selector) {
    const roots = scopeRoots();
    if (roots.length === 1 && roots[0] === document) return qAll(selector);
    const out = [];
    const seen = new Set();
    for (const r of roots) for (const el of qAll(selector, r)) { if (!seen.has(el)) { seen.add(el); out.push(el); } }
    return out;
  }

  // ---- field detection ----------------------------------------------------
  function smallestRow(input) {
    let el = input.parentElement;
    for (let i = 0; i < 6 && el; i += 1, el = el.parentElement) {
      let hasInput = false, hasBtn = false;
      try { hasInput = Boolean(el.querySelector('input:not([type="hidden"]),textarea')); } catch {}
      try { hasBtn = Boolean(el.querySelector('button,[role="button"],input[type="submit"],input[type="button"]')); } catch {}
      if (hasInput && hasBtn) return el;
    }
    return input.parentElement || null;
  }
  function visibleInputCount(scope) {
    let n = 0;
    try {
      for (const i of scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select')) if (visible(i)) n += 1;
    } catch {}
    return n;
  }
  // The Apply button must sit in the coupon's own row (a row with a single
  // input) — never the form-wide "Submit"/"Confirm" button of a card form.
  function nearApplyButton(el) {
    const row = smallestRow(el);
    if (!row || visibleInputCount(row) > 1) return null;
    for (const b of qAll('button,[role="button"],input[type="submit"],input[type="button"]', row)) {
      if (!visible(b) || CT.dom.isDanger(b)) continue;
      const t = text(b) || b.value || '';
      if (PAYMENT.test(withoutGiftCard(t))) continue;
      if (RE.apply.test(t)) return b;
    }
    return null;
  }
  function scoreField(el) {
    const d = describe(el);
    if (isExcluded(el, d)) return -100;
    const own = withoutGiftCard(d.all);
    const ownCoupon = RE.coupon.test(own);
    const generic = /code|codice|c[oó]digo|kode|kortingscode|promocode/i.test(own);
    const ctxCoupon = RE.coupon.test(contextText(el));
    const apply = nearApplyButton(el);
    let score = 0;
    if (ownCoupon) score += 20;
    else if (generic) score += 6;
    if (ctxCoupon) score += 5;
    if (apply) score += 10;
    // Without coupon wording on the field itself, require corroboration:
    // a generic "code"/unlabelled field only counts with an Apply button in its row.
    if (!ownCoupon && !apply) score -= 20;
    if (!ownCoupon && isPaymentContext(el)) score -= 20;
    if (el.name && /^(s|q|search|query|keyword|filter)$/i.test(el.name)) score -= 30;
    if (deepClosest(el, 'nav,[role="navigation"],aside,header')) score -= 20;
    return score;
  }
  const STRONG = 20;
  function findField(opts = {}) {
    const all = scopedQAll('input:not([type="hidden"]),textarea')
      .map((el) => ({ el, score: scoreField(el), vis: visible(el) }))
      .filter((x) => x.score >= 8);
    const vis = all.filter((x) => x.vis).sort((a, b) => b.score - a.score);
    const hid = all.filter((x) => !x.vis).sort((a, b) => b.score - a.score);
    if (opts.includeHidden) return (vis[0] || hid[0] || {}).el || null;
    if (!vis.length) return null;
    // A confident coupon field exists but is collapsed: a merely plausible
    // visible field is more likely a look-alike (card/ID box) — report "not
    // found" so openSection() expands the real one instead.
    if (hid.length && hid[0].score >= STRONG && vis[0].score < STRONG) return null;
    return vis[0].el;
  }
  function fieldDescriptor(el) {
    if (!el) return '';
    const bits = [el.getAttribute && el.getAttribute('placeholder'), el.name, el.id, el.getAttribute && el.getAttribute('aria-label')].filter(Boolean);
    return clean(bits.join(' / ')).slice(0, 60) || el.tagName.toLowerCase();
  }

  // ---- open a collapsed coupon section ------------------------------------
  const OPENER_SEL = 'button,a[href],[role="button"],summary,details,[aria-expanded],[class*="coupon" i],[class*="promo" i],[class*="discount" i],[class*="sconto" i],label';
  const REVEAL = /\b(add|enter|have|use|got|show|reveal|expand|apply|redeem|aggiungi|inserisci|avrai|hai|usa|usar|aplicar|ajouter|utiliser|haben|einl[oö]sen|hinzuf[uü]gen|codice|code)\b/i;
  const EXPAND_HINT = /[+\u002B]|\bexpand\b|\bshow\b|\breveal\b|\bmore\b|›|»|▸|►/i;

  function clickableWithin(el) {
    if (!el) return null;
    if (el.matches && el.matches('button,a[href],[role="button"],summary')) return el;
    const inner = el.querySelector && el.querySelector('button,a[href],[role="button"],summary');
    return inner && visible(inner) ? inner : el;
  }
  function isNavigation(el) { return CT.dom.isNavigation(el); }
  function findOpeners() {
    const seen = new Set();
    const scored = [];
    for (const el of scopedQAll(OPENER_SEL)) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const t = text(el);
      if (!t) continue;
      if (RE.danger.test(t) || CT.dom.isCartRemove(el) || isNavigation(el)) continue;
      if (deepClosest(el, 'nav,[role="navigation"],aside')) continue;
      let hasVisibleInput = false;
      try {
        const scope = el.shadowRoot || el;
        for (const i of scope.querySelectorAll('input:not([type="hidden"]),textarea')) if (visible(i)) { hasVisibleInput = true; break; }
      } catch {}
      if (hasVisibleInput) continue;
      const qualifies = RE.coupon.test(t) && (REVEAL.test(t) || RE.apply.test(t) || (el.matches && el.matches('summary,details')) || (el.hasAttribute && el.hasAttribute('aria-expanded')) || EXPAND_HINT.test(t));
      if (!qualifies) continue;
      let score = 34;
      if (el.matches && el.matches('summary,details')) score += 10;
      if (el.hasAttribute && el.hasAttribute('aria-expanded')) score += 8;
      if (el.matches && el.matches('button,[role="button"],summary')) score += 8;
      if (EXPAND_HINT.test(t)) score += 6;
      const r = el.getBoundingClientRect();
      score -= Math.min(20, Math.round((r.width * r.height) / 4000));
      scored.push({ el, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.el);
  }

  function revealHidden(node) {
    let el = node;
    let changed = false;
    for (let depth = 0; el && el !== document.body && depth < 12; depth += 1, el = el.parentElement) {
      let s;
      try { s = getComputedStyle(el); } catch { continue; }
      const collapsed = (el.hasAttribute && el.hasAttribute('hidden')) || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')
        || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0
        || s.maxHeight === '0px' || s.height === '0px';
      if (!collapsed) continue;
      changed = true;
      try { el.removeAttribute('hidden'); } catch {}
      try { el.setAttribute('aria-hidden', 'false'); } catch {}
      try { el.style.setProperty('display', 'block', 'important'); } catch {}
      try { el.style.setProperty('visibility', 'visible', 'important'); } catch {}
      try { el.style.setProperty('opacity', '1', 'important'); } catch {}
      try { el.style.setProperty('max-height', 'none', 'important'); } catch {}
      try { el.style.setProperty('height', 'auto', 'important'); } catch {}
      try { el.style.setProperty('overflow', 'visible', 'important'); } catch {}
    }
    return changed;
  }

  async function openSection() {
    if (findField()) return true;
    const detailsList = scopedQAll('details').filter((d) => !d.hasAttribute('open') && RE.coupon.test(clean(d.innerText || '')));
    for (const d of detailsList) { try { d.setAttribute('open', ''); } catch {} await sleep(250); }
    if (findField()) return true;

    const clicked = new Set();
    const isClicked = (el) => !el || clicked.has(el) || clicked.has(clickableWithin(el));
    for (let pass = 0; pass < 3; pass += 1) {
      let acted = false;
      for (const opener of findOpeners()) {
        if (isClicked(opener)) continue;
        const target = clickableWithin(opener) || opener;
        clicked.add(opener);
        if (target !== opener) clicked.add(target);
        safeClick(target);
        for (let waited = 0; waited < 1800; waited += 300) {
          await sleep(300);
          if (findField()) return true;
        }
        acted = true;
      }
      if (!acted) break;
      if (findField()) return true;
    }
    if (findField()) return true;

    const hidden = findField({ includeHidden: true });
    if (hidden) {
      for (let i = 0; i < 3; i += 1) {
        revealHidden(hidden);
        await sleep(250);
        if (findField()) return true;
      }
    }
    return false;
  }

  // ---- apply button -------------------------------------------------------
  function pickApply(input, scope, strict) {
    if (!scope) return null;
    let best = null, bestScore = -Infinity;
    const ir = input.getBoundingClientRect();
    for (const el of qAll('button,[role="button"],input[type="submit"],input[type="button"],a', scope)) {
      if (!visible(el)) continue;
      if (CT.dom.isDanger(el) || CT.dom.isCartRemove(el) || isNavigation(el)) continue;
      const t = `${text(el)} ${(el.value || '')}`.trim();
      if (PAYMENT.test(withoutGiftCard(t))) continue;
      // A button owned by a different form (e.g. the card form) is not ours.
      const ef = el.form || (el.closest && el.closest('form'));
      const inf = input.form || (input.closest && input.closest('form'));
      if (ef && inf && ef !== inf) continue;
      let score = 0;
      if (RE.apply.test(t)) score += 12;
      if (RE.coupon.test(t)) score += 4;
      const er = el.getBoundingClientRect();
      if (Math.abs((er.top + er.height / 2) - (ir.top + ir.height / 2)) < Math.max(48, ir.height)) score += 4;
      if (er.left >= ir.left - 8) score += 2;
      if (!t) score -= 4;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore >= (strict ? 6 : 16) ? best : null;
  }
  function findApply(input) {
    if (!input) return null;
    const row = smallestRow(input);
    const form = input.form || (input.closest && input.closest('form'));
    const inRow = pickApply(input, row, true);
    if (inRow) return inRow;
    const inForm = pickApply(input, form, true);
    if (inForm) return inForm;
    return pickApply(input, document, false);
  }

  CT.detect = { findField, openSection, findApply, fieldDescriptor, clickableWithin, contextText, smallestRow, scopeRoots, scopedQAll };
})();
