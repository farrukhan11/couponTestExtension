(() => {
  if (window.__couponTestV2Loaded) return;
  window.__couponTestV2Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|use\s*code|apply\s*code/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|not\s+found|cannot\s+be\s+found|couldn['’]?t\s+find/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum\s+(?:spend|order)|min\.?\s*(?:spend|order)|spend.*(?:more|at\s+least)|requires?.*(?:minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(?:item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /(?:sign|log)\s*in\s+(?:to|required)|login\s+required|account\s+required|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(?:promo|coupon|discount)/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(?:purchase|order)|buy\s*now|confirm\s*order/i,
    itemRemove: /remove\s*(?:this\s*)?(?:item|product)|delete\s*(?:this\s*)?(?:item|product)|remove\s+from\s+cart|trash/i
  };

  const TERMINAL_RE = new RegExp([
    RE.success.source, RE.invalid.source, RE.expired.source, RE.minimum.source,
    RE.eligible.source, RE.used.source, RE.login.source, RE.stack.source
  ].join('|'), 'i');

  let running = false;
  let abortRequested = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
  }

  function textOf(el) {
    return clean([
      el?.getAttribute?.('aria-label'), el?.getAttribute?.('placeholder'), el?.getAttribute?.('name'),
      el?.getAttribute?.('id'), el?.getAttribute?.('title'), el?.textContent
    ].filter(Boolean).join(' '));
  }

  function contextOf(el) {
    const parts = [textOf(el)];
    let p = el?.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      const t = clean(p.innerText);
      if (t && t.length < 500) parts.push(t);
    }
    return parts.join(' ');
  }

  function findCouponInput() {
    const candidates = [...document.querySelectorAll('input:not([type="hidden"]),textarea')]
      .filter(visible)
      .map((el) => {
        const own = textOf(el);
        const ctx = contextOf(el);
        let score = 0;
        if (RE.coupon.test(own)) score += 16;
        if (RE.coupon.test(ctx)) score += 6;
        if (/code/i.test(own)) score += 3;
        if (/email|phone|postal|zip|address|search|quantity|qty/i.test(own)) score -= 15;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.score >= 6 ? candidates[0].el : null;
  }

  function isCouponRemoveControl(el) {
    if (!el) return false;
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    const data = el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code') || '';
    return /woocommerce-remove-coupon|remove[-_]coupon|coupon[-_]remove/i.test(cls)
      || /remove_coupon|remove-coupon/i.test(href)
      || Boolean(data && /remove|delete|clear/i.test(`${cls} ${href} ${textOf(el)}`));
  }

  function isCartItemRemoveControl(el) {
    if (!el || isCouponRemoveControl(el)) return false;
    const own = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (RE.itemRemove.test(own)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key|product-remove/i.test(`${cls} ${href}`)) return true;
    const row = el.closest?.('.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]');
    return Boolean(row && /\bremove\b|delete|trash|×|✕|✖/i.test(`${own} ${cls}`));
  }

  function findApplyButton(input) {
    const controls = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')]
      .filter(visible)
      .map((el) => {
        const t = textOf(el);
        if (RE.danger.test(t) || isCartItemRemoveControl(el)) return { el, score: -100 };
        let score = RE.apply.test(t) ? 10 : 0;
        if (RE.coupon.test(t)) score += 6;
        if (input?.form && el.closest('form') === input.form) score += 6;
        if (input?.parentElement?.contains(el)) score += 8;
        if (input && el.parentElement === input.parentElement) score += 6;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);
    return controls[0]?.score >= 10 ? controls[0].el : null;
  }

  function setValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function safeClick(el, purpose = 'normal') {
    if (!el) throw new Error('Required control was not found.');
    const t = textOf(el);
    if (RE.danger.test(t)) throw new Error(`Blocked unsafe checkout action: ${t}`);
    if (isCartItemRemoveControl(el)) throw new Error('Blocked cart item removal control.');
    if (purpose === 'coupon-remove' && !isCouponRemoveControl(el) && !el.closest?.('tr.cart-discount,[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"]')) {
      throw new Error('Blocked non-coupon remove control.');
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    el.click();
  }

  function parseMoney(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/[^0-9.,-]/g, '');
    if (!s) return null;
    const comma = s.lastIndexOf(',');
    const dot = s.lastIndexOf('.');
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }

  function moneyFromText(text) {
    const matches = [...String(text || '').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)];
    return matches.length ? parseMoney(matches[matches.length - 1][0]) : null;
  }

  function currencyFromText(text) {
    const t = String(text || '');
    if (t.includes('$')) return '$';
    if (t.includes('€')) return '€';
    if (t.includes('£')) return '£';
    if (t.includes('¥')) return '¥';
    if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }

  function firstAmount(selectors) {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent);
        const amount = moneyFromText(text);
        if (amount !== null) return { amount, currency: currencyFromText(text) };
      }
    }
    return null;
  }

  function amountByLabel(patterns) {
    const hits = [];
    for (const el of document.querySelectorAll('tr,li,div,section,dl,dt,dd,p')) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent);
      if (!text || text.length > 180 || !patterns.some((re) => re.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount === null) continue;
      hits.push({ amount, currency: currencyFromText(text), score: (text.length < 90 ? 2 : 0) + (patterns[0].test(text) ? 3 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshotTotals() {
    const subtotal = firstAmount([
      '.cart-subtotal .woocommerce-Price-amount','.cart-subtotal .amount','td[data-title="Subtotal"] .woocommerce-Price-amount',
      '[class*="subtotal"] [class*="amount"]','[class*="subtotal"] .price'
    ]) || amountByLabel([/\bsub\s*total\b/i,/\bitems?\s+total\b/i]);
    const total = firstAmount([
      '.order-total .woocommerce-Price-amount','.order-total .amount','td[data-title="Total"] .woocommerce-Price-amount',
      '[class*="order-total"] [class*="amount"]','[class*="grand-total"] [class*="amount"]'
    ]) || amountByLabel([/\bgrand\s+total\b/i,/\border\s+total\b/i,/^\s*total\b/i]);
    const discount = firstAmount([
      'tr.cart-discount .woocommerce-Price-amount','tr[class*="cart-discount"] .amount','.cart-discount .woocommerce-Price-amount',
      '[class*="discount"] [class*="amount"]','[class*="coupon"] [class*="amount"]'
    ]);
    return {
      subtotal: subtotal?.amount ?? null,
      total: total?.amount ?? null,
      discount: discount?.amount ?? null,
      currencySymbol: subtotal?.currency || total?.currency || discount?.currency || ''
    };
  }

  function totalsChanged(before, after) {
    return ['subtotal','total','discount'].some((key) =>
      Number.isFinite(before[key]) && Number.isFinite(after[key]) && Math.abs(before[key] - after[key]) > 0.005
    );
  }

  function responseRoot(input) {
    return input?.closest?.('form') || input?.parentElement?.parentElement || input?.parentElement || document.body;
  }

  function responseLike(text, code = '') {
    const t = clean(text);
    if (!t || t.length > 350) return false;
    if (code && t.toLowerCase().includes(code.toLowerCase())) return true;
    return TERMINAL_RE.test(t) && /coupon|promo|discount|code|voucher|minimum|eligible|valid|expired|applied|combine|account|member/i.test(t);
  }

  function collectResponseSet(input, code = '') {
    const out = new Set();
    const explicitSelectors = [
      '[role="alert"]','[aria-live="assertive"]','[aria-live="polite"]',
      '.woocommerce-error','.woocommerce-message','.woocommerce-info',
      '.wc-block-components-notice-banner','.alert','.form-error','.field-error','.invalid-feedback',
      '[class*="coupon-error"]','[class*="promo-error"]','[class*="discount-error"]',
      '[class*="coupon-message"]','[class*="promo-message"]','[class*="discount-message"]'
    ];

    for (const selector of explicitSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent);
        if (text && text.length <= 500) out.add(text);
      }
    }

    const root = responseRoot(input);
    if (root) {
      const localSelector = 'div,span,p,small,li,label,em,strong';
      for (const el of root.querySelectorAll(localSelector)) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent);
        if (responseLike(text, code)) out.add(text);
      }
    }
    return out;
  }

  function bestResponse(messages, code = '') {
    const items = [...messages].map((text) => {
      let score = 0;
      if (code && text.toLowerCase().includes(code.toLowerCase())) score += 8;
      if (TERMINAL_RE.test(text)) score += 10;
      if (/minimum|invalid|expired|eligible|applied|success|combine|used/i.test(text)) score += 5;
      score += Math.max(0, 4 - Math.floor(text.length / 100));
      return { text, score };
    }).sort((a, b) => b.score - a.score);
    return items[0]?.text || '';
  }

  function isResponseMutation(record, input, code) {
    const nodes = [];
    if (record.target) nodes.push(record.target);
    for (const n of record.addedNodes || []) nodes.push(n);
    for (const node of nodes) {
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el) continue;
      const text = clean(el.innerText || el.textContent);
      const cls = String(el.className || '');
      const role = el.getAttribute?.('role') || '';
      const ariaLive = el.getAttribute?.('aria-live') || '';
      if (/alert|status/i.test(role) || /assertive|polite/i.test(ariaLive)) return true;
      if (/error|success|notice|message|coupon|promo|discount|invalid/i.test(cls) && responseLike(text, code)) return true;
      if (text.length <= 350 && responseLike(text, code)) {
        const root = responseRoot(input);
        if (root?.contains(el)) return true;
      }
    }
    return false;
  }

  function startResponseObserver(input, code) {
    const root = responseRoot(input);
    const state = { responseMutated: false, count: 0, lastMutationAt: 0 };
    const observer = new MutationObserver((records) => {
      state.count += records.length;
      state.lastMutationAt = Date.now();
      if (records.some((record) => isResponseMutation(record, input, code))) state.responseMutated = true;
    });
    try { observer.observe(root || document.body, { subtree: true, childList: true, characterData: true, attributes: true }); } catch {}
    return { state, stop: () => observer.disconnect() };
  }

  function appliedCouponElements(code = '') {
    const target = code.toLowerCase();
    const selectors = [
      'tr.cart-discount','[class*="cart-discount"]','[class*="applied-coupon"]','[class*="coupon-code"]',
      '[data-coupon]','[data-coupon-code]'
    ];
    const out = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || isCartItemRemoveControl(el)) continue;
        const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code')).toLowerCase();
        const text = clean(el.innerText || el.textContent).toLowerCase();
        if (!code || data === target || text.includes(target)) out.push(el);
      }
    }
    return [...new Set(out)];
  }

  const couponApplied = (code) => appliedCouponElements(code).length > 0;

  async function waitForCouponResult({ code, input, baseline, beforeSet, tracker, timeoutMs = 10000, minWaitMs = 1500 }) {
    const started = Date.now();
    let stableSince = 0;
    let latestSet = collectResponseSet(input, code);
    let latestTotals = snapshotTotals();

    while (Date.now() - started < timeoutMs) {
      await sleep(250);
      latestSet = collectResponseSet(input, code);
      latestTotals = snapshotTotals();
      const applied = couponApplied(code);
      const newMessages = new Set([...latestSet].filter((text) => !beforeSet.has(text)));
      const responseText = bestResponse(newMessages.size ? newMessages : latestSet, code);
      const terminalText = Boolean(responseText && TERMINAL_RE.test(responseText));
      const responseChanged = newMessages.size > 0 || tracker.state.responseMutated;
      const concreteResult = applied || totalsChanged(baseline, latestTotals) || (terminalText && responseChanged);
      const minWaitPassed = Date.now() - started >= minWaitMs;

      if (minWaitPassed && concreteResult) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 600) {
          return { timedOut: false, responseText, totals: latestTotals, applied };
        }
      } else {
        stableSince = 0;
      }
    }

    const newMessages = new Set([...latestSet].filter((text) => !beforeSet.has(text)));
    return {
      timedOut: true,
      responseText: bestResponse(newMessages, code),
      totals: latestTotals,
      applied: couponApplied(code)
    };
  }

  function classify(responseText, before, after, code, timedOut, applied) {
    const text = clean(responseText);
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.login.test(text)) return 'LOGIN_REQUIRED';
    if (RE.invalid.test(text)) return 'INVALID';

    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const discountRaised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    if (applied || saved || discountRaised || RE.success.test(text)) return 'WORKING';
    if (timedOut) return 'NO_RESPONSE';
    return 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(before, after, responseText) {
    let amount = null;
    if (Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    else if (Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : before.total;
    let percent = amount !== null && Number.isFinite(base) && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const m = clean(responseText).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (m) percent = Number(m[1]);
    }
    return {
      amount: amount !== null ? Math.round(amount * 100) / 100 : null,
      percent: percent !== null ? Math.round(percent * 100) / 100 : null
    };
  }

  function directCouponRemoveControls() {
    const selectors = [
      'a.woocommerce-remove-coupon','button.woocommerce-remove-coupon','[class*="woocommerce-remove-coupon"]',
      '[class*="remove-coupon"]','[class*="remove_coupon"]','a[href*="remove_coupon"]',
      'a[data-coupon][class*="remove"]','button[data-coupon][class*="remove"]',
      'a[data-coupon-code][class*="remove"]','button[data-coupon-code][class*="remove"]'
    ];
    return [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))]
      .filter((el) => visible(el) && !isCartItemRemoveControl(el));
  }

  function findCouponRemove(code) {
    const target = code.toLowerCase();
    const candidates = [];
    for (const el of directCouponRemoveControls()) {
      const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code')).toLowerCase();
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
        const t = textOf(el);
        if (/remove|delete|clear|×|✕|✖/i.test(t)) candidates.push({ el, score: isCouponRemoveControl(el) ? 60 : 30 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.el || null;
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]'];
    const items = new Set();
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el)) items.add(el);
    return items.size;
  }

  async function removeCoupon(code, baseline) {
    const remove = findCouponRemove(code);
    if (!remove) return false;
    const beforeItems = cartItemCount();
    safeClick(remove, 'coupon-remove');
    const started = Date.now();
    while (Date.now() - started < 8000) {
      await sleep(300);
      const afterItems = cartItemCount();
      if (beforeItems > 0 && afterItems < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
      const totals = snapshotTotals();
      const restored = Number.isFinite(baseline.total) && Number.isFinite(totals.total) && Math.abs(totals.total - baseline.total) < 0.02;
      if (!couponApplied(code) && (restored || !Number.isFinite(baseline.total) || !Number.isFinite(totals.total))) return true;
      if (!couponApplied(code) && Date.now() - started > 1500) return true;
    }
    return !couponApplied(code);
  }

  async function clearExistingCoupons() {
    for (let i = 0; i < 5; i += 1) {
      const controls = directCouponRemoveControls();
      if (!controls.length) return true;
      safeClick(controls[0], 'coupon-remove');
      await sleep(1200);
    }
    return directCouponRemoveControls().length === 0;
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found on this page.');
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near the coupon field.');

    setValue(input, '');
    await sleep(150);
    setValue(input, code);
    await sleep(150);

    const beforeSet = collectResponseSet(input, code);
    const tracker = startResponseObserver(input, code);
    try {
      safeClick(apply);
      const response = await waitForCouponResult({ code, input, baseline, beforeSet, tracker, timeoutMs: 10000, minWaitMs: 1500 });
      const status = classify(response.responseText, baseline, response.totals, code, response.timedOut, response.applied);
      const discount = status === 'WORKING' ? computeDiscount(baseline, response.totals, response.responseText) : { amount: null, percent: null };
      return {
        code,
        status,
        discountPercent: discount.percent,
        discountAmount: discount.amount,
        currencySymbol: response.totals.currencySymbol || baseline.currencySymbol || '',
        baselineSubtotal: baseline.subtotal,
        baselineTotal: baseline.total,
        afterTotal: response.totals.total,
        message: response.responseText || (response.timedOut ? 'No clear coupon response appeared within 10 seconds.' : 'Coupon response could not be classified.'),
        responseTimedOut: response.timedOut,
        testedAt: new Date().toISOString()
      };
    } finally {
      tracker.stop();
    }
  }

  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING');
    if (!working.length) return null;
    return [...working].sort((a, b) => {
      const ap = Number.isFinite(a.discountPercent) ? a.discountPercent : -1;
      const bp = Number.isFinite(b.discountPercent) ? b.discountPercent : -1;
      if (bp !== ap) return bp - ap;
      return (Number.isFinite(b.discountAmount) ? b.discountAmount : -1) - (Number.isFinite(a.discountAmount) ? a.discountAmount : -1);
    })[0];
  }

  function notify(summary, run = null) {
    try { chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }); } catch {}
  }

  async function runTests(codes, reapplyBest) {
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true;
    abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Make it visible and try again.');
      notify('Checking for an already-applied coupon…');
      const cleaned = await clearExistingCoupons();
      if (!cleaned) throw new Error('An existing coupon could not be safely removed. Remove it manually and retry.');

      const baseline = snapshotTotals();
      const baselineItems = cartItemCount();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };

      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        if (baselineItems > 0 && cartItemCount() < baselineItems) throw new Error('Safety stop: cart item count changed during testing.');

        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code} — waiting for store response…`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}${result.message ? ` — ${result.message}` : ''}`, run);

        if (result.status === 'WORKING' && i < codes.length - 1) {
          notify(`${code} worked. Removing it before testing the next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            run.results.push({
              code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null,
              currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal,
              baselineTotal: baseline.total, afterTotal: snapshotTotals().total,
              message: `Working coupon ${code} could not be safely removed.`, testedAt: new Date().toISOString()
            });
            run.summary = `Stopped because ${code} could not be safely removed.`;
            break;
          }
        } else {
          const currentInput = findCouponInput();
          if (currentInput) setValue(currentInput, '');
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
    if (message?.type === 'STOP_COUPON_TESTS') {
      abortRequested = true;
      sendResponse({ ok: true });
      return;
    }
    if (message?.type !== 'START_COUPON_TESTS') return;

    const codes = [...new Set((message.payload?.codes || []).map((v) => String(v).trim()).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
