// src/detect.js — locate the coupon field, open a collapsed section, and find
// the Apply button. Multilingual keywords + structural signals so it works on
// Shopify/WooCommerce/Sellfy/custom checkouts in any language.
(() => {
  const CT = globalThis.CT;
  if (!CT || !CT.dom || CT.detect) return;
  const { RE, sleep, clean, qAll, visible, text, attrText, deepClosest, safeClick } = CT.dom;

  // Fields that are definitely NOT the coupon box (multilingual).
  const BAD = /email|e-?mail|phone|telefono|postal|\bzip\b|citt[aà]|provincia|indirizzo|address|cerca|\bsearch\b|quantity|quantit[aà]|first\s*name|last\s*name|\bnome\b|\bcognome\b|\bcity\b|\bstate\b|country|paese|password|newsletter|subscribe|filtro|\bfilter\b|percentuale|discount\s*percent|\bnome\s+sulla\s+carta\b/i;

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
  function nearApplyButton(el) {
    const scope = (el.closest && el.closest('form')) || smallestRow(el);
    if (!scope) return null;
    for (const b of qAll('button,[role="button"],input[type="submit"],input[type="button"]', scope)) {
      if (!visible(b)) continue;
      if (RE.apply.test(text(b) || b.value || '')) return b;
    }
    return null;
  }
  function scoreField(el) {
    const own = `${attrText(el)} ${clean(el.placeholder || '')}`.trim();
    const ctx = contextText(el);
    let score = 0;
    if (RE.coupon.test(own)) score += 20;
    else if (/\bcode\b|codice|c[oó]digo|kode\b|kortingscode|promocode/i.test(own)) score += 6;
    if (RE.coupon.test(ctx)) score += 5;
    if (el.getAttribute && el.getAttribute('type') === 'search') score -= 30;
    if (BAD.test(own)) score -= 30;
    if (el.name && /^(s|q|search|query|keyword|filter)$/i.test(el.name)) score -= 30;
    if (deepClosest(el, 'nav,[role="navigation"],aside,header')) score -= 20;
    if (nearApplyButton(el)) score += 10;
    return score;
  }
  function findField(opts = {}) {
    const list = scopedQAll('input:not([type="hidden"]),textarea')
      .map((el) => ({ el, score: scoreField(el), vis: visible(el) }))
      .filter((x) => x.score >= 8 && (opts.includeHidden || x.vis))
      .sort((a, b) => (b.vis ? 1 : 0) - (a.vis ? 1 : 0) || b.score - a.score);
    return list[0] ? list[0].el : null;
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
      let score = 0;
      if (RE.apply.test(t)) score += 12;
      if (RE.coupon.test(t)) score += 4;
      const er = el.getBoundingClientRect();
      if (Math.abs((er.top + er.height / 2) - (ir.top + ir.height / 2)) < Math.max(48, ir.height)) score += 4;
      if (er.left >= ir.left - 8) score += 2;
      if (!t) score -= 4;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore >= (strict ? 6 : 12) ? best : null;
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
