(() => {
  if (window.__couponTestV4Loaded) return;
  window.__couponTestV4Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /^\s*(apply|redeem|submit|use|add)\s*$/i,
    applyLoose: /apply|redeem|submit|use\s+code|add\s+(coupon|promo|discount)/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order/i,
    removeItem: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|minimum\s+spend|spend.*(more|at\s+least)|requires?.*(minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /members?\s+only|required\s+account/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i
  };
  const TERMINAL_RE = new RegExp([RE.success.source, RE.invalid.source, RE.expired.source, RE.minimum.source, RE.eligible.source, RE.used.source, RE.login.source, RE.stack.source].join('|'), 'i');

  let running = false;
  let abortRequested = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1;
  }

  function textOf(el) {
    return clean([
      el?.getAttribute?.('aria-label'), el?.getAttribute?.('placeholder'), el?.getAttribute?.('name'),
      el?.getAttribute?.('id'), el?.getAttribute?.('title'), el?.value, el?.textContent
    ].filter(Boolean).join(' '));
  }

  function elementContext(el, depth = 4) {
    const parts = [textOf(el)];
    let node = el?.parentElement;
    for (let i = 0; i < depth && node; i += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (text && text.length < 800) parts.push(text);
    }
    if (el?.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) parts.push(clean(label.innerText || label.textContent || ''));
      } catch {}
    }
    return parts.join(' ');
  }

  function isDisabled(el) {
    if (!el) return true;
    const aria = String(el.getAttribute?.('aria-disabled') || '').toLowerCase();
    const cls = String(el.className || '').toLowerCase();
    return Boolean(el.disabled || aria === 'true' || el.getAttribute?.('disabled') !== null || /disabled|is-disabled|button--disabled/.test(cls));
  }

  function isCartItemRemove(el) {
    if (!el) return false;
    const label = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (RE.removeItem.test(label)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key/i.test(`${cls} ${href}`)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      return /\bremove\b|delete|trash|×|✕|✖/i.test(`${label} ${cls}`);
    }
    return false;
  }

  function findCouponInput() {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible);
    const scored = inputs.map((el) => {
      const own = textOf(el);
      const ctx = elementContext(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 16;
      if (RE.coupon.test(ctx)) score += 8;
      if (/code/i.test(own)) score += 4;
      if (/email|phone|postal|zip|address|search|quantity|city|state|country|name/i.test(own)) score -= 14;
      if (/discount\s*code|promo\s*code|coupon\s*code/i.test(ctx)) score += 10;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 8 ? scored[0].el : null;
  }

  function scoreApplyButton(el, input) {
    if (!visible(el) || isCartItemRemove(el)) return -999;
    const label = textOf(el);
    if (RE.danger.test(label)) return -999;
    let score = 0;
    if (RE.apply.test(label)) score += 30;
    else if (RE.applyLoose.test(label)) score += 16;
    if (RE.coupon.test(label)) score += 8;
    const inputForm = input?.closest?.('form');
    if (inputForm && el.closest?.('form') === inputForm) score += 16;
    if (input?.parentElement?.contains(el)) score += 16;
    const inputRect = input?.getBoundingClientRect?.();
    const btnRect = el.getBoundingClientRect();
    if (inputRect) {
      const xGap = Math.abs(btnRect.left - inputRect.right);
      const yGap = Math.abs((btnRect.top + btnRect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2);
      if (xGap < 260 && yGap < 80) score += 24;
      if (yGap < 30) score += 8;
    }
    if (isDisabled(el)) score -= 2;
    return score;
  }

  function findApplyButton(input) {
    const candidates = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')]
      .map((el) => ({ el, score: scoreApplyButton(el, input) }))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.score >= 14 ? candidates[0].el : null;
  }

  function nativeSetValue(input, value) {
    input.focus({ preventScroll: true });
    try { input.select?.(); } catch {}
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) || 'A' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || 'A' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function fillCoupon(input, code) {
    nativeSetValue(input, '');
    await sleep(80);
    nativeSetValue(input, code);
    await sleep(120);
    if (String(input.value || '').trim() !== code) nativeSetValue(input, code);
  }

  async function waitForEnabled(button, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!isDisabled(button)) return true;
      await sleep(150);
    }
    return !isDisabled(button);
  }

  function realClick(el) {
    if (!el) throw new Error('Apply button not found.');
    if (RE.danger.test(textOf(el)) || isCartItemRemove(el)) throw new Error('Blocked unsafe button.');
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    for (const type of ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','pointerup','mouseup','click']) {
      try {
        const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      } catch { el.dispatchEvent(new MouseEvent(type, opts)); }
    }
    try { el.click(); } catch {}
  }

  function parseMoney(raw) {
    let value = String(raw || '').replace(/[^0-9.,-]/g, '');
    if (!value) return null;
    const comma = value.lastIndexOf(',');
    const dot = value.lastIndexOf('.');
    value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }

  function moneyFromText(text) {
    const matches = [...String(text || '').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)];
    return matches.length ? parseMoney(matches[matches.length - 1][0]) : null;
  }

  function currencyFromText(text) {
    const t = String(text || '');
    if (t.includes('$')) return '$'; if (t.includes('€')) return '€'; if (t.includes('£')) return '£'; if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }

  function amountBySelectors(selectors) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent || '');
        const amount = moneyFromText(text);
        if (amount !== null) return { amount, currency: currencyFromText(text) };
      }
    }
    return null;
  }

  function amountByLabel(kind) {
    const rules = kind === 'subtotal' ? [/\bsub\s*total\b/i, /\bitems?\s+total\b/i]
      : kind === 'discount' ? [/\bdiscount\b/i, /\bcoupon\b/i, /\bpromo\b/i, /\bsavings?\b/i]
      : [/\bgrand\s+total\b/i, /\border\s+total\b/i, /^\s*total\b/i];
    const hits = [];
    for (const el of document.querySelectorAll('div,span,p,li,dt,dd,tr,td,th,strong,b')) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 220) continue;
      if (kind === 'total' && /sub\s*total/i.test(text)) continue;
      if (!rules.some((r) => r.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), score: (text.length < 90 ? 2 : 0) + (rules[0].test(text) ? 2 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshotTotals() {
    const subtotal = amountBySelectors(['.cart-subtotal .amount','.cart-subtotal .woocommerce-Price-amount','td[data-title="Subtotal"] .amount']) || amountByLabel('subtotal');
    const total = amountBySelectors(['.order-total .amount','.order-total .woocommerce-Price-amount','td[data-title="Total"] .amount']) || amountByLabel('total');
    const discount = amountBySelectors(['tr.cart-discount .amount','.cart-discount .amount','[data-title*="Discount"] .amount']) || amountByLabel('discount');
    return { subtotal: subtotal?.amount ?? null, total: total?.amount ?? null, discount: discount?.amount ?? null, currencySymbol: subtotal?.currency || total?.currency || discount?.currency || '' };
  }

  function collectMessages(code = '', input = null) {
    const out = new Set();
    const target = code.toLowerCase();
    const selectors = [
      '[role="alert"]','[aria-live]','.woocommerce-message','.woocommerce-error','.woocommerce-info',
      '.error','.errors','.success','.notice','.message','.alert','.form-error','.field-error','.invalid-feedback',
      '[class*="error"]','[class*="success"]','[class*="notice"]','[class*="message"]','[class*="coupon"]','[class*="promo"]','[class*="discount"]'
    ].join(',');
    for (const el of document.querySelectorAll(selectors)) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (text && text.length <= 500) out.add(text);
    }
    const roots = new Set();
    if (input) {
      roots.add(input.parentElement);
      roots.add(input.closest?.('form'));
      roots.add(input.closest?.('section'));
      roots.add(input.closest?.('aside'));
      let p = input.parentElement;
      for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) roots.add(p);
    }
    for (const root of roots) {
      if (!root) continue;
      for (const el of root.querySelectorAll('div,span,p,li,small,label,em,strong')) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent || '');
        if (!text || text.length > 300) continue;
        const lower = text.toLowerCase();
        if (TERMINAL_RE.test(text) || (target && lower.includes(target))) out.add(text);
      }
    }
    return [...out].slice(0, 30).join(' | ');
  }

  function couponApplied(code) {
    const target = code.toLowerCase();
    const selectors = 'tr.cart-discount,[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"],[data-coupon],[data-coupon-code]';
    for (const el of document.querySelectorAll(selectors)) {
      if (!visible(el) || isCartItemRemove(el)) continue;
      const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code')).toLowerCase();
      const text = clean(el.innerText || el.textContent || '').toLowerCase();
      if (data === target || text.includes(target)) return true;
    }
    return false;
  }

  function totalsChanged(before, after) {
    for (const key of ['total','discount']) {
      if (Number.isFinite(before[key]) && Number.isFinite(after[key]) && Math.abs(before[key] - after[key]) > 0.005) return true;
    }
    return false;
  }

  async function observeResponse(code, input, baseline, beforeMessages, timeoutMs = 6000) {
    const started = Date.now();
    let latestTotals = snapshotTotals();
    let latestMessage = '';
    const before = clean(beforeMessages);
    while (Date.now() - started < timeoutMs) {
      await sleep(350);
      latestTotals = snapshotTotals();
      latestMessage = collectMessages(code, input);
      const msg = clean(latestMessage);
      const changedMsg = msg && msg !== before;
      if (couponApplied(code) || totalsChanged(baseline, latestTotals) || (changedMsg && TERMINAL_RE.test(msg))) {
        await sleep(450);
        latestTotals = snapshotTotals();
        latestMessage = collectMessages(code, input) || latestMessage;
        return { timedOut: false, totals: latestTotals, message: latestMessage, applied: couponApplied(code) };
      }
    }
    return { timedOut: true, totals: latestTotals, message: latestMessage, applied: couponApplied(code) };
  }

  function classify(response, baseline, code) {
    const text = clean(response.message);
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.login.test(text)) return 'LOGIN_REQUIRED';
    if (RE.invalid.test(text)) return 'INVALID';
    const saved = Number.isFinite(baseline.total) && Number.isFinite(response.totals.total) && baseline.total - response.totals.total > 0.005;
    const discountRaised = Number.isFinite(response.totals.discount) && response.totals.discount - (Number.isFinite(baseline.discount) ? baseline.discount : 0) > 0.005;
    if (response.applied || saved || discountRaised || RE.success.test(text)) return 'WORKING';
    return response.timedOut ? 'NO_RESPONSE' : 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(baseline, totals, message) {
    let amount = null;
    if (Number.isFinite(baseline.total) && Number.isFinite(totals.total) && baseline.total > totals.total) amount = baseline.total - totals.total;
    else if (Number.isFinite(totals.discount)) {
      const previous = Number.isFinite(baseline.discount) ? baseline.discount : 0;
      if (totals.discount > previous) amount = totals.discount - previous;
    }
    const base = Number.isFinite(baseline.subtotal) && baseline.subtotal > 0 ? baseline.subtotal : baseline.total;
    let percent = amount !== null && Number.isFinite(base) && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const match = clean(message).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (match) percent = Number(match[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found. Make it visible and retry.');
    let button = findApplyButton(input);
    if (!button) throw new Error('Apply coupon button not found near the coupon field.');

    const beforeMessages = collectMessages('', input);
    await fillCoupon(input, code);
    button = findApplyButton(input) || button;
    const enabled = await waitForEnabled(button, 3000);
    if (!enabled) {
      return {
        code, status: 'APPLY_BUTTON_DISABLED', discountPercent: null, discountAmount: null,
        currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal,
        baselineTotal: baseline.total, afterTotal: snapshotTotals().total,
        message: 'Apply button did not become enabled after filling the coupon code.', testedAt: new Date().toISOString()
      };
    }

    realClick(button);
    const response = await observeResponse(code, input, baseline, beforeMessages, 6000);
    const status = classify(response, baseline, code);
    const discount = status === 'WORKING' ? computeDiscount(baseline, response.totals, response.message) : { amount: null, percent: null };
    return {
      code, status, discountPercent: discount.percent, discountAmount: discount.amount,
      currencySymbol: response.totals.currencySymbol || baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal,
      baselineTotal: baseline.total, afterTotal: response.totals.total,
      message: response.message || (response.timedOut ? 'No clear coupon response appeared within 6 seconds.' : 'No clear coupon response detected.'),
      responseTimedOut: response.timedOut, testedAt: new Date().toISOString()
    };
  }

  function findCouponRemove(code) {
    const target = code.toLowerCase();
    const selectors = [
      'a.woocommerce-remove-coupon','button.woocommerce-remove-coupon','[class*="woocommerce-remove-coupon"]',
      '[class*="remove-coupon"]','[class*="remove_coupon"]','a[href*="remove_coupon"]',
      'a[data-coupon][class*="remove"]','button[data-coupon][class*="remove"]','a[data-coupon-code][class*="remove"]','button[data-coupon-code][class*="remove"]'
    ].join(',');
    const candidates = [...document.querySelectorAll(selectors)].filter((el) => visible(el) && !isCartItemRemove(el));
    candidates.sort((a, b) => {
      const as = clean(`${a.getAttribute?.('data-coupon') || ''} ${a.getAttribute?.('data-coupon-code') || ''} ${a.getAttribute?.('href') || ''} ${a.closest?.('tr,[class*="coupon"],[class*="discount"]')?.innerText || ''}`).toLowerCase().includes(target) ? 1 : 0;
      const bs = clean(`${b.getAttribute?.('data-coupon') || ''} ${b.getAttribute?.('data-coupon-code') || ''} ${b.getAttribute?.('href') || ''} ${b.closest?.('tr,[class*="coupon"],[class*="discount"]')?.innerText || ''}`).toLowerCase().includes(target) ? 1 : 0;
      return bs - as;
    });
    return candidates[0] || null;
  }

  async function removeCoupon(code) {
    if (!couponApplied(code)) return true;
    const remove = findCouponRemove(code);
    if (!remove) return false;
    const beforeItems = cartItemCount();
    realClick(remove);
    await sleep(1500);
    if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item was removed instead of coupon.');
    return !couponApplied(code);
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]'];
    const items = new Set();
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el)) items.add(el);
    return items.size;
  }

  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING');
    if (!working.length) return null;
    return working.sort((a, b) => {
      const bp = Number.isFinite(b.discountPercent) ? b.discountPercent : -1;
      const ap = Number.isFinite(a.discountPercent) ? a.discountPercent : -1;
      if (bp !== ap) return bp - ap;
      const ba = Number.isFinite(b.discountAmount) ? b.discountAmount : -1;
      const aa = Number.isFinite(a.discountAmount) ? a.discountAmount : -1;
      return ba - aa;
    })[0];
  }

  function notify(summary, run = null) {
    chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }).catch(() => {});
  }

  async function runTests(codes, reapplyBest) {
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true;
    abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Make it visible and retry.');
      const baseline = snapshotTotals();
      const baselineItems = cartItemCount();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };

      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        if (baselineItems > 0 && cartItemCount() < baselineItems) throw new Error('Safety stop: cart item count changed during testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code} — filling and clicking apply...`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}`, run);
        if ((result.status === 'WORKING' || couponApplied(code)) && i < codes.length - 1) {
          notify(`${code} worked. Removing before next code...`, run);
          const removed = await removeCoupon(code);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be safely removed.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed safely.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input) nativeSetValue(input, '');
        }
      }

      run.best = chooseBest(run.results);
      if (!run.summary) run.summary = `Finished ${run.results.filter((r) => r.code !== '—').length} code(s). ${run.best ? `Best: ${run.best.code}.` : 'No working coupon detected.'}`;
      if (reapplyBest && run.best && !abortRequested) {
        notify(`Re-applying best code: ${run.best.code}`, run);
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
    const codes = [...new Set((message.payload?.codes || []).map((v) => String(v).trim()).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
