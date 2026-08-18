(() => {
  if (window.__couponTestV3Loaded) return;
  window.__couponTestV3Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order/i,
    success: /success|applied|accepted|you\s+saved|discount.*applied|coupon.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|minimum\s+spend|spend.*(more|at\s+least)|requires?.*(minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /sign\s*in|log\s*in|login|required\s+account|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i,
    itemRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i
  };
  const STATUS_RE = new RegExp([RE.success.source, RE.invalid.source, RE.expired.source, RE.minimum.source, RE.eligible.source, RE.used.source, RE.login.source, RE.stack.source].join('|'), 'i');

  let running = false;
  let abortRequested = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  function isCouponRemoveControl(el) {
    const cls = String(el?.className || '');
    const href = el?.getAttribute?.('href') || '';
    const data = el?.getAttribute?.('data-coupon') || el?.getAttribute?.('data-coupon-code') || '';
    return /woocommerce-remove-coupon|remove[-_]coupon/i.test(cls) || /remove_coupon/i.test(href) || Boolean(data && /remove/i.test(`${cls} ${href}`));
  }

  function isCartItemRemoveControl(el) {
    if (!el || isCouponRemoveControl(el)) return false;
    const own = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (RE.itemRemove.test(own)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key/i.test(`${cls} ${href}`)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (/\bremove\b|delete|trash|×|✕|✖/i.test(`${own} ${cls}`)) return true;
    }
    return false;
  }

  function setValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function safeClick(el, purpose = 'normal') {
    if (!el) throw new Error('Required button not found.');
    const label = textOf(el);
    if (RE.danger.test(label)) throw new Error(`Blocked unsafe checkout action: ${label}`);
    if (isCartItemRemoveControl(el)) throw new Error(`Blocked cart item remove control: ${label || String(el.className || '')}`);
    if (purpose === 'coupon-remove' && !isCouponRemoveControl(el) && !el.closest?.('tr.cart-discount,[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"]')) {
      throw new Error('Blocked non-coupon remove control.');
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    el.click();
  }

  function findCouponInput() {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible);
    const scored = inputs.map((el) => {
      const own = textOf(el);
      let context = own;
      let parent = el.parentElement;
      for (let i = 0; i < 3 && parent; i += 1, parent = parent.parentElement) {
        const txt = clean(parent.innerText);
        if (txt && txt.length < 700) context += ` ${txt}`;
      }
      let score = 0;
      if (RE.coupon.test(own)) score += 14;
      if (RE.coupon.test(context)) score += 7;
      if (/code/i.test(own)) score += 2;
      if (/email|phone|postal|zip|address|search|quantity/i.test(own)) score -= 12;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 6 ? scored[0].el : null;
  }

  function findApplyButton(input) {
    const controls = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible);
    const scored = controls.map((el) => {
      const text = textOf(el);
      if (RE.danger.test(text) || isCartItemRemoveControl(el)) return { el, score: -100 };
      let score = 0;
      if (RE.apply.test(text)) score += 8;
      if (RE.coupon.test(text)) score += 5;
      if (input?.form && el.closest('form') === input.form) score += 9;
      if (input?.parentElement?.contains(el)) score += 8;
      if (input && el.parentElement === input.parentElement) score += 5;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 7 ? scored[0].el : null;
  }

  function parseMoney(raw) {
    let value = String(raw || '').replace(/[^0-9.,-]/g, '');
    if (!value) return null;
    const comma = value.lastIndexOf(','), dot = value.lastIndexOf('.');
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
    if (t.includes('$')) return '$'; if (t.includes('€')) return '€'; if (t.includes('£')) return '£'; if (t.includes('¥')) return '¥'; if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }

  function firstAmount(selectors) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const text = el.innerText || el.textContent || '';
        const amount = moneyFromText(text);
        if (amount !== null) return { amount, currency: currencyFromText(text) };
      }
    }
    return null;
  }

  function fallbackAmount(kind) {
    const rules = kind === 'subtotal' ? [/sub\s*total/i, /items?\s+total/i] : [/grand\s+total/i, /order\s+total/i, /^\s*total\b/i];
    const hits = [];
    for (const el of document.querySelectorAll('div,span,p,li,dt,dd,tr,td,th,strong,b')) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 180 || (kind === 'total' && /sub\s*total/i.test(text)) || !rules.some((r) => r.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), score: (text.length < 80 ? 2 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function sumDiscounts() {
    const selectors = ['tr.cart-discount .amount','tr.cart-discount .woocommerce-Price-amount','tr[class*="cart-discount"] .amount','.cart-discount .amount','td[data-title*="Discount"] .amount'];
    const seen = new Set();
    let total = 0, found = false, currency = '';
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || seen.has(el)) continue;
        seen.add(el);
        const text = el.innerText || el.textContent || '';
        const amount = moneyFromText(text);
        if (amount !== null) { total += amount; found = true; currency ||= currencyFromText(text); }
      }
    }
    return found ? { amount: Math.round(total * 100) / 100, currency } : null;
  }

  function snapshotTotals() {
    const subtotal = firstAmount(['.cart-subtotal .amount','.cart-subtotal .woocommerce-Price-amount','td[data-title="Subtotal"] .amount']) || fallbackAmount('subtotal');
    const total = firstAmount(['.order-total .amount','.order-total .woocommerce-Price-amount','td[data-title="Total"] .amount','.cart_totals .order-total .amount']) || fallbackAmount('total');
    const discount = sumDiscounts();
    return { subtotal: subtotal?.amount ?? null, total: total?.amount ?? null, discount: discount?.amount ?? null, currencySymbol: subtotal?.currency || total?.currency || discount?.currency || '' };
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]'];
    const items = new Set();
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el)) items.add(el);
    return items.size;
  }

  function getMessageNodesNear(input) {
    const nodes = new Set();
    const globalSelectors = '[role="alert"],[aria-live],.woocommerce-message,.woocommerce-error,.woocommerce-info,.error,.errors,.success,.notice,.message,.alert,.form-error,.field-error,.invalid-feedback,[class*="error"],[class*="success"],[class*="notice"],[class*="message"]';
    for (const el of document.querySelectorAll(globalSelectors)) if (visible(el)) nodes.add(el);
    if (input) {
      let p = input.parentElement;
      for (let depth = 0; depth < 4 && p; depth += 1, p = p.parentElement) {
        for (const el of p.querySelectorAll('div,span,p,small,label,em,strong,li')) if (visible(el)) nodes.add(el);
      }
    }
    return [...nodes];
  }

  function messageSet(input) {
    const values = new Set();
    for (const el of getMessageNodesNear(input)) {
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 500) continue;
      values.add(text);
    }
    return values;
  }

  function bestMessage(newMessages, code) {
    const target = code.toLowerCase();
    const list = [...newMessages];
    const scored = list.map((msg) => {
      const lower = msg.toLowerCase();
      let score = 0;
      if (lower.includes(target)) score += 10;
      if (STATUS_RE.test(msg)) score += 8;
      if (/minimum|invalid|expired|not valid|not eligible|applied|success/i.test(msg)) score += 6;
      if (msg.length < 180) score += 2;
      if (/menu|support|contact|community|login\/register|newsletter|subscribe/i.test(msg)) score -= 20;
      return { msg, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].msg : '';
  }

  function appliedCouponElements(code = '') {
    const target = code.toLowerCase();
    const selectors = 'tr.cart-discount,tr[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"],[data-coupon],[data-coupon-code]';
    const out = [];
    for (const el of document.querySelectorAll(selectors)) {
      if (isCartItemRemoveControl(el)) continue;
      const text = clean(el.innerText || el.textContent || '').toLowerCase();
      const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code')).toLowerCase();
      if (!code || text.includes(target) || data === target) out.push(el);
    }
    return out;
  }

  function couponApplied(code) {
    return appliedCouponElements(code).length > 0;
  }

  function classify(message, before, after, code, timedOut) {
    const text = clean(message);
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.login.test(text) && !/menu|support|contact|community/i.test(text)) return 'LOGIN_REQUIRED';
    if (RE.invalid.test(text)) return 'INVALID';
    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const discountRaised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    if (couponApplied(code) || saved || discountRaised || RE.success.test(text)) return 'WORKING';
    return timedOut ? 'NO_RESPONSE' : 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(before, after, message) {
    let amount = null;
    if (Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    else if (Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : before.total;
    let percent = amount !== null && Number.isFinite(base) && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const match = clean(message).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (match) percent = Number(match[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  async function observeCouponResult({ code, input, beforeMessages, baseline, waitMs = 6000 }) {
    const started = Date.now();
    let latestMessages = new Set();
    let latestTotals = snapshotTotals();
    let best = '';
    while (Date.now() - started < waitMs) {
      await sleep(400);
      latestMessages = messageSet(input);
      latestTotals = snapshotTotals();
      const newMessages = new Set([...latestMessages].filter((msg) => !beforeMessages.has(msg)));
      best = bestMessage(newMessages, code) || best;
      if (best || couponApplied(code) || totalsChanged(baseline, latestTotals)) {
        await sleep(700);
        latestMessages = messageSet(input);
        latestTotals = snapshotTotals();
        const newer = new Set([...latestMessages].filter((msg) => !beforeMessages.has(msg)));
        best = bestMessage(newer, code) || best;
        return { timedOut: false, message: best, totals: latestTotals };
      }
    }
    const newMessages = new Set([...latestMessages].filter((msg) => !beforeMessages.has(msg)));
    return { timedOut: true, message: bestMessage(newMessages, code), totals: latestTotals };
  }

  function totalsChanged(before, after) {
    return ['subtotal', 'total', 'discount'].some((key) => Number.isFinite(before[key]) && Number.isFinite(after[key]) && Math.abs(before[key] - after[key]) > 0.005);
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found. Make coupon field visible and retry.');
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near coupon field.');
    const beforeMessages = messageSet(input);
    setValue(input, '');
    await sleep(120);
    setValue(input, code);
    safeClick(apply);
    const response = await observeCouponResult({ code, input, beforeMessages, baseline, waitMs: 6000 });
    const status = classify(response.message, baseline, response.totals, code, response.timedOut);
    const discount = status === 'WORKING' ? computeDiscount(baseline, response.totals, response.message) : { amount: null, percent: null };
    return {
      code,
      status,
      discountPercent: discount.percent,
      discountAmount: discount.amount,
      currencySymbol: response.totals.currencySymbol || baseline.currencySymbol || '',
      baselineSubtotal: baseline.subtotal,
      baselineTotal: baseline.total,
      afterTotal: response.totals.total,
      message: response.message || (response.timedOut ? 'No clear coupon response within 6 seconds.' : 'No clear success/error message was detected.'),
      responseTimedOut: response.timedOut,
      testedAt: new Date().toISOString()
    };
  }

  function directCouponRemoveControls() {
    const selectors = ['a.woocommerce-remove-coupon','button.woocommerce-remove-coupon','[class*="woocommerce-remove-coupon"]','[class*="remove-coupon"]','[class*="remove_coupon"]','a[href*="remove_coupon"]','a[data-coupon][class*="remove"]','button[data-coupon][class*="remove"]'];
    return [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))].filter((el) => visible(el) && !isCartItemRemoveControl(el));
  }

  function findCouponRemove(code) {
    const target = code.toLowerCase();
    const candidates = [];
    for (const el of directCouponRemoveControls()) {
      const data = clean(el.getAttribute?.('data-coupon') || '').toLowerCase();
      const href = decodeURIComponent(el.getAttribute?.('href') || '').toLowerCase();
      const rowText = clean(el.closest?.('tr.cart-discount,[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"]')?.innerText).toLowerCase();
      let score = 20;
      if (data === target) score += 50;
      if (href.includes(target)) score += 35;
      if (rowText.includes(target)) score += 30;
      candidates.push({ el, score });
    }
    for (const row of appliedCouponElements(code)) {
      for (const el of row.querySelectorAll('a,button,[role="button"]')) {
        if (!visible(el) || isCartItemRemoveControl(el)) continue;
        if (/remove|delete|clear|×|✕|✖/i.test(textOf(el))) candidates.push({ el, score: isCouponRemoveControl(el) ? 60 : 30 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.el || null;
  }

  async function removeCoupon(code, baseline) {
    if (!couponApplied(code)) return true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remove = findCouponRemove(code);
      if (!remove) return false;
      const beforeItems = cartItemCount();
      safeClick(remove, 'coupon-remove');
      await sleep(1400);
      if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item decreased while removing coupon.');
      if (!couponApplied(code)) return true;
      const now = snapshotTotals();
      if (Number.isFinite(baseline.total) && Number.isFinite(now.total) && Math.abs(now.total - baseline.total) < 0.02) return true;
    }
    return !couponApplied(code);
  }

  async function clearExistingCoupons() {
    for (let i = 0; i < 4; i += 1) {
      const controls = directCouponRemoveControls();
      if (!controls.length) return true;
      const beforeItems = cartItemCount();
      safeClick(controls[0], 'coupon-remove');
      await sleep(1400);
      if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item was removed instead of coupon.');
    }
    return directCouponRemoveControls().length === 0;
  }

  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING');
    if (!working.length) return null;
    return working.sort((a, b) => {
      const ap = Number.isFinite(a.discountPercent) ? a.discountPercent : -1;
      const bp = Number.isFinite(b.discountPercent) ? b.discountPercent : -1;
      if (bp !== ap) return bp - ap;
      return (Number.isFinite(b.discountAmount) ? b.discountAmount : -1) - (Number.isFinite(a.discountAmount) ? a.discountAmount : -1);
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
      notify('Checking for existing applied coupons…');
      const cleaned = await clearExistingCoupons();
      if (!cleaned) throw new Error('Existing coupon could not be removed safely. Remove it manually and retry.');
      const baseline = snapshotTotals();
      const baselineItems = cartItemCount();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };

      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        if (baselineItems > 0 && cartItemCount() < baselineItems) throw new Error('Safety stop: cart item count changed during testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code} — waiting up to 6s`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}`, run);

        if ((result.status === 'WORKING' || couponApplied(code)) && i < codes.length - 1) {
          notify(`${code} worked. Removing before next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be safely removed.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed safely.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input) setValue(input, '');
          await sleep(250);
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
