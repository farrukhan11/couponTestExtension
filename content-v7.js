(() => {
  if (window.__couponTestV7Loaded) return;
  window.__couponTestV7Loaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let running = false;
  let abortRequested = false;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|use\s*code/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order|checkout|check\s*out/i,
    itemRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i,
    success: /applied|accepted|you\s+saved|discount.*applied|promo.*applied|code.*applied/i,
    invalid: /invalid|not\s+valid|isn['’]?t\s+valid|is\s+not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|spend.*(more|at\s+least)|requires?.*(minimum|order)|minimum\s+spend/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to|cannot\s+be\s+applied|could\s+not\s+be\s+applied|couldn['’]?t\s+be\s+applied|can['’]?t\s+be\s+applied|cannot\s+be\s+used/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    stack: /cannot\s+combine|can['']?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)|couldn['']?t\s+be\s+used|can['']?t\s+be\s+used|couldn['']?t\s+be\s+combined/i
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
  async function settledTotals(timeoutMs = 2000) {
    const started = Date.now();
    let prev = snapshotTotals();
    while (Date.now() - started < timeoutMs) {
      await sleep(250);
      const cur = snapshotTotals();
      if (!totalsChanged(prev, cur)) return cur;
      prev = cur;
    }
    return snapshotTotals();
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
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    nativeSetter ? nativeSetter.call(input, value) : (input.value = value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
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
    for (const el of document.querySelectorAll('[role="alert"],[class*="alert" i],[class*="notice" i],[data-coupon],[data-coupon-code],[data-discount-code],[class*="discount" i],[class*="coupon" i],[class*="promo" i],li,div,span,p,small,strong')) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code') || el.getAttribute?.('data-discount-code'));
      const text = clean(el.innerText || el.textContent || data || '');
      if (!text || text.length > 300) continue;
      const lower = text.toLowerCase();
      const hasCode = target && lower.includes(target);
      const hasDiscountAmount = /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(text);
      const statusish = RE.success.test(text) || RE.invalid.test(text) || RE.expired.test(text) || RE.minimum.test(text) || RE.eligible.test(text) || RE.used.test(text) || RE.stack.test(text);
      if (hasCode || statusish) {
        const r = el.getBoundingClientRect();
        let score = (hasCode ? 30 : 0) + (hasDiscountAmount ? 30 : 0) + (statusish ? 15 : 0) - Math.min(20, Math.round((r.width * r.height) / 50000));
        if (hasCode && /\b(does not apply|not eligible|not applicable|excluded)\b/i.test(text) && !/\b(applied|success|saved)\b/i.test(text)) score -= 25;
        items.push({ el, text, score });
      }
    }
    return items.sort((a, b) => b.score - a.score);
  }
  function couponLine(code, beforeTexts = null) {
    const line = candidateTextElements(code).find((x) => {
      if (!containsCode(x.text, code)) return false;
      if (beforeTexts && beforeTexts.has(x.text)) return false;
      const t = clean(x.text);
      if (RE.invalid.test(t) || RE.expired.test(t) || RE.eligible.test(t) || RE.minimum.test(t) || RE.used.test(t) || RE.stack.test(t)) return false;
      if (/\bdoes not apply\b|\bnot valid\b|\bisn['']?t\s+valid\b|\bnot eligible\b|\bexcluded\b|\bexpired\b|\binvalid\b|\bnot found\b|\bcannot be found\b|\bdoesn['']?t apply\b|\bcouldn['']?t be used\b|\bcan['']?t be used\b|\bcould not be used\b|\bcannot be used\b|\bnot applicable\b|\bfailed\b/i.test(t)) return false;
      return /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(t) || RE.success.test(t) || /\b(off|savings?|applied|saved|saves?)\b/i.test(t);
    });
    return line || null;
  }
  function couponApplied(code, beforeTexts = null) { return Boolean(couponLine(code, beforeTexts)); }
  function discountNearCode(code, beforeTexts = null) {
    const target = normalizeCode(code);
    const selectors = '[class*="discount" i],[class*="coupon" i],[class*="promo" i],li,div,span,p,small,strong,td,dd';
    const seen = new Set();
    for (const el of document.querySelectorAll(selectors)) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 300) continue;
      if (beforeTexts && beforeTexts.has(text)) continue;
      const lower = text.toLowerCase();
      if (!lower.includes(target)) continue;
      if (/\bdoes not apply\b|\bnot valid\b|\bnot eligible\b|\bexcluded\b|expired|invalid|\bnot found\b|\bcannot be found\b|\bdoesn['’]?t apply\b/i.test(lower)) continue;
      const m = text.match(/[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*(\d[\d.,]*)/);
      if (m) {
        const amount = parseMoney(m[1]);
        const currency = currencyFromText(text);
        if (amount !== null) return { amount, currency, text };
      }
    }
    return null;
  }
  function collectResponse(code, beforeTexts = new Set()) {
    const candidates = candidateTextElements(code).map((x) => x.text);
    // IMPORTANT: never fall back to the full unfiltered candidate list.
    // Falling back re-admits leftover/stale text from a PREVIOUS code's
    // response (e.g. a generic "Coupon does not apply" banner that never
    // got cleared) and misattributes it to the code being tested right now.
    // If nothing new has appeared yet, we simply have no response yet.
    const source = candidates.filter((t) => !beforeTexts.has(t));
    const about = (t) => containsCode(t, code);
    const errorish = (t) => RE.invalid.test(t) || RE.expired.test(t) || RE.minimum.test(t) || RE.eligible.test(t) || RE.used.test(t) || RE.stack.test(t)
      || /\b(does not apply|not valid|isn’t\s+valid|not eligible|excluded|could not be applied|cannot be applied|couldn['’]?t be applied|can['’]?t be applied|cannot be used|couldn’t be used|can’t be used|not applied|not applicable|failed)\b/i.test(t);
    const isStale = (t) => {
      if (!code) return false;
      if (about(t)) return false;
      const lower = t.toLowerCase();
      if (!/\b(does not apply|not eligible)\b/i.test(lower)) return false;
      const otherCodes = t.match(/\b[A-Z0-9][A-Z0-9_-]{2,}\b/g) || [];
      return otherCodes.some((c) => c.toUpperCase() !== code.toUpperCase());
    };
    const currentWithAmount = source.find((t) => about(t) && /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(t));
    if (currentWithAmount) return currentWithAmount;
    const currentSuccess = source.find((t) => about(t) && !errorish(t) && RE.success.test(t));
    if (currentSuccess) return currentSuccess;
    const currentError = source.find((t) => about(t) && errorish(t));
    if (currentError) return currentError;
    const freshError = source.find((t) => errorish(t) && !isStale(t));
    if (freshError) return freshError;
    const aboutAny = source.find((t) => about(t));
    if (aboutAny) return aboutAny;
    return '';
  }
  function textSetForCode(code) { return new Set(candidateTextElements(code).map((x) => x.text)); }
  function totalsChanged(before, after) {
    return ['total','discount','subtotal'].some((k) => Number.isFinite(before[k]) && Number.isFinite(after[k]) && Math.abs(before[k] - after[k]) > 0.005);
  }
  async function waitForResponse(code, beforeTotals, beforeSet, timeoutMs = 8000) {
    const started = Date.now();
    let latestTotals = snapshotTotals();
    let latestText = '';
    while (Date.now() - started < timeoutMs) {
      await sleep(250);
      latestTotals = snapshotTotals();
      latestText = collectResponse(code, beforeSet);
      const line = couponLine(code, beforeSet);
      // A response is only "terminal" if it is actually ABOUT this code
      // (mentions it) or is an unambiguous success phrase. A generic/stale
      // error banner left over from a previous code (no code name in it)
      // must NOT be allowed to end the wait early — that was the root
      // cause of real successes getting cut off before the page finished
      // rendering the discount, and the stale text being recorded instead.
      const aboutCode = Boolean(latestText) && containsCode(latestText, code);
      const terminal = Boolean(latestText) && (
        aboutCode || RE.success.test(latestText)
      );
      if (line || totalsChanged(beforeTotals, latestTotals) || terminal) {
        // Give the page time to finish recalculating (totals + DOM) before
        // taking the final reading, instead of a single short fixed wait.
        let settled = snapshotTotals();
        for (let i = 0; i < 5; i += 1) {
          await sleep(300);
          const next = snapshotTotals();
          const stable = !totalsChanged(settled, next);
          settled = next;
          if (stable) break;
        }
        return { timedOut: false, text: collectResponse(code, beforeSet) || latestText, totals: settled, applied: Boolean(line || couponLine(code, beforeSet)) };
      }
    }
    return { timedOut: true, text: collectResponse(code, beforeSet), totals: latestTotals, applied: couponApplied(code, beforeSet) };
  }

  function isErrorText(text) {
    const t = String(text || '');
    return RE.invalid.test(t) || RE.expired.test(t) || RE.minimum.test(t) || RE.eligible.test(t) || RE.used.test(t) || RE.stack.test(t)
      || /\b(does not apply|not valid|isn’t\s+valid|not eligible|excluded|could not be applied|cannot be applied|couldn['’]?t be applied|can['’]?t be applied|cannot be used|couldn’t be used|can’t be used|not applied|not applicable|failed)\b/i.test(t);
  }
  function classify(text, before, after, code, timedOut, applied, beforeTexts = null) {
    const line = couponLine(code, beforeTexts);
    if (line) return 'WORKING';
    const disc = discountNearCode(code, beforeTexts);
    if (disc && disc.amount > 0) return 'WORKING';
    if (applied) return 'WORKING';

    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const discountRaised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    const textIsAboutThisCode = Boolean(text) && containsCode(text, code);

    // Real, measured financial evidence (the total actually dropped, or the
    // discount line actually increased) outranks error-ish text UNLESS that
    // text is specifically about this code. This is what stops a stale
    // banner left over from a DIFFERENT code's failed attempt (e.g. a
    // generic "Coupon does not apply" that never mentions the code) from
    // overriding a coupon that genuinely worked.
    if ((saved || discountRaised) && !textIsAboutThisCode) return 'WORKING';

    if (isErrorText(text)) {
      if (RE.expired.test(text)) return 'EXPIRED';
      if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
      if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
      if (RE.used.test(text)) return 'ALREADY_USED';
      if (RE.stack.test(text)) return 'NOT_STACKABLE';
      if (RE.invalid.test(text)) return 'INVALID';
      return 'UNKNOWN_RESPONSE';
    }
    if (RE.success.test(text)) return 'WORKING';
    if (saved || discountRaised) return 'WORKING';
    if (timedOut) return 'NO_RESPONSE';
    return 'UNKNOWN_RESPONSE';
  }
  function computeDiscount(before, after, text, code, beforeTexts = null) {
    let amount = null;
    const disc = discountNearCode(code, beforeTexts);
    if (disc && disc.amount > 0) amount = disc.amount;
    if (amount === null) {
      const line = couponLine(code, beforeTexts);
      const sourceText = line?.text || text || '';
      const lineMatch = sourceText.match(/[-−]\s*((?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*)/i);
      if (lineMatch) amount = parseMoney(lineMatch[1]);
    }
    if (amount === null && Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    if (amount === null && Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const baseCandidates = [before.subtotal, before.total, after.subtotal, after.total].filter((v) => Number.isFinite(v) && v > 0);
    const base = baseCandidates.length ? Math.max(...baseCandidates) : null;
    let percent = amount !== null && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const sourceText = (disc?.text || text || '');
      const m = clean(sourceText).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
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
      for (let depth = 0; depth < 4 && el; depth += 1, el = el.parentElement) {
        if (!visible(el)) continue;
        const text = clean(el.innerText || el.textContent || '');
        const lower = text.toLowerCase();
        if (!lower.includes(target)) continue;
        if (text.length > 300) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area <= 0 || area > 150000) continue;
        matches.push({ el, area, text });
      }
    }
    matches.sort((a, b) => a.area - b.area);
    return matches[0]?.el || null;
  }
  function globalRemoveButtonForCode(code) {
    // Many modern checkouts (Shopify's newer checkout included) label their
    // discount-remove control with an aria-label/title that names the code
    // directly, e.g. aria-label="Remove SUMMER10". This is far more
    // reliable than guessing geometry near a text node, so try it first,
    // searching the WHOLE page rather than just near the detected chip.
    const target = normalizeCode(code);
    const candidates = [...document.querySelectorAll('button,[role="button"],a')];
    for (const el of candidates) {
      if (!visible(el) || isCartItemRemoveControl(el) || unsafeNavigationControl(el)) continue;
      const label = clean(el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').toLowerCase();
      if (!label) continue;
      if (/remove|delete|clear|dismiss/.test(label) && label.includes(target)) return el;
    }
    return null;
  }
  function removeTargetsNearChip(chip) {
    if (!chip) return [];
    const targets = new Set();
    const roots = [chip, chip.parentElement, chip.parentElement?.parentElement, chip.parentElement?.parentElement?.parentElement, chip.parentElement?.parentElement?.parentElement?.parentElement].filter(Boolean);
    for (const root of roots) {
      for (const el of root.querySelectorAll?.('button,a,[role="button"],[aria-label*="remove" i],[aria-label*="close" i],[aria-label*="delete" i],[title*="remove" i],[title*="close" i],[class*="remove" i],[class*="close" i],[class*="dismiss" i],[class*="delete" i],[data-action*="remove" i],[data-testid*="remove" i],[data-coupon-remove] svg,img,span[class*="close" i],div[class*="close" i],span[class*="remove" i],div[class*="remove" i],svg,button svg,button path') || []) {
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (!clickable || !visible(clickable) || isCartItemRemoveControl(clickable) || unsafeNavigationControl(clickable)) continue;
        const t = textOf(clickable);
        const ownText = clean(clickable.textContent || '');
        const r = clickable.getBoundingClientRect();
        if (/remove|delete|clear|close|dismiss|×|✕|✖|✕|✗|✕/i.test(t) || /×|✕|✖|✗/.test(ownText) || (r.width <= 100 && r.height <= 100)) targets.add(clickable);
      }
    }
    const r = chip.getBoundingClientRect();
    const points = [
      [r.right + 2, r.top + r.height / 2],
      [r.right, r.top + r.height / 2],
      [r.right - 4, r.top + r.height / 2],
      [r.right - 12, r.top + r.height / 2],
      [r.right - 20, r.top + r.height / 2],
      [r.right - 4, r.top + 4],
      [r.right - 4, r.bottom - 4],
      [r.right - 12, r.top + 8],
      [r.right - 12, r.bottom - 8],
      [r.left - 8, r.top + r.height / 2],
      [r.left + 4, r.top + r.height / 2],
      [r.left + r.width / 2, r.top - 4],
      [r.left + r.width / 2, r.bottom + 4]
    ];
    for (const [x, y] of points) {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        if (!el || el === document.body || el === document.documentElement) continue;
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (!clickable || !visible(clickable) || isCartItemRemoveControl(clickable) || unsafeNavigationControl(clickable)) continue;
        const cr = clickable.getBoundingClientRect();
        const smallOrInside = cr.width <= 120 && cr.height <= 120 || chip.contains(clickable) || clickable.contains(chip);
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
  function chipGone(chip) {
    return !document.body.contains(chip) || clean(chip.innerText || chip.textContent || '') === '';
  }
  function looksLikeAppliedCoupon(text) {
    const t = clean(text);
    if (!t || t.length > 180) return false;
    if (/subtotal|total|checkout|cart|shipping|tax|paypal|apple pay|google pay|pay later|compare at|was\s*\$|reg\.?\s*\$|sale\s*\$|original/i.test(t)) return false;
    return /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*/i.test(t) && /[A-Z0-9][A-Z0-9_-]{2,}/.test(t);
  }
  function findAnyAppliedChip() {
    const items = candidateTextElements('').filter((x) => looksLikeAppliedCoupon(x.text));
    items.sort((a, b) => a.score - b.score);
    return items[0]?.el || null;
  }
  async function removeChip(chip, baseline, code = null) {
    const deadline = Date.now() + 12000;
    // Fast path: a dedicated "Remove {code}" control anywhere on the page.
    if (code) {
      const direct = globalRemoveButtonForCode(code);
      if (direct) {
        safeClick(direct, 'coupon-remove');
        await sleep(1000);
        if (chipGone(chip)) return true;
        const now = snapshotTotals();
        if (Number.isFinite(baseline.total) && Number.isFinite(now.total) && Math.abs(now.total - baseline.total) < 0.03) return true;
      }
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (Date.now() > deadline) return false;
      if (chipGone(chip)) return true;
      const beforeItems = cartItemCount();
      const targets = removeTargetsNearChip(chip);
      for (const target of targets) {
        if (Date.now() > deadline) return false;
        safeClick(target, 'coupon-remove');
        await sleep(1000);
        if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
        if (chipGone(chip)) return true;
        const now = snapshotTotals();
        if (Number.isFinite(baseline.total) && Number.isFinite(now.total) && Math.abs(now.total - baseline.total) < 0.03) return true;
      }
      const r = chip.getBoundingClientRect();
      const xs = [r.right + 2, r.right, r.right - 5, r.right - 14, r.right - 20, r.left - 5, r.left + 6, r.left + r.width * 0.92, r.left + r.width * 0.82];
      for (const x of xs) {
        if (Date.now() > deadline) return false;
        clickAt(chip, x, r.top + r.height / 2);
        await sleep(800);
        if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
        if (chipGone(chip)) return true;
      }
      safeClick(chip, 'coupon-remove');
      await sleep(1000);
      if (chipGone(chip)) return true;
      try {
        chip.focus?.();
        for (const key of ['Backspace', 'Delete', 'Escape']) {
          if (Date.now() > deadline) return false;
          chip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          chip.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
          await sleep(400);
          if (chipGone(chip)) return true;
        }
      } catch {}
    }
    if (!chipGone(chip)) {
      const input = findCouponInput();
      const apply = input ? findApplyButton(input) : null;
      if (input && apply) {
        setValue(input, '');
        await sleep(300);
        safeClick(apply);
        await sleep(2500);
        if (chipGone(chip)) return true;
      }
    }
    return chipGone(chip);
  }
  async function removeCoupon(code, baseline) {
    if (!couponApplied(code)) return true;
    const chip = compactAppliedChip(code);
    if (!chip) return false;
    return removeChip(chip, baseline, code);
  }

  function dismissStaleNotices() {
    // Best-effort: close any visible alert/notice/error banner left over
    // from testing a PREVIOUS code, so it can never be mistaken for this
    // code's response. Never touches cart-item or navigation controls.
    const selector = '[role="alert"] [aria-label*="close" i],[role="alert"] [aria-label*="dismiss" i],' +
      '[class*="notice" i] [aria-label*="close" i],[class*="notice" i] [class*="close" i],' +
      '[class*="alert" i] [aria-label*="close" i],[class*="alert" i] [class*="close" i],' +
      '[class*="error" i] [aria-label*="close" i],[class*="error" i] [class*="close" i]';
    for (const btn of document.querySelectorAll(selector)) {
      const clickable = btn.closest?.('button,a,[role="button"]') || btn;
      if (!visible(clickable) || isCartItemRemoveControl(clickable) || unsafeNavigationControl(clickable)) continue;
      safeClick(clickable, 'coupon-remove');
    }
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found. Make it visible on cart/checkout and try again.');
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near the coupon field.');
    setValue(input, '');
    await sleep(300);
    dismissStaleNotices();
    await sleep(200);
    const beforeSet = textSetForCode(code);
    const before = await settledTotals(2000);
    setValue(input, code);
    await sleep(500);
    safeClick(apply);
    const response = await waitForResponse(code, before, beforeSet, 8000);
    const status = classify(response.text, before, response.totals, code, response.timedOut, response.applied, beforeSet);
    const discount = status === 'WORKING' || status === 'WORKING_UNMEASURED' ? computeDiscount(before, response.totals, response.text, code, beforeSet) : { amount: null, percent: null };
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
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline: snapshotTotals(), results: [], best: null, summary: '' };

      const existingChip = findAnyAppliedChip();
      if (existingChip) {
        const chipText = clean(existingChip.innerText || existingChip.textContent || '');
        const chipTotals = snapshotTotals();
        const existingCode = codes.find((c) => chipText.toUpperCase().includes(c.toUpperCase()));
        if (existingCode) {
          const disc = discountNearCode(existingCode);
          const discountAmount = disc?.amount || (Number.isFinite(chipTotals.discount) ? chipTotals.discount : null);
          const base = Number.isFinite(chipTotals.subtotal) && chipTotals.subtotal > 0 ? chipTotals.subtotal : chipTotals.total;
          const discountPercent = discountAmount && base ? Math.round((discountAmount / base) * 10000) / 100 : null;
          run.results.push({
            code: existingCode, status: 'WORKING',
            discountPercent, discountAmount: discountAmount ? Math.round(discountAmount * 100) / 100 : null,
            currencySymbol: chipTotals.currencySymbol || '',
            baselineSubtotal: chipTotals.subtotal, baselineTotal: chipTotals.total,
            afterTotal: chipTotals.total,
            message: `Coupon ${existingCode} was already applied. ${discountAmount ? '$' + discountAmount.toFixed(2) + ' discount active.' : ''}`.trim(),
            responseTimedOut: false, testedAt: new Date().toISOString()
          });
          codes = codes.filter((c) => c.toUpperCase() !== existingCode.toUpperCase());
          notify(`${existingCode} was already applied and recorded.`, run);
        }
        notify('An applied coupon is already on the page. Attempting to remove it…', run);
        const pre = snapshotTotals();
        const removed = await removeChip(existingChip, pre, existingCode);
        await sleep(500);
        if (!removed && findAnyAppliedChip()) {
          notify('Could not remove the pre-existing coupon automatically. Continuing anyway — applying a new code will likely replace it, or you may see a NOT_STACKABLE result.', run);
        }
      }

      const baseline = snapshotTotals();
      const baselineItems = cartItemCount();
      run.baseline = baseline;
      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; try { chrome.storage.local.set({ 'couponTest:last': run }); } catch {} break; }
        if (baselineItems > 0 && cartItemCount() < baselineItems) throw new Error('Safety stop: cart item count changed during coupon testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code}`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        try { chrome.storage.local.set({ 'couponTest:last': run }); } catch {}
        notify(`${code}: ${result.status}`, run);
        const applied = result.status === 'WORKING' || result.status === 'WORKING_UNMEASURED' || couponApplied(code);
        if (applied && i < codes.length - 1) {
          notify(`${code} worked. Attempting to remove applied coupon before next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            // Don't abort the whole batch just because auto-removal failed.
            // Keep testing — on most platforms applying a new code either
            // replaces the old one automatically, or the site will reject it
            // as NOT_STACKABLE, both of which are useful, informative results.
            notify(`${code} could not be removed automatically — continuing with remaining codes. The next result may reflect ${code} still being active (e.g. NOT_STACKABLE), so double-check it.`, run);
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
      try { chrome.storage.local.set({ 'couponTest:last': run }); } catch {}
      return run;
    } finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STOP_COUPON_TESTS') { abortRequested = true; sendResponse({ ok: true }); return; }
    if (message?.type === 'GET_ENGINE_INFO') { sendResponse({ ok: true, version: 7, ready: true }); return; }
    if (message?.type !== 'START_COUPON_TESTS' && message?.type !== 'START_COUPON_TESTS_V7') return;
    const codes = [...new Set((message.payload?.codes || []).map((v) => clean(v)).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
