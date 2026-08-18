(() => {
  if (window.__couponTestV7Loaded) return;
  window.__couponTestV7Loaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let running = false;
  let abortRequested = false;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order|checkout|check\s*out/i,
    itemRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|spend.*(more|at\s+least)|requires?.*(minimum|order)|minimum\s+spend/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i
  };

  function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
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
    let out = textOf(el);
    let p = el?.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      const t = clean(p.innerText || '');
      if (t && t.length < 650) out += ` ${t}`;
    }
    return out;
  }
  function normalizeCode(code) { return clean(code).toLowerCase(); }
  function containsCode(text, code) { return clean(text).toLowerCase().includes(normalizeCode(code)); }

  function isCartItemRemoveControl(el) {
    if (!el) return false;
    const own = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (RE.itemRemove.test(own)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key|product-remove/i.test(`${cls} ${href}`)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (/\bremove\b|delete|trash|×|✕|✖/i.test(`${own} ${cls}`)) return true;
    }
    return false;
  }
  function unsafeNavigationControl(el) {
    const text = textOf(el);
    const href = el?.getAttribute?.('href') || '';
    if (RE.danger.test(text)) return true;
    if (/facebook|instagram|youtube|tiktok|pinterest|twitter|linkedin|mailto:|tel:/i.test(`${text} ${href}`)) return true;
    if (/\/pages\/|\/blogs\/|\/policies\/|\/collections\//i.test(href)) return true;
    return false;
  }
  function safeClick(el, purpose = 'normal') {
    if (!el || !visible(el)) return false;
    if (isCartItemRemoveControl(el)) return false;
    if (purpose !== 'coupon-remove' && unsafeNavigationControl(el)) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    try { el.click(); } catch {}
    return true;
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
    const matches = [...String(text || '').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)];
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
        const text = clean(el.innerText || el.textContent || '');
        const amount = moneyFromText(text);
        if (amount !== null) return { amount, currency: currencyFromText(text) };
      }
    }
    return null;
  }
  function fallbackAmountByLabel(kind) {
    const rules = kind === 'subtotal' ? [/\bsub\s*total\b/i, /\bitems?\s+total\b/i]
      : [/\bgrand\s+total\b/i, /\border\s+total\b/i, /^\s*total\b/i];
    const hits = [];
    for (const el of document.querySelectorAll('div,span,p,li,dt,dd,tr,td,th,strong,b')) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 180 || (kind === 'total' && /sub\s*total/i.test(text)) || !rules.some((r) => r.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), score: (text.length < 80 ? 2 : 0) + (rules[0].test(text) ? 2 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }
  function snapshotTotals() {
    const subtotal = firstAmount(['.cart-subtotal .amount','.cart-subtotal .woocommerce-Price-amount','[class*="subtotal" i] [class*="amount" i]','[data-testid*="subtotal" i]']) || fallbackAmountByLabel('subtotal');
    const total = firstAmount(['.order-total .amount','.order-total .woocommerce-Price-amount','[class*="total" i] [class*="amount" i]','[data-testid*="total" i]']) || fallbackAmountByLabel('total');
    const discount = firstAmount(['tr.cart-discount .amount','[class*="discount" i] [class*="amount" i]','[data-testid*="discount" i]']);
    return { subtotal: subtotal?.amount ?? null, total: total?.amount ?? null, discount: discount?.amount ?? null, currencySymbol: subtotal?.currency || total?.currency || discount?.currency || '' };
  }

  function findCouponInput() {
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible).map((el) => {
      const own = textOf(el), ctx = contextOf(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 16;
      if (RE.coupon.test(ctx)) score += 6;
      if (/code/i.test(own)) score += 3;
      if (/email|phone|postal|zip|address|search|quantity|first name|last name|city|state/i.test(own)) score -= 20;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return inputs[0]?.score >= 6 ? inputs[0].el : null;
  }
  function findApplyButton(input) {
    const controls = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible).map((el) => {
      const t = textOf(el);
      if (RE.danger.test(t) || isCartItemRemoveControl(el) || unsafeNavigationControl(el)) return { el, score: -100 };
      let score = RE.apply.test(t) ? 10 : 0;
      if (RE.coupon.test(t)) score += 5;
      if (input?.form && el.closest('form') === input.form) score += 8;
      const ip = input?.parentElement;
      if (ip?.contains(el)) score += 10;
      let p = input?.parentElement;
      for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) if (p.contains(el)) score += Math.max(0, 5 - i);
      const ir = input?.getBoundingClientRect?.();
      const er = el.getBoundingClientRect();
      if (ir && Math.abs(er.top - ir.top) < 80 && er.left > ir.left) score += 8;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return controls[0]?.score >= 8 ? controls[0].el : null;
  }
  function setValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    input.focus();
    setter ? setter.call(input, value) : (input.value = value);
    for (const type of ['input','change','keyup']) input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: value.slice(-1) || ' ', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || ' ', bubbles: true, cancelable: true }));
    input.blur();
  }
  async function waitForApplyEnabled(button, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') return true;
      await sleep(150);
    }
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function candidateTextElements(code) {
    const target = normalizeCode(code);
    const items = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[data-coupon],[data-coupon-code],[data-discount-code],[class*="discount" i],[class*="coupon" i],[class*="promo" i],li,div,span,p,small,strong')) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code') || el.getAttribute?.('data-discount-code'));
      const text = clean(el.innerText || el.textContent || data || '');
      if (!text || text.length > 260) continue;
      const lower = text.toLowerCase();
      const hasCode = target && lower.includes(target);
      const hasDiscountAmount = /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(text);
      const statusish = RE.success.test(text) || RE.invalid.test(text) || RE.expired.test(text) || RE.minimum.test(text) || RE.eligible.test(text) || RE.used.test(text) || RE.stack.test(text);
      if (hasCode || statusish) {
        const r = el.getBoundingClientRect();
        items.push({ el, text, score: (hasCode ? 30 : 0) + (hasDiscountAmount ? 30 : 0) + (statusish ? 15 : 0) - Math.min(20, Math.round((r.width * r.height) / 50000)) });
      }
    }
    return items.sort((a, b) => b.score - a.score);
  }
  function couponLine(code) {
    const line = candidateTextElements(code).find((x) => containsCode(x.text, code) && /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(x.text));
    return line || null;
  }
  function couponApplied(code) { return Boolean(couponLine(code)); }
  function collectResponse(code, beforeTexts = new Set()) {
    const candidates = candidateTextElements(code).map((x) => x.text);
    const fresh = candidates.filter((t) => !beforeTexts.has(t));
    const source = fresh.length ? fresh : candidates;
    const preferred = source.find((t) => containsCode(t, code) && /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(t))
      || source.find((t) => RE.minimum.test(t))
      || source.find((t) => RE.invalid.test(t))
      || source.find((t) => RE.expired.test(t))
      || source.find((t) => RE.eligible.test(t))
      || source.find((t) => containsCode(t, code))
      || source[0] || '';
    return preferred;
  }
  function textSetForCode(code) { return new Set(candidateTextElements(code).map((x) => x.text)); }
  function totalsChanged(before, after) {
    return ['total','discount','subtotal'].some((k) => Number.isFinite(before[k]) && Number.isFinite(after[k]) && Math.abs(before[k] - after[k]) > 0.005);
  }
  async function waitForResponse(code, beforeTotals, beforeSet, timeoutMs = 6500) {
    const started = Date.now();
    let latestTotals = snapshotTotals();
    let latestText = '';
    while (Date.now() - started < timeoutMs) {
      await sleep(250);
      latestTotals = snapshotTotals();
      latestText = collectResponse(code, beforeSet);
      const line = couponLine(code);
      const terminal = latestText && (containsCode(latestText, code) || RE.invalid.test(latestText) || RE.minimum.test(latestText) || RE.expired.test(latestText) || RE.eligible.test(latestText) || RE.used.test(latestText) || RE.stack.test(latestText) || RE.success.test(latestText));
      if (line || totalsChanged(beforeTotals, latestTotals) || terminal) {
        await sleep(350);
        return { timedOut: false, text: collectResponse(code, beforeSet) || latestText, totals: snapshotTotals(), applied: Boolean(line || couponLine(code)) };
      }
    }
    return { timedOut: true, text: collectResponse(code, beforeSet), totals: latestTotals, applied: couponApplied(code) };
  }

  function classify(text, before, after, code, timedOut, applied) {
    const line = couponLine(code);
    if (line) return 'WORKING';
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.invalid.test(text)) return 'INVALID';
    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const discountRaised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    if (applied || saved || discountRaised || RE.success.test(text)) return 'WORKING';
    if (timedOut) return 'NO_RESPONSE';
    return 'UNKNOWN_RESPONSE';
  }
  function computeDiscount(before, after, text, code) {
    let amount = null;
    const line = couponLine(code);
    const sourceText = line?.text || text || '';
    const lineMatch = sourceText.match(/[-−]\s*((?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*)/i);
    if (lineMatch) amount = parseMoney(lineMatch[1]);
    if (amount === null && Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    if (amount === null && Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : before.total;
    let percent = amount !== null && Number.isFinite(base) && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const m = clean(sourceText).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (m) percent = Number(m[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]'];
    const items = new Set();
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el)) items.add(el);
    return items.size;
  }

  function compactAppliedChip(code) {
    const target = normalizeCode(code);
    const matches = [];
    for (const item of candidateTextElements(code)) {
      let el = item.el;
      for (let depth = 0; depth < 3 && el; depth += 1, el = el.parentElement) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent || '');
        if (!text.toLowerCase().includes(target)) continue;
        if (text.length > 260) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area <= 0 || area > 90000) continue;
        matches.push({ el, area, text });
      }
    }
    matches.sort((a, b) => a.area - b.area);
    return matches[0]?.el || null;
  }
  function removeTargetsNearChip(chip) {
    if (!chip) return [];
    const targets = new Set();
    const roots = [chip, chip.parentElement, chip.parentElement?.parentElement].filter(Boolean);
    for (const root of roots) {
      for (const el of root.querySelectorAll?.('button,a,[role="button"],[aria-label*="remove" i],[title*="remove" i],[class*="remove" i],svg') || []) {
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (!clickable || !visible(clickable) || isCartItemRemoveControl(clickable) || unsafeNavigationControl(clickable)) continue;
        const t = textOf(clickable);
        const r = clickable.getBoundingClientRect();
        if (/remove|delete|clear|close|×|✕|✖/i.test(t) || (r.width <= 60 && r.height <= 60)) targets.add(clickable);
      }
    }
    const r = chip.getBoundingClientRect();
    const points = [
      [r.right - 6, r.top + r.height / 2],
      [r.right - 14, r.top + r.height / 2],
      [r.right - 6, r.top + 8],
      [r.right - 6, r.bottom - 8]
    ];
    for (const [x, y] of points) {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        if (!el || el === document.body || el === document.documentElement) continue;
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (!clickable || !visible(clickable) || isCartItemRemoveControl(clickable) || unsafeNavigationControl(clickable)) continue;
        const cr = clickable.getBoundingClientRect();
        const smallOrInside = cr.width <= 80 && cr.height <= 80 || chip.contains(clickable) || clickable.contains(chip);
        if (smallOrInside) targets.add(clickable);
      }
    }
    return [...targets];
  }
  function clickAt(el, x, y) {
    if (!el || !visible(el)) return false;
    const target = document.elementFromPoint(x, y) || el;
    if (isCartItemRemoveControl(target) || unsafeNavigationControl(target)) return false;
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); } catch {}
    }
    try { target.click?.(); } catch {}
    return true;
  }
  async function removeCoupon(code, baseline) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!couponApplied(code)) return true;
      const chip = compactAppliedChip(code);
      if (!chip) return false;
      const beforeItems = cartItemCount();
      const targets = removeTargetsNearChip(chip);
      for (const target of targets) {
        safeClick(target, 'coupon-remove');
        await sleep(1000);
        if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
        if (!couponApplied(code)) return true;
        const now = snapshotTotals();
        if (Number.isFinite(baseline.total) && Number.isFinite(now.total) && Math.abs(now.total - baseline.total) < 0.03) return true;
      }
      const r = chip.getBoundingClientRect();
      const xs = [r.right - 5, r.right - 14, r.left + r.width * 0.92, r.left + r.width * 0.82];
      for (const x of xs) {
        clickAt(chip, x, r.top + r.height / 2);
        await sleep(1000);
        if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
        if (!couponApplied(code)) return true;
      }
      try {
        chip.focus?.();
        chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        chip.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true, cancelable: true }));
      } catch {}
      await sleep(800);
      if (!couponApplied(code)) return true;
    }
    return !couponApplied(code);
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found. Make it visible on cart/checkout and try again.');
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near the coupon field.');
    const beforeSet = textSetForCode(code);
    const before = snapshotTotals();
    setValue(input, '');
    await sleep(120);
    setValue(input, code);
    await sleep(250);
    const enabled = await waitForApplyEnabled(apply, 3000);
    if (!enabled) {
      return { code, status: 'APPLY_BUTTON_DISABLED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: 'Apply button stayed disabled after filling the code.', testedAt: new Date().toISOString() };
    }
    safeClick(apply);
    const response = await waitForResponse(code, before, beforeSet, 6500);
    const status = classify(response.text, before, response.totals, code, response.timedOut, response.applied);
    const discount = status === 'WORKING' || status === 'WORKING_UNMEASURED' ? computeDiscount(before, response.totals, response.text, code) : { amount: null, percent: null };
    return {
      code, status, discountPercent: discount.percent, discountAmount: discount.amount,
      currencySymbol: response.totals.currencySymbol || before.currencySymbol || baseline.currencySymbol || '',
      baselineSubtotal: before.subtotal ?? baseline.subtotal, baselineTotal: before.total ?? baseline.total,
      afterTotal: response.totals.total, message: response.text || (response.timedOut ? 'No clear coupon response appeared.' : 'No clear response text detected.'),
      responseTimedOut: response.timedOut, testedAt: new Date().toISOString()
    };
  }
  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING' || r.status === 'WORKING_UNMEASURED');
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
    running = true; abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found.');
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
        const applied = result.status === 'WORKING' || result.status === 'WORKING_UNMEASURED' || couponApplied(code);
        if (applied && i < codes.length - 1) {
          notify(`${code} worked. Removing applied coupon before next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be removed automatically. Remove it manually, then run remaining codes.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed automatically. Best code ${run.best?.code || code} is saved.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input) setValue(input, '');
        }
      }
      run.best = chooseBest(run.results);
      if (!run.summary) run.summary = `Finished ${run.results.filter((r) => r.code !== '—').length} code(s). ${run.best ? `Best: ${run.best.code}.` : 'No working coupon detected.'}`;
      if (reapplyBest && run.best && !abortRequested && !couponApplied(run.best.code)) {
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
    const codes = [...new Set((message.payload?.codes || []).map((v) => clean(v)).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
