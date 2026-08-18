(() => {
  if (window.__couponTestV5Loaded) return;
  window.__couponTestV5Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /enter\s+a\s+valid\s+discount\s+code|invalid|not\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|minimum\s+spend|spend.*(more|at\s+least)|requires?.*(minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /sign\s*in\s+to\s+use|log\s*in\s+to\s+use|required\s+account|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i,
    itemRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i
  };
  const STATUS_SIGNAL = new RegExp([RE.success.source, RE.invalid.source, RE.expired.source, RE.minimum.source, RE.eligible.source, RE.used.source, RE.login.source, RE.stack.source].join('|'), 'i');

  let running = false;
  let abortRequested = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1;
  }

  function textOf(el) {
    return clean([
      el?.getAttribute?.('aria-label'), el?.getAttribute?.('placeholder'), el?.getAttribute?.('name'),
      el?.getAttribute?.('id'), el?.getAttribute?.('title'), el?.textContent
    ].filter(Boolean).join(' '));
  }

  function contextOf(el) {
    let out = textOf(el);
    let p = el?.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      const t = clean(p.innerText || '');
      if (t && t.length < 600) out += ` ${t}`;
    }
    return out;
  }

  function findCouponInput() {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible);
    const scored = inputs.map((el) => {
      const own = textOf(el);
      const ctx = contextOf(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 16;
      if (RE.coupon.test(ctx)) score += 7;
      if (/code/i.test(own)) score += 4;
      if (/email|phone|postal|zip|address|search|quantity|city|state|first\s*name|last\s*name/i.test(own)) score -= 18;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 6 ? scored[0].el : null;
  }

  function isCartItemRemoveControl(el) {
    if (!el) return false;
    const t = `${textOf(el)} ${el.getAttribute?.('href') || ''} ${String(el.className || '')}`;
    if (/remove_coupon|woocommerce-remove-coupon|remove[-_]coupon/i.test(t)) return false;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key/i.test(t)) return true;
    if (el.closest?.('.product-remove,.cart_item,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]') && RE.itemRemove.test(t)) return true;
    return false;
  }

  function findApplyButton(input) {
    const buttons = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible);
    const inputRect = input.getBoundingClientRect();
    const scored = buttons.map((el) => {
      const t = textOf(el);
      if (RE.danger.test(t) || isCartItemRemoveControl(el)) return { el, score: -999 };
      const rect = el.getBoundingClientRect();
      const dx = Math.abs((rect.left + rect.right) / 2 - (inputRect.left + inputRect.right) / 2);
      const dy = Math.abs((rect.top + rect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2);
      let score = 0;
      if (RE.apply.test(t)) score += 18;
      if (RE.coupon.test(t)) score += 6;
      if (input.form && el.closest('form') === input.form) score += 12;
      if (input.parentElement?.contains(el)) score += 10;
      if (dy < 80) score += 8;
      if (dx < 600) score += 3;
      if (/checkout|paypal|pay\s+later|apple\s*pay|google\s*pay/i.test(t)) score -= 100;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 10 ? scored[0].el : null;
  }

  function isDisabled(el) {
    return Boolean(el?.disabled || el?.getAttribute?.('disabled') !== null || el?.getAttribute?.('aria-disabled') === 'true' || /disabled/i.test(String(el?.className || '')));
  }

  function setInputValue(input, value) {
    input.focus();
    input.click();
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) || 'A' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || 'A' }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function waitForButtonEnabled(button, timeout = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!isDisabled(button)) return true;
      await sleep(100);
    }
    return !isDisabled(button);
  }

  function clickElement(el) {
    if (!el) throw new Error('Apply button not found.');
    if (RE.danger.test(textOf(el))) throw new Error('Blocked unsafe checkout/payment button.');
    if (isCartItemRemoveControl(el)) throw new Error('Blocked cart item remove control.');
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const opts = { bubbles: true, cancelable: true, view: window, clientX: el.getBoundingClientRect().left + 5, clientY: el.getBoundingClientRect().top + 5 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.click();
  }

  function parseMoney(raw) {
    const s0 = String(raw || '').replace(/[^0-9.,-]/g, '');
    if (!s0) return null;
    const c = s0.lastIndexOf(','), d = s0.lastIndexOf('.');
    const s = c > d ? s0.replace(/\./g, '').replace(',', '.') : s0.replace(/,/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }

  function moneyMatches(text) {
    return [...String(text || '').matchAll(/(?:[-+]?\s*)?(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)?/gi)].map((m) => parseMoney(m[0])).filter((n) => Number.isFinite(n));
  }

  function amountFromText(text) {
    const money = moneyMatches(text);
    return money.length ? money[money.length - 1] : null;
  }

  function currencyFromText(text) {
    const t = String(text || '');
    if (t.includes('$')) return '$'; if (t.includes('€')) return '€'; if (t.includes('£')) return '£'; if (t.includes('¥')) return '¥'; if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }

  function findAmountByLabel(labels) {
    const nodes = [...document.querySelectorAll('div,span,p,li,tr,td,th,strong,b')].filter(visible);
    const hits = [];
    for (const node of nodes) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text || text.length > 180) continue;
      if (!labels.some((re) => re.test(text))) continue;
      const amount = amountFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), text, score: text.length < 80 ? 2 : 0 });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshotTotals() {
    const subtotal = findAmountByLabel([/\bsub\s*total\b/i]);
    const total = findAmountByLabel([/\bgrand\s+total\b/i, /\border\s+total\b/i, /^total\b/i]);
    const discount = findAmountByLabel([/\bdiscount\b/i, /\bcoupon\b/i, /\bpromo\b/i]);
    return {
      subtotal: subtotal?.amount ?? null,
      total: total?.amount ?? null,
      discount: discount?.amount ?? null,
      currencySymbol: subtotal?.currency || total?.currency || discount?.currency || ''
    };
  }

  function getRelevantTextSet(code = '', input = null) {
    const target = code.toLowerCase();
    const out = new Set();
    const selectors = [
      '[role="alert"]','[aria-live]','.error','.errors','.success','.notice','.message','.alert','.invalid-feedback',
      '[class*="error"]','[class*="success"]','[class*="notice"]','[class*="message"]','[class*="coupon"]','[class*="promo"]','[class*="discount"]',
      'div','span','p','li','small','label','strong','em','tr','td'
    ];
    const nodes = new Set();
    for (const s of selectors) for (const el of document.querySelectorAll(s)) nodes.add(el);
    if (input) {
      let p = input.parentElement;
      for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) for (const el of p.querySelectorAll('*')) nodes.add(el);
    }
    for (const el of nodes) {
      if (!visible(el) || ['INPUT','TEXTAREA','SCRIPT','STYLE'].includes(el.tagName)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 280) continue;
      const lower = text.toLowerCase();
      if (STATUS_SIGNAL.test(text) || (target && lower.includes(target))) out.add(text);
    }
    return out;
  }

  function bestResponse(texts, code) {
    const target = code.toLowerCase();
    const list = [...texts].filter(Boolean);
    const withCode = list.filter((t) => t.toLowerCase().includes(target));
    const terminal = list.filter((t) => STATUS_SIGNAL.test(t));
    const workingLine = withCode.find((t) => /\(\s*[-–—]?\s*[$€£¥₹]?\s*\d|[-–—]\s*[$€£¥₹]?\s*\d|discount/i.test(t));
    return workingLine || terminal[0] || withCode[0] || list[0] || '';
  }

  function totalsChanged(before, after) {
    return ['subtotal','total','discount'].some((k) => Number.isFinite(before[k]) && Number.isFinite(after[k]) && Math.abs(before[k] - after[k]) > 0.005);
  }

  function couponLineApplied(responseText, code) {
    const t = clean(responseText).toLowerCase();
    const target = code.toLowerCase();
    if (!target || !t.includes(target)) return false;
    return /\(\s*[-–—]?\s*[$€£¥₹]?\s*\d|[-–—]\s*[$€£¥₹]?\s*\d|discount|applied|saved/.test(t);
  }

  async function waitForCouponResponse({ code, beforeSet, beforeTotals, input, timeoutMs = 7000 }) {
    const start = Date.now();
    let last = { text: '', totals: snapshotTotals(), timedOut: false };
    let stableSince = 0, lastSignature = '';

    while (Date.now() - start < timeoutMs) {
      await sleep(180);
      const afterSet = getRelevantTextSet(code, input);
      const newSet = new Set([...afterSet].filter((t) => !beforeSet.has(t)));
      const text = bestResponse(newSet.size ? newSet : afterSet, code);
      const totals = snapshotTotals();
      const concrete = couponLineApplied(text, code) || STATUS_SIGNAL.test(text) || totalsChanged(beforeTotals, totals);
      last = { text, totals, timedOut: false };
      if (concrete) {
        const signature = `${text}|${totals.subtotal}|${totals.total}|${totals.discount}`;
        if (signature !== lastSignature) { lastSignature = signature; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 300) return last;
      } else {
        stableSince = 0;
      }
    }
    last.timedOut = true;
    return last;
  }

  function classify(text, before, after, code, timedOut) {
    if (couponLineApplied(text, code) || totalsChanged(before, after) || RE.success.test(text)) return 'WORKING';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.login.test(text)) return 'LOGIN_REQUIRED';
    if (RE.invalid.test(text)) return 'INVALID';
    return timedOut ? 'NO_RESPONSE' : 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(before, after, text) {
    let amount = null;
    if (Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    else if (Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    if (amount === null) {
      const m = clean(text).match(/\(\s*[-–—]?\s*([$€£¥₹])?\s*(\d[\d.,]*)\s*\)/) || clean(text).match(/[-–—]\s*([$€£¥₹])?\s*(\d[\d.,]*)/);
      if (m) amount = parseMoney(m[2]);
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : (Number.isFinite(before.total) ? before.total : null);
    const percent = amount !== null && base ? Math.round((amount / base) * 10000) / 100 : null;
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent };
  }

  function directCouponRemoveControls() {
    const selectors = ['a.woocommerce-remove-coupon','button.woocommerce-remove-coupon','[class*="woocommerce-remove-coupon"]','[class*="remove-coupon"]','[class*="remove_coupon"]','a[href*="remove_coupon"]','a[data-coupon][class*="remove"]','button[data-coupon][class*="remove"]'];
    return [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))].filter((el) => visible(el) && !isCartItemRemoveControl(el));
  }

  function findCouponRemove(code) {
    const target = code.toLowerCase();
    const candidates = directCouponRemoveControls().map((el) => {
      const data = clean(el.getAttribute?.('data-coupon')).toLowerCase();
      const href = decodeURIComponent(el.getAttribute?.('href') || '').toLowerCase();
      const row = clean(el.closest?.('tr,[class*="coupon"],[class*="discount"],[class*="promo"]')?.innerText).toLowerCase();
      let score = 20;
      if (data === target) score += 40;
      if (href.includes(target)) score += 30;
      if (row.includes(target)) score += 25;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return candidates[0]?.el || null;
  }

  function cartItemCount() {
    const items = new Set();
    for (const s of ['tr.cart_item','.cart_item','[data-cart-item-key]','[class*="cart-item"],[class*="line-item"]']) {
      for (const el of document.querySelectorAll(s)) if (visible(el)) items.add(el);
    }
    return items.size;
  }

  async function removeCoupon(code, baseline) {
    const remove = findCouponRemove(code);
    if (!remove) return false;
    const beforeItems = cartItemCount();
    clickElement(remove);
    await sleep(900);
    if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item removed while removing coupon.');
    return true;
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found. Make it visible and retry.');
    const button = findApplyButton(input);
    if (!button) throw new Error('Apply coupon button not found near the coupon field.');

    const beforeSet = getRelevantTextSet(code, input);
    setInputValue(input, '');
    await sleep(80);
    setInputValue(input, code);
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    const enabled = await waitForButtonEnabled(button, 2500);
    if (!enabled) {
      return { code, status: 'APPLY_BUTTON_DISABLED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: baseline.total, message: 'Apply button stayed disabled after filling the coupon code.', testedAt: new Date().toISOString() };
    }

    clickElement(button);
    const response = await waitForCouponResponse({ code, beforeSet, beforeTotals: baseline, input, timeoutMs: 7000 });
    const status = classify(response.text, baseline, response.totals, code, response.timedOut);
    const discount = status === 'WORKING' ? computeDiscount(baseline, response.totals, response.text) : { amount: null, percent: null };
    return {
      code,
      status,
      discountPercent: discount.percent,
      discountAmount: discount.amount,
      currencySymbol: response.totals.currencySymbol || baseline.currencySymbol || '',
      baselineSubtotal: baseline.subtotal,
      baselineTotal: baseline.total,
      afterTotal: response.totals.total,
      message: response.text || (response.timedOut ? 'No clear coupon response appeared before timeout.' : 'No clear success/error message was detected.'),
      responseTimedOut: response.timedOut,
      testedAt: new Date().toISOString()
    };
  }

  function chooseBest(results) {
    return results.filter((r) => r.status === 'WORKING').sort((a, b) => {
      const bp = Number.isFinite(b.discountPercent) ? b.discountPercent : -1;
      const ap = Number.isFinite(a.discountPercent) ? a.discountPercent : -1;
      if (bp !== ap) return bp - ap;
      return (Number.isFinite(b.discountAmount) ? b.discountAmount : -1) - (Number.isFinite(a.discountAmount) ? a.discountAmount : -1);
    })[0] || null;
  }

  function notify(summary, run = null) {
    chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }).catch(() => {});
  }

  async function runTests(codes, reapplyBest) {
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true;
    abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Make it visible and try again.');
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
        if (result.status === 'WORKING' && i < codes.length - 1) {
          notify(`${code} worked. Trying to remove before next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be safely removed. Remove it manually before testing more codes.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed safely.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input) setInputValue(input, '');
        }
        await sleep(250);
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
    } finally {
      running = false;
    }
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
