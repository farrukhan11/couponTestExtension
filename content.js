(() => {
  if (window.__couponTestPhase1Loaded) return;
  window.__couponTestPhase1Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    remove: /remove|delete|clear|cancel|×|✕|✖/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied/i,
    invalid: /invalid|not\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found|couldn['’]?t\s+find/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|spend.*(more|at\s+least)|requires?.*(minimum|order)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|eligible\s+items|specific\s+(item|product)/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /sign\s*in|log\s*in|login|required\s+account|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+combinable|not\s+stackable|one\s+(promo|coupon|discount)/i
  };

  let running = false;
  let abortRequested = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
  }

  function textOf(el) {
    return [el?.getAttribute?.('aria-label'), el?.getAttribute?.('placeholder'), el?.getAttribute?.('name'), el?.getAttribute?.('id'), el?.getAttribute?.('title'), el?.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function contextOf(el) {
    let out = textOf(el);
    let p = el?.parentElement;
    for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) {
      const t = (p.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 550) out += ` ${t}`;
    }
    if (el?.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) out += ` ${label.textContent || ''}`;
      } catch {}
    }
    return out;
  }

  function findCouponInput() {
    const items = [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(visible).map((el) => {
      const own = textOf(el), ctx = contextOf(el);
      let score = 0;
      if (RE.coupon.test(own)) score += 14;
      if (RE.coupon.test(ctx)) score += 6;
      if (/code/i.test(own)) score += 2;
      if (/email|phone|postal|zip|address|search|quantity/i.test(own)) score -= 12;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return items[0]?.score >= 6 ? items[0].el : null;
  }

  function findApplyButton(input) {
    const items = [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"],a')].filter(visible).map((el) => {
      const t = textOf(el);
      if (RE.danger.test(t)) return { el, score: -100 };
      let score = RE.apply.test(t) ? 7 : 0;
      if (RE.coupon.test(t)) score += 5;
      if (input?.form && el.closest('form') === input.form) score += 8;
      if (input?.parentElement?.contains(el)) score += 7;
      if (input && el.parentElement === input.parentElement) score += 5;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return items[0]?.score >= 7 ? items[0].el : null;
  }

  function setValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function safeClick(el) {
    if (!el) throw new Error('Required button was not found.');
    const t = textOf(el);
    if (RE.danger.test(t)) throw new Error(`Blocked unsafe checkout action: ${t}`);
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    el.click();
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

  function sumAmounts(selectors) {
    const seen = new Set();
    let sum = 0, found = false, currency = '';
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || seen.has(el)) continue;
        seen.add(el);
        const text = el.innerText || el.textContent || '';
        const amount = moneyFromText(text);
        if (amount !== null) { sum += amount; found = true; currency ||= currencyFromText(text); }
      }
    }
    return found ? { amount: Math.round(sum * 100) / 100, currency } : null;
  }

  function fallbackByLabel(kind) {
    const rules = kind === 'subtotal' ? [/\bsub\s*total\b/i, /\bitems?\s+total\b/i]
      : kind === 'discount' ? [/\bdiscount\b/i, /\bcoupon\b/i, /\bpromo(?:tion)?\b/i, /\bsavings?\b/i]
      : [/\bgrand\s+total\b/i, /\border\s+total\b/i, /^\s*total\b/i];
    const hits = [];
    for (const el of document.querySelectorAll('div,span,p,li,dt,dd,tr,td,th,strong,b')) {
      if (!visible(el)) continue;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 180 || (kind === 'total' && /sub\s*total/i.test(text)) || !rules.some((r) => r.test(text))) continue;
      const amount = moneyFromText(text);
      if (amount !== null) hits.push({ amount, currency: currencyFromText(text), score: (text.length < 80 ? 2 : 0) + (rules[0].test(text) ? 2 : 0) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshotTotals() {
    const subtotal = firstAmount(['.cart-subtotal .woocommerce-Price-amount','.cart-subtotal .amount','td[data-title="Subtotal"] .woocommerce-Price-amount','.order-subtotal .woocommerce-Price-amount']) || fallbackByLabel('subtotal');
    const total = firstAmount(['.order-total .woocommerce-Price-amount','.order-total .amount','td[data-title="Total"] .woocommerce-Price-amount','.cart_totals .order-total .woocommerce-Price-amount']) || fallbackByLabel('total');
    const discount = sumAmounts(['tr.cart-discount .woocommerce-Price-amount','tr[class*="cart-discount"] .amount','.cart-discount .woocommerce-Price-amount','td[data-title*="Discount"] .woocommerce-Price-amount']) || fallbackByLabel('discount');
    return { subtotal: subtotal?.amount ?? null, total: total?.amount ?? null, discount: discount?.amount ?? null, currencySymbol: subtotal?.currency || total?.currency || discount?.currency || '' };
  }

  function collectMessages(code = '') {
    const out = new Set();
    const selectors = '[role="alert"],[aria-live],.woocommerce-message,.woocommerce-error,.woocommerce-info,.error,.errors,.success,.notice,.message,[class*="error"],[class*="success"],[class*="notice"],[class*="coupon"],[class*="promo"],[class*="discount"]';
    for (const el of document.querySelectorAll(selectors)) {
      if (!visible(el)) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 600) out.add(t);
    }
    if (code) {
      for (const el of document.querySelectorAll('tr,div,span,p,li')) {
        if (!visible(el)) continue;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 250 && t.toLowerCase().includes(code.toLowerCase())) out.add(t);
      }
    }
    return [...out].slice(0, 35).join(' | ');
  }

  function appliedCouponElements(code = '') {
    const target = code.toLowerCase();
    const matches = [];
    for (const el of document.querySelectorAll('[data-coupon],tr.cart-discount,[class*="cart-discount"],[class*="applied-coupon"],[class*="coupon-code"]')) {
      const data = (el.getAttribute?.('data-coupon') || '').toLowerCase();
      const text = (el.innerText || el.textContent || '').toLowerCase();
      if (!code || data === target || text.includes(target)) matches.push(el);
    }
    return matches;
  }

  function couponStillApplied(code) {
    return appliedCouponElements(code).length > 0;
  }

  function findRemoveButton(code = '') {
    const target = code.toLowerCase();
    const direct = [...document.querySelectorAll('a.woocommerce-remove-coupon,button.woocommerce-remove-coupon,[class*="woocommerce-remove-coupon"],[class*="remove-coupon"],[class*="remove_coupon"],[href*="remove_coupon"],[data-coupon]')];
    const generic = [...document.querySelectorAll('button,a,[role="button"]')].filter((el) => !direct.includes(el));
    const scored = [...direct, ...generic].map((el) => {
      const own = textOf(el), cls = String(el.className || ''), href = el.getAttribute?.('href') || '', data = (el.getAttribute?.('data-coupon') || '').toLowerCase();
      if (RE.danger.test(own)) return { el, score: -100 };
      let score = 0;
      if (data && (!target || data === target)) score += 40;
      if (/woocommerce-remove-coupon|remove[-_]coupon/i.test(cls)) score += 25;
      if (/remove_coupon/i.test(href)) score += 20;
      if (target && decodeURIComponent(href).toLowerCase().includes(target)) score += 20;
      if (RE.remove.test(own)) score += 10;
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) {
        const ctx = (p.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (target && ctx.includes(target)) score += 16;
        if (RE.coupon.test(ctx) && ctx.length < 400) score += 4;
      }
      if (!visible(el) && score < 35) score -= 15;
      return { el, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 15 ? scored[0].el : null;
  }

  async function waitForUpdate(ms = 1800) {
    await sleep(ms);
    await sleep(250);
  }

  async function removeCoupon(code, baseline) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remove = findRemoveButton(code);
      if (remove) {
        safeClick(remove);
        await waitForUpdate(1200 + attempt * 500);
        for (let i = 0; i < 5; i += 1) {
          if (!couponStillApplied(code)) return true;
          const now = snapshotTotals();
          if (Number.isFinite(baseline.total) && Number.isFinite(now.total) && Math.abs(now.total - baseline.total) < 0.02) return true;
          await sleep(400);
        }
      }
      const input = findCouponInput();
      if (input && String(input.value || '').toLowerCase() === code.toLowerCase()) setValue(input, '');
    }
    return !couponStillApplied(code);
  }

  async function clearExistingCoupons() {
    for (let guard = 0; guard < 6; guard += 1) {
      const dataEl = [...document.querySelectorAll('[data-coupon]')].find((el) => /remove|coupon/i.test(`${el.className || ''} ${el.getAttribute?.('href') || ''}`));
      const code = dataEl?.getAttribute?.('data-coupon') || '';
      const remove = findRemoveButton(code);
      if (!remove) return true;
      safeClick(remove);
      await waitForUpdate(1200);
    }
    return !findRemoveButton('');
  }

  function classify(message, before, after, code, messageChanged) {
    if (RE.expired.test(message)) return 'EXPIRED';
    if (RE.minimum.test(message)) return 'MINIMUM_SPEND_NOT_MET';
    if (RE.eligible.test(message)) return 'PRODUCT_NOT_ELIGIBLE';
    if (RE.used.test(message)) return 'ALREADY_USED';
    if (RE.login.test(message)) return 'LOGIN_REQUIRED';
    if (RE.stack.test(message)) return 'NOT_STACKABLE';
    if (RE.invalid.test(message)) return 'INVALID';
    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const raised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    if (saved || raised || couponStillApplied(code)) return 'WORKING';
    if (messageChanged && RE.success.test(message)) return 'WORKING_UNMEASURED';
    return 'UNKNOWN';
  }

  function computeDiscount(before, after, message = '') {
    let amount = null;
    if (Number.isFinite(before.total) && Number.isFinite(after.total) && before.total > after.total) amount = before.total - after.total;
    else if (Number.isFinite(after.discount)) {
      const prior = Number.isFinite(before.discount) ? before.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    const base = Number.isFinite(before.subtotal) && before.subtotal > 0 ? before.subtotal : (Number.isFinite(before.total) && before.total > 0 ? before.total : null);
    let percent = amount !== null && base ? (amount / base) * 100 : null;
    if (percent === null) {
      const p = message.match(/\b(\d{1,2}(?:\.\d+)?)\s*%/);
      if (p) percent = Number(p[1]);
    }
    return { amount: amount !== null ? Math.round(amount * 100) / 100 : null, percent: percent !== null ? Math.round(percent * 100) / 100 : null };
  }

  async function applyOne(code, baseline) {
    const input = findCouponInput();
    if (!input) throw new Error('Coupon/discount field not found on this page. Phase 1 expects the field to be visible.');
    const apply = findApplyButton(input);
    if (!apply) throw new Error('Apply coupon button not found near the coupon field.');
    const beforeMessage = collectMessages();
    setValue(input, ''); await sleep(80); setValue(input, code);
    safeClick(apply);
    await waitForUpdate(1400);
    const after = snapshotTotals();
    const message = collectMessages(code);
    const status = classify(message, baseline, after, code, message !== beforeMessage);
    const discount = computeDiscount(baseline, after, message);
    return {
      code, status, discountPercent: discount.percent, discountAmount: discount.amount,
      currencySymbol: after.currencySymbol || baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal,
      baselineTotal: baseline.total, afterTotal: after.total, message: message || 'No clear success/error message was detected.',
      testedAt: new Date().toISOString()
    };
  }

  function chooseBest(results) {
    const working = results.filter((r) => r.status === 'WORKING' || r.status === 'WORKING_UNMEASURED');
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
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true; abortRequested = false;
    try {
      if (!findCouponInput()) throw new Error('Coupon/discount field not found. Make it visible on cart/checkout and try again.');
      notify('Checking for any coupon already applied…');
      const cleaned = await clearExistingCoupons();
      if (!cleaned) throw new Error('An existing coupon is applied and could not be removed safely. Remove it manually and retry.');
      const baseline = snapshotTotals();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline, results: [], best: null, summary: '' };

      for (let i = 0; i < codes.length; i += 1) {
        if (abortRequested) { run.summary = `Stopped after ${run.results.length} code(s).`; break; }
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code}`, run);
        const result = await applyOne(code, baseline);
        run.results.push(result);
        run.best = chooseBest(run.results);
        notify(`${code}: ${result.status}`, run);

        const applied = couponStillApplied(code) || result.status === 'WORKING' || result.status === 'WORKING_UNMEASURED';
        if (applied && i < codes.length - 1) {
          notify(`${code} worked. Removing it before the next code…`, run);
          const removed = await removeCoupon(code, baseline);
          if (!removed) {
            run.results.push({ code: '—', status: 'RESET_REQUIRED', discountPercent: null, discountAmount: null, currencySymbol: baseline.currencySymbol || '', baselineSubtotal: baseline.subtotal, baselineTotal: baseline.total, afterTotal: snapshotTotals().total, message: `Working coupon ${code} could not be safely removed. Testing stopped to avoid stacked/incorrect results.`, testedAt: new Date().toISOString() });
            run.summary = `Stopped because ${code} could not be removed safely.`;
            break;
          }
        } else {
          const input = findCouponInput();
          if (input) setValue(input, '');
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
