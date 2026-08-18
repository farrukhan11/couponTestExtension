(() => {
  if (window.__couponTestV6Loaded) return;
  window.__couponTestV6Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|minimum\s+spend|spend.*(more|at\s+least)|requires?.*(minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /sign\s*in|log\s*in|required\s+account|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order|check\s*out/i,
    itemRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i
  };
  const STATUS_RE = new RegExp([RE.success.source, RE.invalid.source, RE.expired.source, RE.minimum.source, RE.eligible.source, RE.used.source, RE.login.source, RE.stack.source].join('|'), 'i');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let abortRequested = false;

  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const codeKey = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
  }

  function textOf(el) {
    return clean([
      el?.getAttribute?.('aria-label'), el?.getAttribute?.('placeholder'), el?.getAttribute?.('name'),
      el?.getAttribute?.('id'), el?.getAttribute?.('title'), el?.textContent
    ].filter(Boolean).join(' '));
  }

  function contextOf(el, depth = 3) {
    let out = textOf(el), p = el?.parentElement;
    for (let i = 0; i < depth && p; i += 1, p = p.parentElement) {
      const t = clean(p.innerText || p.textContent || '');
      if (t && t.length < 700) out += ` ${t}`;
    }
    if (el?.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) out += ` ${clean(label.innerText || label.textContent)}`;
      } catch {}
    }
    return out;
  }

  function parseMoney(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/[^0-9.,-]/g, '');
    if (!s) return null;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }

  function moneyFromText(text) {
    const m = [...String(text || '').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)];
    return m.length ? parseMoney(m[m.length - 1][0]) : null;
  }

  function currencyFromText(text) {
    const s = String(text || '');
    if (s.includes('$')) return '$'; if (s.includes('€')) return '€'; if (s.includes('£')) return '£'; if (s.includes('¥')) return '¥'; if (s.includes('₹')) return '₹';
    const code = s.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }

  function findCouponInput() {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible).map((el) => {
      const own = textOf(el), ctx = contextOf(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 16;
      if (RE.coupon.test(ctx)) score += 6;
      if (/code/i.test(own)) score += 3;
      if (/email|phone|postal|zip|address|search|quantity|city|state|country|first\s*name|last\s*name/i.test(own)) score -= 15;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return inputs[0]?.score >= 6 ? inputs[0].el : null;
  }

  function isDisabled(el) {
    return !el || el.disabled || el.getAttribute?.('aria-disabled') === 'true' || /disabled/i.test(String(el.className || ''));
  }

  function isCartItemRemoveControl(el) {
    if (!el) return false;
    const own = textOf(el), meta = `${String(el.className || '')} ${el.getAttribute?.('href') || ''}`;
    if (/remove_from_cart|cart_item_key|remove-item|remove_item/i.test(meta)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (RE.itemRemove.test(`${own} ${meta}`)) return true;
    }
    return false;
  }

  function findApplyButton(input) {
    const all = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible).map((el) => {
      const t = textOf(el), ctx = contextOf(el, 2);
      if (RE.danger.test(t) || isCartItemRemoveControl(el)) return { el, score: -999 };
      let score = 0;
      if (RE.apply.test(t)) score += 12;
      if (RE.apply.test(ctx) && RE.coupon.test(ctx)) score += 5;
      if (input?.form && el.closest('form') === input.form) score += 10;
      if (input?.parentElement?.contains(el)) score += 8;
      if (input && el.parentElement === input.parentElement) score += 5;
      if (isDisabled(el)) score -= 2;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return all[0]?.score >= 8 ? all[0].el : null;
  }

  function nativeSet(input, value) {
    input.focus();
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || 'a' }));
  }

  async function fillCoupon(input, code) {
    nativeSet(input, '');
    await sleep(80);
    nativeSet(input, code);
    await sleep(250);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(250);
  }

  async function waitForEnabledApply(input, timeout = 2500) {
    const start = Date.now();
    let btn = findApplyButton(input);
    while (Date.now() - start < timeout) {
      btn = findApplyButton(input);
      if (btn && !isDisabled(btn)) return btn;
      await sleep(100);
    }
    return btn;
  }

  function fireClick(el) {
    if (!el) throw new Error('Apply button not found.');
    if (RE.danger.test(textOf(el)) || isCartItemRemoveControl(el)) throw new Error(`Blocked unsafe button: ${textOf(el)}`);
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','pointerup','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(type, opts)); } catch {}
    }
    try { el.click(); } catch {}
  }

  function firstAmount(selectors) {
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const text = el.innerText || el.textContent || '';
      const amount = moneyFromText(text);
      if (amount !== null) return { amount, currency: currencyFromText(text) };
    }
    return null;
  }

  function labelAmount(words, skipSubTotal = false) {
    const hits = [];
    for (const el of document.querySelectorAll('div,span,p,li,td,tr,strong,b,section')) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 220) continue;
      if (skipSubTotal && /sub\s*total/i.test(text)) continue;
      if (!words.some((r) => r.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), score: text.length < 100 ? 3 : 1 });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshotTotals() {
    const subtotal = firstAmount(['.cart-subtotal .amount','.cart-subtotal .woocommerce-Price-amount','[data-checkout-subtotal-price-target]','.total-line--subtotal .payment-due-label + *']) || labelAmount([/\bsub\s*total\b/i, /\bitems?\s+total\b/i]);
    const total = firstAmount(['.order-total .amount','.order-total .woocommerce-Price-amount','[data-checkout-payment-due-target]','.payment-due__price']) || labelAmount([/\bgrand\s+total\b/i,/\border\s+total\b/i,/^\s*total\b/i], true);
    const discount = firstAmount(['tr.cart-discount .amount','tr[class*="cart-discount"] .amount','.reduction-code__text','.tag__wrapper','.cart-discount .woocommerce-Price-amount']);
    return { subtotal: subtotal?.amount ?? null, total: total?.amount ?? null, discount: discount?.amount ?? null, currencySymbol: subtotal?.currency || total?.currency || discount?.currency || '' };
  }

  function discountFromCodeText(text, code) {
    const t = clean(text), key = codeKey(code);
    if (!key || !codeKey(t).includes(key)) return null;
    const patterns = [
      /\(\s*[-−]\s*([$€£¥₹]?\s*\d[\d.,]*)\s*\)/,
      /[-−]\s*([$€£¥₹]?\s*\d[\d.,]*)/,
      /\bdiscount\b[^$€£¥₹\d]*([$€£¥₹]?\s*\d[\d.,]*)/i
    ];
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return parseMoney(m[1] || m[0]);
    }
    return null;
  }

  function collectSignals(code, beforeTexts = new Set()) {
    const all = new Set();
    const key = codeKey(code);
    const selectors = '[role="alert"],[aria-live],.woocommerce-message,.woocommerce-error,.woocommerce-info,.error,.errors,.success,.notice,.message,.alert,.form-error,.field-error,.invalid-feedback,[class*="error"],[class*="success"],[class*="notice"],[class*="message"],[class*="coupon"],[class*="promo"],[class*="discount"],[class*="reduction"],[class*="tag"],[class*="chip"]';
    for (const el of document.querySelectorAll(selectors)) if (visible(el)) {
      const t = clean(el.innerText || el.textContent || '');
      if (t && t.length <= 700) all.add(t);
    }
    for (const el of document.querySelectorAll('div,span,p,li,small,label,em,strong,b,button')) if (visible(el)) {
      const t = clean(el.innerText || el.textContent || '');
      if (!t || t.length > 260) continue;
      const lowerKey = codeKey(t);
      if ((key && lowerKey.includes(key)) || STATUS_RE.test(t) || /valid\s+discount\s+code/i.test(t)) all.add(t);
    }
    const fresh = [...all].filter((t) => !beforeTexts.has(t));
    return { all, fresh };
  }

  function bestResponse(signals, code) {
    const key = codeKey(code);
    const list = [...signals.fresh, ...signals.all];
    const scored = list.map((t) => {
      let s = 0;
      if (codeKey(t).includes(key)) s += 8;
      if (discountFromCodeText(t, code) !== null) s += 20;
      if (STATUS_RE.test(t)) s += 10;
      if (/valid\s+discount\s+code/i.test(t)) s += 12;
      if (t.length < 120) s += 3;
      return { t, s };
    }).sort((a, b) => b.s - a.s);
    return scored[0]?.t || '';
  }

  function couponApplied(code) {
    const key = codeKey(code);
    if (!key) return false;
    for (const el of document.querySelectorAll('div,span,p,li,button,[data-coupon],[data-coupon-code],[class*="tag"],[class*="chip"],[class*="discount"],[class*="reduction"]')) {
      if (!visible(el)) continue;
      const t = codeKey(`${el.getAttribute?.('data-coupon') || ''} ${el.getAttribute?.('data-coupon-code') || ''} ${el.innerText || el.textContent || ''}`);
      if (t.includes(key) && (discountFromCodeText(el.innerText || el.textContent || '', code) !== null || /discount|coupon|promo|tag|chip|reduction/i.test(String(el.className || '')))) return true;
    }
    return false;
  }

  function totalsChanged(a, b) {
    return ['subtotal','total','discount'].some((k) => Number.isFinite(a[k]) && Number.isFinite(b[k]) && Math.abs(a[k] - b[k]) > 0.005);
  }

  async function waitForResult(code, baseline, beforeTexts, timeout = 6500) {
    const start = Date.now();
    let latestSignals = collectSignals(code, beforeTexts), latestTotals = snapshotTotals();
    while (Date.now() - start < timeout) {
      await sleep(180);
      latestSignals = collectSignals(code, beforeTexts);
      latestTotals = snapshotTotals();
      const text = bestResponse(latestSignals, code);
      const applied = couponApplied(code);
      const disc = discountFromCodeText(text, code);
      if (disc !== null || applied || totalsChanged(baseline, latestTotals) || STATUS_RE.test(text) || /valid\s+discount\s+code/i.test(text)) {
        await sleep(250);
        const signals2 = collectSignals(code, beforeTexts);
        const totals2 = snapshotTotals();
        return { timedOut: false, responseText: bestResponse(signals2, code) || text, totals: totals2, applied: couponApplied(code) };
      }
    }
    return { timedOut: true, responseText: bestResponse(latestSignals, code), totals: latestTotals, applied: couponApplied(code) };
  }

  function classify(responseText, before, after, code, timedOut, applied) {
    const t = clean(responseText);
    const lineDiscount = discountFromCodeText(t, code);
    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const raised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    if (lineDiscount !== null || applied || saved || raised || RE.success.test(t)) return 'WORKING';
    if (RE.expired.test(t)) return 'EXPIRED';
    if (RE.minimum.test(t)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(t)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(t)) return 'ALREADY_USED';
    if (RE.stack.test(t)) return 'NOT_STACKABLE';
    if (RE.invalid.test(t)) return 'INVALID';
    if (RE.login.test(t)) return 'LOGIN_REQUIRED';
    return timedOut ? 'NO_RESPONSE' : 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(before, after, responseText, code) {
    let amount = discountFromCodeText(responseText, code);
    if (amount === null && Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    if (amount === null && Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : before.total;
    let percent = amount !== null && Number.isFinite(base) && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const m = clean(responseText).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (m) percent = Number(m[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]'];
    const set = new Set();
    for (const s of selectors) for (const el of document.querySelectorAll(s)) if (visible(el)) set.add(el);
    return set.size;
  }

  function appliedCouponContainers(code) {
    const key = codeKey(code), out = [];
    for (const el of document.querySelectorAll('div,span,p,li,button,[data-coupon],[data-coupon-code],[class*="tag"],[class*="chip"],[class*="discount"],[class*="reduction"]')) {
      if (!visible(el)) continue;
      const full = `${el.getAttribute?.('data-coupon') || ''} ${el.getAttribute?.('data-coupon-code') || ''} ${el.innerText || el.textContent || ''}`;
      if (codeKey(full).includes(key) && (discountFromCodeText(full, code) !== null || /discount|coupon|promo|tag|chip|reduction/i.test(String(el.className || '')))) out.push(el);
    }
    out.sort((a, b) => (clean(a.innerText || a.textContent).length) - (clean(b.innerText || b.textContent).length));
    return [...new Set(out)];
  }

  function couponRemoveCandidates(code) {
    const key = codeKey(code), cands = [];
    const directSel = [
      '[aria-label*="remove" i]','[aria-label*="delete" i]','[title*="remove" i]','[title*="delete" i]',
      '[data-testid*="remove" i]','[data-test*="remove" i]','[class*="remove-coupon" i]','[class*="remove_coupon" i]',
      '[class*="discount" i] button','[class*="reduction" i] button','[class*="tag" i] button','[class*="chip" i] button',
      'a[href*="remove_coupon" i]','button[data-coupon]','a[data-coupon]','button[data-coupon-code]','a[data-coupon-code]'
    ];
    for (const sel of directSel) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el) || isCartItemRemoveControl(el)) continue;
          const ctx = codeKey(contextOf(el, 3));
          const own = codeKey(textOf(el));
          let score = 0;
          if (ctx.includes(key) || own.includes(key)) score += 30;
          if (/remove|delete|clear|×|✕|✖/i.test(textOf(el)) || /remove|delete|clear/i.test(`${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${String(el.className || '')}`)) score += 20;
          if (/discount|coupon|promo|tag|chip|reduction/i.test(`${String(el.className || '')} ${contextOf(el, 2)}`)) score += 10;
          if (score >= 15) cands.push({ el, score });
        }
      } catch {}
    }
    for (const box of appliedCouponContainers(code)) {
      let p = box;
      for (let depth = 0; depth < 3 && p; depth += 1, p = p.parentElement) {
        for (const el of p.querySelectorAll?.('button,a,[role="button"],svg') || []) {
          const clickable = el.closest?.('button,a,[role="button"]') || el;
          if (!visible(clickable) || isCartItemRemoveControl(clickable)) continue;
          const txt = `${textOf(clickable)} ${String(clickable.className || '')} ${clickable.getAttribute?.('aria-label') || ''}`;
          let score = 20 - depth * 2;
          if (/remove|delete|clear|×|✕|✖|close/i.test(txt)) score += 25;
          if (codeKey(contextOf(clickable, 2)).includes(key)) score += 20;
          cands.push({ el: clickable, score });
        }
      }
      cands.push({ el: box, score: 5 });
    }
    cands.sort((a, b) => b.score - a.score);
    return [...new Set(cands.map((x) => x.el))];
  }

  function keyRemove(el) {
    try { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); el.focus(); } catch {}
    for (const key of ['Backspace','Delete','Escape']) {
      try { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); } catch {}
      try { el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true })); } catch {}
    }
  }

  async function removeCoupon(code) {
    if (!couponApplied(code)) return true;
    const beforeItems = cartItemCount();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidates = couponRemoveCandidates(code).slice(0, 8);
      for (const el of candidates) {
        if (isCartItemRemoveControl(el)) continue;
        try { fireClick(el); } catch {}
        await sleep(700);
        if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item removed while trying to remove coupon.');
        if (!couponApplied(code)) return true;
        keyRemove(el);
        await sleep(500);
        if (!couponApplied(code)) return true;
      }
      await sleep(400);
    }
    return !couponApplied(code);
  }

  async function clearExistingCoupons() {
    for (let i = 0; i < 4; i += 1) {
      const boxes = appliedCouponContainers('');
      if (!boxes.length) return true;
      const txt = clean(boxes[0].innerText || boxes[0].textContent || '');
      const code = txt.split(/\s|\(/)[0];
      if (!code) return false;
      const ok = await removeCoupon(code);
      if (!ok) return false;
    }
    return appliedCouponContainers('').length === 0;
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found.');
    const beforeSignals = collectSignals(code).all;
    await fillCoupon(input, code);
    const btn = await waitForEnabledApply(input, 3000);
    if (!btn) throw new Error('Apply coupon button not found.');
    if (isDisabled(btn)) {
      return { code, status: 'APPLY_BUTTON_DISABLED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: 'Apply button stayed disabled after entering the code.', testedAt: new Date().toISOString() };
    }
    fireClick(btn);
    const response = await waitForResult(code, baseline, beforeSignals, 6500);
    const status = classify(response.responseText, baseline, response.totals, code, response.timedOut, response.applied);
    const discount = status === 'WORKING' ? computeDiscount(baseline, response.totals, response.responseText, code) : { amount: null, percent: null };
    return {
      code, status, discountPercent: discount.percent, discountAmount: discount.amount,
      currencySymbol: response.totals.currencySymbol || baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal,
      baselineTotal: baseline.total, afterTotal: response.totals.total, message: response.responseText || (response.timedOut ? 'No response after apply.' : 'No clear response detected.'),
      testedAt: new Date().toISOString()
    };
  }

  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING');
    if (!working.length) return null;
    return working.sort((a, b) => {
      const ap = Number.isFinite(a.discountPercent) ? a.discountPercent : -1, bp = Number.isFinite(b.discountPercent) ? b.discountPercent : -1;
      if (bp !== ap) return bp - ap;
      return (Number.isFinite(b.discountAmount) ? b.discountAmount : -1) - (Number.isFinite(a.discountAmount) ? a.discountAmount : -1);
    })[0];
  }

  function notify(summary, run = null) {
    chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }).catch(() => {});
  }

  async function runTests(codes, reapplyBest) {
    if (running) throw new Error('Coupon testing is already running.');
    running = true; abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Make the field visible and try again.');
      notify('Checking existing applied coupons…');
      await clearExistingCoupons();
      const baseline = snapshotTotals();
      const baselineItems = cartItemCount();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };

      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        if (baselineItems > 0 && cartItemCount() < baselineItems) throw new Error('Safety stop: cart item count changed during coupon testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code}`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}`, run);

        const applied = result.status === 'WORKING' || couponApplied(code);
        if (applied && i < codes.length - 1) {
          notify(`${code} worked. Removing discount before next code…`, run);
          const removed = await removeCoupon(code);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be removed safely. Remove it manually before testing more codes.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed safely. Best code ${run.best?.code || code} is applied.`;
            break;
          }
        } else {
          const current = findCouponInput();
          if (current) nativeSet(current, '');
        }
      }

      run.best = chooseBest(run.results);
      if (!run.summary) run.summary = `Finished ${run.results.filter((r) => r.code !== '—').length} code(s). ${run.best ? `Best: ${run.best.code}.` : 'No working coupon detected.'}`;
      if (reapplyBest && run.best && !abortRequested) {
        notify(`Re-applying best code: ${run.best.code}`, run);
        await clearExistingCoupons();
        await applyOne(run.best.code, baseline);
        run.summary += ` Best code ${run.best.code} re-applied.`;
      }
      run.finishedAt = new Date().toISOString();
      notify(run.summary, run);
      return run;
    } finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STOP_COUPON_TESTS') { abortRequested = true; sendResponse({ ok: true }); return; }
    if (message?.type !== 'START_COUPON_TESTS') return;
    const codes = [...new Set((message.payload?.codes || []).map((v) => clean(v)).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
