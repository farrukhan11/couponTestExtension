// src/dom.js — shadow-DOM-aware DOM helpers shared by every module.
// Also owns the multilingual keyword regexes (CT.RE).
(() => {
  const CT = (globalThis.CT = globalThis.CT || {});
  if (CT.dom) return;

  // ---- multilingual keyword dictionaries (structure still decides) --------
  const RE = (CT.RE = CT.RE || {
    coupon: /coupon|promo(?:tion(?:al)?|code)?|discount|voucher|gift\s*card|offer\s*code|reduction|sconto|codice\s*(?:sconto|promozionale)|buono|code\s*(?:promo|promotionnel|r[eé]duction)|r[eé]duction|rabais|gutschein(?:code)?|rabatt(?:code)?|cup[oó]n|descuento|c[oó]digo\s*(?:promocional|de\s*descuento)|desconto|cupom|kortingscode|korting|kupon|alennus(?:koodi)?|rabatkode|kuponkode/i,
    apply: /apply|redeem|submit|use\s*code|applica|aplicar|aplic[aá]|appliqu(?:er|ez)|anwenden|einl[oö]sen|valider|utiliser|usar|invia|conferma|confirma|hinzuf[uü]gen/i,
    danger: /place\s*(?:your\s*)?order|submit\s*order|pay\s*now|complete\s*(?:purchase|order)|buy\s*now|confirm\s*order|checkout|check\s*out|subscribe|purchase|paga(?:re)?\b|abbonati|acquista|achat|kaufen|payer|bezahlen|proceed\s+to\s+(?:payment|checkout)|place\s+your\s+order|complete\s+subscription|start\s+subscription|activate|upgrade\s+now/i,
    itemRemove: /remove\s*(?:this\s*)?(?:item|product)|delete\s*(?:this\s*)?(?:item|product)|remove\s+from\s*cart|trash|rimuovi|elimina|supprimer|entfernen|eliminar/i,
    success: /applied|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied|sconto.*applicato|codice.*applicato|r[eé]duction.*appliqu|rabatt.*(?:angewendet|aktiv)|c[oó]digo.*aplicado|cupom.*aplicado/i,
    invalid: /invalid|not\s+valid|isn['’]?t\s+valid|is\s+not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found|non\s+(?:\S+\s+){0,2}valid[oa]|invalido|inv[aá]lido|invalide|ung[uü]ltig|non\s+trovato|aucun/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended|scadut[oa]|expir[eé]|abgelaufen|expirado|expirado/i,
    minimum: /minimum|min\.?\s*(?:order|spend)|spend.*(?:more|at\s+least)|minimum\s+spend|minimo|minimum\s+d|mindestbestellwert|pedido\s+m[ií]nimo|montant\s+minimum/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|cannot\s+be\s+(?:applied|used)|couldn['’]?t\s+be\s+(?:applied|used)|can['’]?t\s+be\s+(?:applied|used)|non\s+(?:\S+\s+){0,2}(?:applicabile|utilizzabile)|no\s+(?:\S+\s+){0,2}(?:aplicable|v[aá]lido)/i,
    used: /already\s+used|usage\s+limit|one\s+use|gi[aà]\s+utilizzato|ya\s+usado|d[eé]j[aà]\s+utilis/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(?:promo|coupon|discount)|non\s+combinabile/i
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  // ---- shadow DOM traversal (cached; rebuilt on mutation) -----------------
  function collectShadowRoots(node, acc = [], depth = 0) {
    if (!node || depth > 12) return acc;
    let children = [];
    try { children = node.querySelectorAll ? node.querySelectorAll('*') : []; } catch {}
    for (const el of children) {
      if (el.shadowRoot) { acc.push(el.shadowRoot); collectShadowRoots(el.shadowRoot, acc, depth + 1); }
    }
    return acc;
  }
  let srCache = null, srBuilt = 0, srDirty = true;
  let mutCount = 0;
  let observer = null;
  const observed = new Set();
  const OBSERVE_OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'open', 'disabled'] };
  function observe(target) {
    if (!observer || !target || observed.has(target)) return;
    observed.add(target);
    try { observer.observe(target, OBSERVE_OPTS); }
    catch { observed.delete(target); }
  }
  function shadowRoots() {
    const age = Date.now() - srBuilt;
    if (srCache && age <= 1000 && !(srDirty && age > 300)) return srCache;
    srCache = collectShadowRoots(document);
    srBuilt = Date.now();
    srDirty = false;
    for (const sr of srCache) observe(sr);
    return srCache;
  }
  function ensureObserver() {
    if (observer || !document.body || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(() => { srDirty = true; mutCount += 1; });
    observe(document.body);
  }
  // Monotonic mutation counter — consumers can tell when the DOM changed since
  // they last built a cached view.
  const now = () => mutCount;

  function qAll(selector, root) {
    const base = root || document;
    const out = [];
    try { for (const el of base.querySelectorAll(selector)) out.push(el); } catch {}
    const roots = base === document ? shadowRoots() : collectShadowRoots(base);
    for (const sr of roots) {
      observe(sr);
      try { for (const el of sr.querySelectorAll(selector)) out.push(el); } catch {}
    }
    return out;
  }
  const q = (selector, root) => qAll(selector, root)[0] || null;

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    let s;
    try { s = getComputedStyle(el); } catch { return false; }
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function attrText(el) {
    if (!el || !el.getAttribute) return '';
    return clean([
      el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'),
      el.getAttribute('id'), el.getAttribute('title'), el.getAttribute('autocomplete'),
      el.getAttribute('inputmode'), el.getAttribute('role')
    ].filter(Boolean).join(' '));
  }
  function text(el) {
    if (!el) return '';
    return clean([
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.textContent
    ].filter(Boolean).join(' '));
  }
  function deepClosest(el, selector) {
    let node = el;
    while (node && node.nodeType === 1) {
      try { if (node.matches && node.matches(selector)) return node; } catch {}
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }

  // ---- click safety -------------------------------------------------------
  function isDanger(el) {
    if (!el) return false;
    const t = text(el);
    const href = (el.getAttribute && el.getAttribute('href')) || '';
    const oc = (el.getAttribute && el.getAttribute('onclick')) || '';
    if (RE.danger.test(t) || RE.danger.test(oc)) return true;
    // Any button/link with a transactional href is off-limits.
    if (/\/(?:checkout|cart|orders?|payments?|billing|subscriptions?|account\/billing)\b/i.test(href)) return true;
    return false;
  }
  function isNavigation(el) {
    const a = deepClosest(el, 'a[href]');
    if (!a) return false;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return false;
    return !/^(javascript:|mailto:|tel:)/i.test(href);
  }
  function isCartRemove(el) {
    if (!el) return false;
    const blob = `${el.className || ''} ${(el.getAttribute && el.getAttribute('href')) || ''} ${text(el)}`;
    if (RE.itemRemove.test(text(el))) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key|product-remove|line-item__remove/i.test(blob)) return true;
    if (deepClosest(el, '.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (/\bremove\b|\bdelete\b|trash|×|✕|✖|rimuovi/i.test(`${text(el)} ${el.className || ''}`)) return true;
    }
    return false;
  }

  function safeClick(el) {
    if (!el || !visible(el)) return false;
    if (isDanger(el) || isNavigation(el) || isCartRemove(el)) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    return true;
  }
  // Real element.click(): runs the activation behaviour (e.g. form submit).
  function nativeClick(el) {
    if (!el || isDanger(el) || isNavigation(el) || isCartRemove(el)) return false;
    try { if (el.focus) el.focus(); el.click(); return true; } catch { return false; }
  }

  // ---- value setting that frameworks notice -------------------------------
  function setValue(input, value) {
    if (!input) return;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    try { input.focus(); } catch {}
    try { input.dispatchEvent(new Event('focus', { bubbles: true })); } catch {}
    try { if (setter) setter.call(input, value); else input.value = value; } catch { input.value = value; }
    try { input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value })); } catch {}
    try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, cancelable: true })); } catch {}
    try { input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true })); } catch {}
    try { input.focus(); } catch {}
  }

  CT.dom = {
    RE, sleep, clean, q, qAll, visible, text, attrText, deepClosest,
    isDanger, isNavigation, isCartRemove, safeClick, nativeClick, setValue,
    shadowRoots, collectShadowRoots, ensureObserver, now
  };
  ensureObserver();
})();
