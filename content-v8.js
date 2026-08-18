(() => {
  if (window.__couponTestV8Loaded) return;
  window.__couponTestV8Loaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let abortRequested = false;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order|checkout|check\s*out/i,
    invalid: /invalid|not\s+valid|enter\s+a\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find|not\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|spend.*(more|at\s+least)|requires?.*(minimum|order)|minimum\s+spend/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)|cannot\s+be\s+applied\s+to/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i,
    cartRemove: /remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i
  };

  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const norm = (v) => clean(v).toLowerCase();
  const codeNorm = (v) => norm(v).replace(/[^a-z0-9_%$-]/g, '');

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
  }
  function allElements(root = document) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      const list = node.querySelectorAll ? [...node.querySelectorAll('*')] : [];
      for (const el of list) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
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
      if (t && t.length < 700) out += ` ${t}`;
    }
    return out;
  }
  function containsCode(text, code) {
    return codeNorm(text).includes(codeNorm(code));
  }
  function isCartItemRemoveControl(el) {
    if (!el) return false;
    const t = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (RE.cartRemove.test(t)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key|product-remove/i.test(`${cls} ${href}`)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (/\bremove\b|delete|trash|×|✕|✖/i.test(`${t} ${cls}`)) return true;
    }
    return false;
  }
  function unsafeLink(el) {
    const t = textOf(el);
    const href = el?.getAttribute?.('href') || '';
    if (RE.danger.test(t)) return true;
    if (/facebook|instagram|youtube|tiktok|pinterest|twitter|linkedin|mailto:|tel:/i.test(`${t} ${href}`)) return true;
    if (/\/pages\/|\/blogs\/|\/policies\/|\/collections\//i.test(href)) return true;
    return false;
  }
  function dispatchMouse(el, x = null, y = null) {
    if (!el || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    const cx = x ?? r.left + r.width / 2;
    const cy = y ?? r.top + r.height / 2;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const type of ['pointerover','mouseover','pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy })); } catch {}
    }
    try { el.click(); } catch {}
    return true;
  }
  function safeClick(el, purpose = 'normal') {
    if (!el || !visible(el)) return false;
    if (isCartItemRemoveControl(el)) return false;
    if (purpose !== 'coupon-remove' && unsafeLink(el)) return false;
    return dispatchMouse(el);
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
  function moneyMatches(text) {
    return [...String(text || '').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-−]?\s*\d[\d.,]*|[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)].map((m) => m[0]);
  }
  function moneyFromText(text) {
    const m = moneyMatches(text);
    return m.length ? parseMoney(m[m.length - 1]) : null;
  }
  function currencyFromText(text) {
    const t = String(text || '');
    if (t.includes('$')) return '$'; if (t.includes('€')) return '€'; if (t.includes('£')) return '£'; if (t.includes('¥')) return '¥'; if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1];
    return code ? `${code.toUpperCase()} ` : '';
  }
  function amountNearLabel(labelRe) {
    const hits = [];
    for (const el of allElements()) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || '');
      if (!text || text.length > 220 || !labelRe.test(text)) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), len: text.length });
    }
    hits.sort((a, b) => a.len - b.len);
    return hits[0] || null;
  }
  function snapshotTotals() {
    const subtotal = amountNearLabel(/\bsub\s*total\b/i) || amountNearLabel(/\bitems?\s+total\b/i);
    const total = amountNearLabel(/\border\s+total\b|\bgrand\s+total\b|^\s*total\b/i);
    const discount = amountNearLabel(/discount|coupon|promo/i);
    return {
      subtotal: subtotal?.amount ?? null,
      total: total?.amount ?? subtotal?.amount ?? null,
      discount: discount?.amount ?? null,
      currencySymbol: subtotal?.currency || total?.currency || discount?.currency || ''
    };
  }

  function findCouponInput() {
    const inputs = allElements().filter((el) => (el.matches?.('input:not([type="hidden"]), textarea')) && visible(el));
    const ranked = inputs.map((el) => {
      const own = textOf(el), ctx = contextOf(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 18;
      if (RE.coupon.test(ctx)) score += 7;
      if (/code/i.test(own)) score += 3;
      if (/email|phone|postal|zip|address|search|quantity|first name|last name|city|state/i.test(own)) score -= 25;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 10;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.score >= 6 ? ranked[0].el : null;
  }
  function findApplyButton(input) {
    const controls = allElements().filter((el) => el.matches?.('button,input[type="submit"],input[type="button"],[role="button"],a') && visible(el));
    const ranked = controls.map((el) => {
      const t = textOf(el);
      if (RE.danger.test(t) || isCartItemRemoveControl(el) || unsafeLink(el)) return { el, score: -100 };
      let score = RE.apply.test(t) ? 12 : 0;
      if (RE.coupon.test(t)) score += 5;
      if (input?.form && el.closest('form') === input.form) score += 8;
      let p = input?.parentElement;
      for (let i = 0; i < 5 && p; i += 1, p = p.parentElement) if (p.contains(el)) score += Math.max(0, 8 - i);
      const ir = input?.getBoundingClientRect?.();
      const er = el.getBoundingClientRect();
      if (ir && Math.abs(er.top - ir.top) < 100 && er.left > ir.left) score += 10;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.score >= 8 ? ranked[0].el : null;
  }
  function setValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    input.focus();
    setter ? setter.call(input, value) : (input.value = value);
    for (const type of ['beforeinput','input','change','keyup']) {
      try { input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); } catch {}
    }
    try { input.dispatchEvent(new KeyboardEvent('keydown', { key: value.slice(-1) || ' ', bubbles: true, cancelable: true })); } catch {}
    try { input.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || ' ', bubbles: true, cancelable: true })); } catch {}
    input.blur();
  }
  async function waitForApplyEnabled(button, timeoutMs = 3500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') return true;
      await sleep(150);
    }
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function candidateTextElements(code) {
    const out = [];
    for (const el of allElements()) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.textContent || textOf(el));
      if (!text || text.length > 260) continue;
      const hasCode = containsCode(text, code);
      const statusish = RE.invalid.test(text) || RE.expired.test(text) || RE.minimum.test(text) || RE.eligible.test(text) || RE.used.test(text) || RE.stack.test(text) || RE.success.test(text);
      if (!hasCode && !statusish) continue;
      const amount = moneyFromText(text);
      out.push({ el, text, amount, score: (hasCode ? 30 : 0) + (amount !== null ? 30 : 0) + (statusish ? 20 : 0) - Math.min(15, Math.round((el.getBoundingClientRect().width * el.getBoundingClientRect().height) / 60000)) });
    }
    return out.sort((a, b) => b.score - a.score);
  }
  function couponLine(code) {
    return candidateTextElements(code).find((x) => containsCode(x.text, code) && /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(x.text)) || null;
  }
  function couponApplied(code) { return Boolean(couponLine(code)); }
  function collectResponse(code, beforeSet) {
    const texts = candidateTextElements(code).map((x) => x.text);
    const fresh = texts.filter((t) => !beforeSet.has(t));
    const source = fresh.length ? fresh : texts;
    return source.find((t) => containsCode(t, code) && /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(t))
      || source.find((t) => RE.minimum.test(t))
      || source.find((t) => RE.invalid.test(t))
      || source.find((t) => RE.expired.test(t))
      || source.find((t) => RE.eligible.test(t))
      || source.find((t) => containsCode(t, code))
      || source[0] || '';
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
      const terminal = latestText && (containsCode(latestText, code) || RE.invalid.test(latestText) || RE.minimum.test(latestText) || RE.expired.test(latestText) || RE.eligible.test(latestText));
      if (line || totalsChanged(beforeTotals, latestTotals) || terminal) return { text: latestText, totals: latestTotals, timedOut: false, line };
    }
    return { text: latestText || 'No clear coupon response detected.', totals: latestTotals, timedOut: true, line: couponLine(code) };
  }
  function classify(text, before, after, code, timedOut, line) {
    if (line || couponApplied(code)) return 'WORKING';
    if (RE.expired.test(text)) return 'EXPIRED';
    if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(text)) return 'ALREADY_USED';
    if (RE.stack.test(text)) return 'NOT_STACKABLE';
    if (RE.invalid.test(text)) return 'INVALID';
    if (Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005) return 'WORKING';
    if (Number.isFinite(after.discount) && after.discount > (Number.isFinite(before.discount) ? before.discount : 0)) return 'WORKING';
    return timedOut ? 'NO_RESPONSE' : 'UNKNOWN_RESPONSE';
  }
  function computeDiscount(before, after, responseText, line) {
    let amount = line?.amount ?? null;
    if (amount === null && Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    if (amount === null && Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    let base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : null;
    if (!base && Number.isFinite(before.total) && before.total > 0) base = before.total;
    if (!base && amount !== null && Number.isFinite(after.total)) base = after.total + amount;
    let percent = amount !== null && base ? (amount / base) * 100 : null;
    if (percent === null) {
      const p = clean(responseText).match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (p) percent = Number(p[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  function cartItemCount() {
    const items = new Set();
    for (const sel of ['tr.cart_item','.woocommerce-cart-form__cart-item.cart_item','.wc-block-cart-items__row','[data-cart-item-key]']) {
      for (const el of document.querySelectorAll(sel)) if (visible(el)) items.add(el);
    }
    return items.size;
  }
  function chipsForCode(code) {
    const line = couponLine(code);
    if (!line) return [];
    const chips = [line.el];
    let p = line.el.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      const t = clean(p.innerText || p.textContent || '');
      if (containsCode(t, code) && t.length < 260) chips.push(p);
    }
    return [...new Set(chips)].filter(visible).sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
  }
  function removeTargetsInChip(chip) {
    const targets = [];
    const selectors = 'button,a,[role="button"],[aria-label*="remove" i],[aria-label*="delete" i],[aria-label*="close" i],[title*="remove" i],[title*="delete" i],[title*="close" i],[class*="remove" i],[class*="delete" i],[class*="close" i],svg';
    for (const root of [chip, chip.parentElement, chip.parentElement?.parentElement].filter(Boolean)) {
      for (const el of root.querySelectorAll?.(selectors) || []) {
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (!visible(clickable) || isCartItemRemoveControl(clickable) || unsafeLink(clickable)) continue;
        const rr = root.getBoundingClientRect(), cr = clickable.getBoundingClientRect();
        const near = cr.left >= rr.left - 8 && cr.right <= rr.right + 60 && cr.top >= rr.top - 20 && cr.bottom <= rr.bottom + 20;
        if (near) targets.push(clickable);
      }
    }
    return [...new Set(targets)];
  }
  async function keyboardRemove(chip) {
    try {
      chip.focus?.();
      dispatchMouse(chip);
      for (const key of ['Backspace','Delete']) {
        for (const type of ['keydown','keyup']) {
          chip.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
        }
        await sleep(300);
      }
    } catch {}
  }
  async function removeCoupon(code, baseline) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!couponApplied(code)) return true;
      const beforeItems = cartItemCount();
      const chips = chipsForCode(code);
      for (const chip of chips) {
        for (const target of removeTargetsInChip(chip)) {
          safeClick(target, 'coupon-remove');
          await sleep(900);
          if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
          if (!couponApplied(code)) return true;
        }
        const r = chip.getBoundingClientRect();
        for (const x of [r.right - 8, r.right - 18, r.left + 10]) {
          dispatchMouse(chip, x, r.top + r.height / 2);
          await sleep(800);
          if (beforeItems > 0 && cartItemCount() < beforeItems) throw new Error('Safety stop: cart item count decreased while removing coupon.');
          if (!couponApplied(code)) return true;
        }
        await keyboardRemove(chip);
        await sleep(800);
        if (!couponApplied(code)) return true;
      }
      await sleep(500);
    }
    return !couponApplied(code);
  }
  async function clearExistingCoupons() {
    for (let i = 0; i < 3; i += 1) {
      const input = findCouponInput();
      const chips = candidateTextElements('').filter((x) => /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(x.text) && RE.coupon.test(x.text));
      if (input && !chips.length) return true;
      break;
    }
    return true;
  }
  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) return { code, status: 'COUPON_FIELD_NOT_FOUND', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: 'Coupon/discount field not found or disabled. A previous coupon may still be applied.', testedAt: new Date().toISOString() };
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near coupon field.');
    const beforeSet = textSetForCode(code);
    const before = snapshotTotals();
    setValue(input, '');
    await sleep(120);
    setValue(input, code);
    const enabled = await waitForApplyEnabled(apply);
    if (!enabled) return { code, status: 'APPLY_BUTTON_DISABLED', discountPercent: null, discountAmount: null, currencySymbol: before.currencySymbol || baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: before.total, message: 'Apply button stayed disabled after filling code.', testedAt: new Date().toISOString() };
    safeClick(apply);
    const response = await waitForResponse(code, before, beforeSet);
    const status = classify(response.text, before, response.totals, code, response.timedOut, response.line);
    const discount = status === 'WORKING' ? computeDiscount(before, response.totals, response.text, response.line) : { amount: null, percent: null };
    return { code, status, discountPercent: discount.percent, discountAmount: discount.amount, currencySymbol: response.totals.currencySymbol || before.currencySymbol || baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: response.totals.total, message: response.text, testedAt: new Date().toISOString() };
  }
  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING');
    if (!working.length) return null;
    return working.sort((a, b) => (b.discountAmount ?? -1) - (a.discountAmount ?? -1) || (b.discountPercent ?? -1) - (a.discountPercent ?? -1))[0];
  }
  function notify(summary, run = null) {
    chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }).catch(() => {});
  }
  async function runTests(codes, reapplyBest) {
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true; abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Open cart/checkout and make coupon field visible.');
      await clearExistingCoupons();
      const baseline = snapshotTotals();
      const baselineCartItems = cartItemCount();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };
      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        if (baselineCartItems > 0 && cartItemCount() < baselineCartItems) throw new Error('Safety stop: cart item count changed during testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code}`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}`, run);
        if (result.status === 'WORKING' && i < codes.length - 1) {
          notify(`${code} worked. Trying to remove applied coupon before next code...`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            for (let j = i + 1; j < codes.length; j += 1) {
              run.results.push({ code: codes[j], status: 'SKIPPED_RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Skipped because working coupon ${code} could not be removed automatically. Remove it manually, then run remaining codes.`, testedAt: new Date().toISOString() });
            }
            run.best = chooseBest(run.results);
            run.summary = `Stopped after ${code}: working coupon could not be removed automatically. Remaining codes marked SKIPPED_RESET_REQUIRED.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input && !input.disabled) setValue(input, '');
        }
      }
      run.best = chooseBest(run.results);
      if (!run.summary) run.summary = `Finished ${run.results.length} code(s). ${run.best ? `Best: ${run.best.code}.` : 'No working coupon detected.'}`;
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
    const codes = [...new Set((message.payload?.codes || []).map((v) => String(v).trim()).filter(Boolean))];
    runTests(codes, Boolean(message.payload?.reapplyBest))
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();