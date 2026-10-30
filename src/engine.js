// src/engine.js — orchestration: baseline, per-code apply, coupon removal,
// best selection, persistence. Safety: never order/pay/subscribe, never
// navigate, abortable.
(() => {
  const CT = globalThis.CT;
  if (!CT || !CT.dom || !CT.detect || !CT.totals || !CT.response || CT.engine) return;
  const { sleep, clean, qAll, visible, setValue, safeClick, nativeClick, isDanger } = CT.dom;
  const { snapshot, settle } = CT.totals;
  const R = CT.response;

  let running = false;
  let aborted = false;
  let liveRun = null;
  let tabId = null;
  let applyMethod = 'none';

  function isRunning() { return running; }
  function isAborted() { return aborted; }
  function currentRun() { return liveRun; }

  function persist(run) {
    if (!run) return;
    const data = { 'couponTest:last': run };
    if (tabId != null) data[`couponTest:${tabId}`] = run;
    try { chrome.storage.local.set(data); } catch {}
  }
  function notify(summary, run) {
    try { chrome.runtime.sendMessage({ type: 'COUPON_TEST_PROGRESS', payload: { summary, run } }).catch(() => {}); } catch {}
  }

  function cartItemCount() {
    const selectors = ['tr.cart_item', '.woocommerce-cart-form__cart-item.cart_item', '.wc-block-cart-items__row', '[data-cart-item-key]'];
    const set = new Set();
    for (const s of selectors) for (const el of qAll(s)) if (visible(el)) set.add(el);
    return set.size;
  }

  async function ensureField() {
    let input = CT.detect.findField();
    if (input && visible(input) && input.isConnected) return input;
    for (let i = 0; i < 3; i += 1) {
      await CT.detect.openSection();
      await sleep(250);
      input = CT.detect.findField();
      if (input && visible(input) && input.isConnected) return input;
      const chip = findAnyChip();
      if (!input && chip) {
        await removeCoupon(null);
        await sleep(400);
        input = CT.detect.findField();
        if (input && visible(input) && input.isConnected) return input;
      }
    }
    return null;
  }

  function nudge(input) {
    if (!input) return;
    try {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.focus();
    } catch {}
  }
  async function waitEnabled(button, timeoutMs = 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') return true;
      await sleep(120);
    }
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }
  function submit(input) {
    if (!input) return false;
    try { input.focus(); } catch {}
    for (const type of ['keydown', 'keypress', 'keyup']) {
      try { input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); } catch {}
    }
    const form = input.form || (input.closest && input.closest('form'));
    if (!form) return false;
    if (qAll('button,input[type="submit"]', form).some(isDanger)) return false;
    const btn = CT.dom.q('button[type="submit"],input[type="submit"]', form);
    if (btn && visible(btn) && safeClick(btn)) return true;
    try { if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; } } catch {}
    return false;
  }
  async function pressApply(code, inputIn, useNative = false) {
    let input = inputIn;
    applyMethod = 'none';
    let apply = CT.detect.findApply(input);
    if (!apply || !visible(input) || !input.isConnected) {
      const reopened = await ensureField();
      if (reopened) { input = reopened; setValue(input, code); await sleep(200); }
      apply = CT.detect.findApply(input);
    }
    if (apply) {
      if (apply.disabled || apply.getAttribute('aria-disabled') === 'true') {
        nudge(input);
        await waitEnabled(apply, 1000);
      }
      if (apply.disabled) { try { apply.disabled = false; } catch {} }
      if (apply.getAttribute('aria-disabled') === 'true') { try { apply.setAttribute('aria-disabled', 'false'); } catch {} }
      if (useNative && nativeClick(apply)) { applyMethod = 'button(native)'; return input; }
      if (safeClick(apply)) { applyMethod = 'button'; return input; }
      if (nativeClick(apply)) { applyMethod = 'button(native)'; return input; }
    }
    applyMethod = submit(input) ? 'enter' : 'none';
    return input;
  }

  function findAnyChip() {
    for (const { el, text } of R.textNodes()) {
      if (R.isErrorish(text)) continue;
      if (!/[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(text)) continue;
      if (!/[A-Z0-9][A-Z0-9_-]{2,}/.test(text)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 150000) continue;
      return el;
    }
    return null;
  }
  function findChip(code) {
    const target = clean(code).toLowerCase();
    let best = null, bestArea = Infinity;
    for (const { el, text } of R.textNodes()) {
      if (target && !text.toLowerCase().includes(target)) continue;
      if (R.isErrorish(text)) continue;
      if (!/[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/.test(text) && !R.containsCode(text, code)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > 0 && area < bestArea) { bestArea = area; best = el; }
    }
    return best;
  }
  function removeControlByName(code) {
    const target = clean(code || '').toLowerCase();
    for (const el of CT.dom.qAll('button,[role="button"],a')) {
      if (!visible(el) || CT.dom.isCartRemove(el) || isDanger(el)) continue;
      const label = clean([el.getAttribute('aria-label'), el.getAttribute('title'), CT.dom.text(el)].filter(Boolean).join(' ')).toLowerCase();
      if (!label) continue;
      if (/(remove|delete|clear|dismiss|rimuovi|elimina|eliminar|supprimer|entfernen)/.test(label) && (!target || label.includes(target))) return el;
    }
    return null;
  }
  function removeControlNearChip(chip) {
    if (!chip) return null;
    let scope = chip;
    for (let i = 0; i < 4 && scope; i += 1, scope = scope.parentElement) {
      for (const b of qAll('button,[role="button"],[aria-label*="remove" i],[aria-label*="rimuovi" i],[title*="remove" i],[class*="remove" i],[class*="close" i]', scope)) {
        if (!visible(b) || CT.dom.isCartRemove(b) || isDanger(b)) continue;
        const label = clean([b.getAttribute && b.getAttribute('aria-label'), b.getAttribute && b.getAttribute('title'), CT.dom.text(b)].filter(Boolean).join(' '));
        if (/remove|delete|clear|dismiss|close|rimuovi|elimina|supprimer|entfernen|×|✕|✖/i.test(label)) return b;
      }
    }
    return null;
  }
  async function removeCoupon(code) {
    const direct = removeControlByName(code);
    if (direct && safeClick(direct)) { await sleep(900); return true; }
    const chip = code ? findChip(code) : findAnyChip();
    const near = removeControlNearChip(chip);
    if (near && safeClick(near)) { await sleep(900); return true; }
    // Fallback: clear the field and apply an empty value (some stores remove it).
    const input = CT.detect.findField();
    if (input) {
      setValue(input, '');
      await sleep(200);
      await pressApply('', input);
      await sleep(900);
      return true;
    }
    return false;
  }

  async function applyCode(code, baseline) {
    let input = await ensureField();
    if (!input) throw new Error('Coupon/discount field not found on this page.');
    setValue(input, '');
    await sleep(120);
    const beforeSet = R.textSet();
    const beforeNotices = R.noticeSnapshot();
    const before = await settle(1000);

    setValue(input, code);
    input = await pressApply(code, input);
    let resp = await R.waitForResponse(code, before, beforeSet, beforeNotices, 4500);
    if (!resp.text && resp.timedOut && !resp.applied) {
      await sleep(120);
      input = await pressApply(code, input, true);
      resp = await R.waitForResponse(code, before, beforeSet, beforeNotices, 3500);
    }
    const status = R.classify(code, resp.text, before, resp.totals, resp.applied, resp.timedOut, beforeSet);
    const ref = baseline || before;
    const discount = status === 'WORKING' ? R.computeDiscount(ref, resp.totals, resp.text, code, beforeSet) : { amount: null, percent: null };
    let message = resp.text || (resp.timedOut ? 'No clear coupon response appeared.' : 'No clear response text detected.');
    message += ` (apply: ${applyMethod})`;
    return {
      code, status,
      discountPercent: discount.percent, discountAmount: discount.amount,
      currencySymbol: resp.totals.currencySymbol || ref.currencySymbol || before.currencySymbol || '',
      baselineSubtotal: Number.isFinite(ref.subtotal) ? ref.subtotal : before.subtotal,
      baselineTotal: Number.isFinite(ref.total) ? ref.total : before.total,
      afterTotal: resp.totals.total,
      applyMethod,
      field: CT.detect.fieldDescriptor(input),
      message,
      responseTimedOut: resp.timedOut,
      testedAt: new Date().toISOString()
    };
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

  async function runTests(codes, reapplyBest, tid) {
    if (running) throw new Error('Coupon testing is already running on this page.');
    running = true; aborted = false; tabId = tid; liveRun = null;
    try {
      if (!(await ensureField())) throw new Error('Coupon/discount field not found. Open the cart or checkout where the discount box is.');
      if (CT.baseline && CT.baseline.ready) { try { await CT.baseline.ready; } catch {} }
      const base = (CT.baseline && CT.baseline.get()) || snapshot();
      const run = { host: location.hostname, url: location.href, startedAt: new Date().toISOString(), baseline: base, results: [], best: null, summary: '', running: true };
      liveRun = run;
      persist(run);

      const existing = findAnyChip();
      if (existing) {
        const txt = clean(existing.innerText || existing.textContent || '');
        const found = codes.find((c) => txt.toUpperCase().includes(c.toUpperCase()));
        if (found) {
          run.results.push({
            code: found, status: 'WORKING', discountPercent: null, discountAmount: null,
            currencySymbol: base.currencySymbol || '', baselineTotal: base.total, afterTotal: snapshot().total,
            message: 'Was already applied before testing.', testedAt: new Date().toISOString()
          });
        }
        notify('An applied coupon is already on the page — removing it…', run);
        await removeCoupon(found || null);
        await sleep(400);
      }

      const itemBaseline = cartItemCount();
      for (let i = 0; i < codes.length; i += 1) {
        if (aborted) { run.summary = `Stopped after ${run.results.length} code(s).`; persist(run); break; }
        if (itemBaseline > 0 && cartItemCount() < itemBaseline) throw new Error('Safety stop: cart item count changed during testing.');
        const code = codes[i];
        notify(`Testing ${i + 1}/${codes.length}: ${code}`, run);
        const result = await applyCode(code, base);
        run.results.push(result);
        run.best = chooseBest(run.results);
        persist(run);
        notify(`${code}: ${result.status}`, run);
        if (result.status === 'WORKING' && i < codes.length - 1) {
          notify(`${code} worked — removing it before the next code…`, run);
          await removeCoupon(code);
        } else if (result.status !== 'WORKING') {
          const input = CT.detect.findField();
          if (input) setValue(input, '');
        }
      }

      run.best = chooseBest(run.results);
      if (!run.summary) run.summary = `Finished ${run.results.length} code(s). ${run.best ? `Best: ${run.best.code}.` : 'No working coupon detected.'}`;
      if (reapplyBest && run.best && !aborted) {
        notify(`Re-applying best code: ${run.best.code}`, run);
        await applyCode(run.best.code, base).catch(() => {});
        run.summary += ` Best code ${run.best.code} re-applied.`;
      }
      run.finishedAt = new Date().toISOString();
      run.running = false;
      notify(run.summary, run);
      persist(run);
      return run;
    } finally {
      running = false;
      if (liveRun) {
        liveRun.running = false;
        if (!liveRun.finishedAt) liveRun.finishedAt = new Date().toISOString();
        persist(liveRun);
      }
    }
  }

  function stop(reason) {
    aborted = true;
    if (liveRun) {
      liveRun.running = false;
      liveRun.finishedAt = liveRun.finishedAt || new Date().toISOString();
      liveRun.summary = reason || 'Stopped.';
      persist(liveRun);
    }
  }

  CT.engine = { runTests, stop, isRunning, isAborted, currentRun, applyCode, ensureField, removeCoupon };
})();
