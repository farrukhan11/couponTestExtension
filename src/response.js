// src/response.js — capture what the page says after Apply, classify the
// status, and compute the discount. Structure/behaviour first, multilingual.
(() => {
  const CT = globalThis.CT;
  if (!CT || !CT.dom || !CT.totals || CT.response) return;
  const { RE, sleep, clean, qAll, visible, deepClosest } = CT.dom;
  const { snapshot, changed, parseMoney, moneyFromText, currencyFromText } = CT.totals;

  const MONEY_AMOUNT = /(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*\d|[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d|\d\s*%/;
  const DISCOUNT_LINE = /[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d/;

  const SCAN = 'li,div,span,p,small,strong,td,th,dd,dt,b,[role="alert"],[class*="alert" i],[class*="notice" i],[class*="discount" i],[class*="coupon" i],[class*="promo" i],[class*="error" i],[class*="message" i]';
  // Cheap text prefilter so we only pay for visibility checks on elements that
  // could plausibly be a coupon response (keeps the poll loop fast).
  const PREFILTER = /applied|success|saved|saving|invalid|expired|scadut|minimum|eligible|already|usage|combin|stack|not\s+valid|does\s*not\s*apply|correct|coupon|promo|discount|sconto|codice|code|[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d|\d\s*%/i;

  // Cached visible small-text scan. Rebuilt when the DOM mutates or at most
  // ~2.5x/sec — so a removed/hidden chip can't linger and be mis-read.
  let cache = { list: null, at: 0, mut: -1 };
  function textNodes() {
    const mut = CT.dom.now ? CT.dom.now() : 0;
    if (cache.list && cache.mut === mut && Date.now() - cache.at < 400) return cache.list;
    const out = [];
    const seen = new Set();
    for (const el of qAll(SCAN)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const raw = el.textContent || '';
      if (!raw || raw.length > 400) continue;
      if (!PREFILTER.test(raw)) continue;
      const t = clean(raw);
      if (!t || t.length > 300) continue;
      if (!el.isConnected || !visible(el)) continue;
      out.push({ el, text: t });
    }
    cache = { list: out, at: Date.now(), mut };
    return out;
  }
  function textSet() { return new Set(textNodes().map((n) => n.text)); }

  const normalizeCode = (c) => clean(c).toLowerCase();
  const containsCode = (t, code) => clean(t).toLowerCase().includes(normalizeCode(code));

  function isErrorish(t) {
    const s = String(t || '');
    return RE.invalid.test(s) || RE.expired.test(s) || RE.minimum.test(s) || RE.eligible.test(s)
      || RE.used.test(s) || RE.stack.test(s)
      || /\b(does not apply|not valid|isn['’]?t valid|not eligible|excluded|could not be applied|cannot be applied|couldn['’]?t be applied|can['’]?t be applied|cannot be used|not applied|not applicable|failed)\b/i.test(s);
  }
  function hasDiscountEvidence(t) {
    const s = clean(t);
    if (!s || isErrorish(s)) return false;
    if (!/(savings?|you\s+saved|discount|sconto|risparmi|reduction|rabatt|descuento|aplicado)\b/i.test(s) && !/\b(off|applied|saved|saves?)\b/i.test(s)) return false;
    return MONEY_AMOUNT.test(s);
  }
  function isAppliedChip(t, code) {
    const target = normalizeCode(code);
    if (!target) return false;
    const s = clean(t).toLowerCase();
    if (!s.includes(target) || isErrorish(s)) return false;
    const remainder = s.split(target).join('').replace(/[×✕✖✗·•|\-–—,.:;()\[\]{}'"`\s]/g, '');
    return remainder.length <= 3;
  }

  const NOTICE_SEL = '[role="alert"],[aria-live="assertive"],[aria-live="polite"],[class*="error" i],[class*="invalid" i],[class*="notice" i],[class*="warning" i]';
  function noticeElements() {
    const out = [];
    const seen = new Set();
    for (const el of qAll(NOTICE_SEL)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const t = clean(el.textContent || '');
      if (!t || t.length > 300) continue;
      if (!visible(el)) continue;
      out.push(el);
    }
    return out;
  }
  function noticeSnapshot() {
    const nodes = new Set(), texts = new Set();
    for (const el of noticeElements()) { nodes.add(el); texts.add(clean(el.textContent || '')); }
    return { nodes, texts };
  }
  function freshNotice(snap, code) {
    for (const el of noticeElements()) {
      const t = clean(el.textContent || '');
      if (!t) continue;
      if (code && containsCode(t, code)) continue;
      if (snap.nodes.has(el) && snap.texts.has(t)) continue;
      return t;
    }
    return '';
  }

  function couponLine(code, beforeSet) {
    const target = normalizeCode(code);
    for (const { text: t } of textNodes()) {
      if (beforeSet && beforeSet.has(t)) continue;
      if (!t.toLowerCase().includes(target)) continue;
      if (isErrorish(t)) continue;
      if (DISCOUNT_LINE.test(t) || RE.success.test(t) || /\b(off|savings?|applied|saved|saves?|sconto|risparmi)\b/i.test(t) || isAppliedChip(t, code)) return { text: t };
    }
    return null;
  }
  function couponApplied(code, beforeSet) { return Boolean(code) && Boolean(couponLine(code, beforeSet)); }

  function discountNearCode(code, beforeSet) {
    const target = normalizeCode(code);
    if (!target) return null;
    for (const { text: t } of textNodes()) {
      if (beforeSet && beforeSet.has(t)) continue;
      if (!t.toLowerCase().includes(target)) continue;
      if (isErrorish(t)) continue;
      const m = t.match(/[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*(\d[\d.,]*)/);
      if (!m) continue;
      const amount = parseMoney(m[1]);
      if (amount !== null) return { amount, currency: currencyFromText(t), text: t };
    }
    return null;
  }

  function collectResponse(code, beforeSet) {
    const fresh = textNodes().map((n) => n.text).filter((t) => !(beforeSet && beforeSet.has(t)));
    const about = (t) => containsCode(t, code);
    const stale = (t) => {
      if (!code || about(t)) return false;
      if (!/\b(does not apply|not eligible|non\s+(?:applicabile|valido))\b/i.test(t)) return false;
      const others = (t.match(/\b[A-Z0-9][A-Z0-9_-]{2,}\b/g) || []).map((c) => c.toUpperCase());
      return others.some((c) => c !== code.toUpperCase());
    };
    const withAmount = fresh.find((t) => about(t) && DISCOUNT_LINE.test(t));
    if (withAmount) return withAmount;
    const ok = fresh.find((t) => about(t) && !isErrorish(t) && (RE.success.test(t) || isAppliedChip(t, code)));
    if (ok) return ok;
    const err = fresh.find((t) => about(t) && isErrorish(t));
    if (err) return err;
    const freshErr = fresh.find((t) => isErrorish(t) && !stale(t));
    if (freshErr) return freshErr;
    const savings = fresh.find((t) => !isErrorish(t) && hasDiscountEvidence(t));
    if (savings) return savings;
    return fresh.find((t) => about(t)) || '';
  }

  async function waitForResponse(code, beforeTotals, beforeSet, beforeNotices, timeoutMs = 4500) {
    const started = Date.now();
    let latestTotals = snapshot();
    let latestText = '';
    const noticeBase = beforeNotices || noticeSnapshot();
    while (Date.now() - started < timeoutMs) {
      if (CT.engine && CT.engine.isAborted && CT.engine.isAborted()) break;
      await sleep(150);
      latestTotals = snapshot();
      latestText = collectResponse(code, beforeSet);
      const applied = couponApplied(code, beforeSet);
      const notice = latestText ? '' : freshNotice(noticeBase, code);
      const about = Boolean(latestText) && containsCode(latestText, code);
      const terminal = Boolean(latestText) && (about || RE.success.test(latestText) || hasDiscountEvidence(latestText));
      if (applied || changed(beforeTotals, latestTotals) || terminal || notice) {
        let settled = latestTotals;
        for (let i = 0; i < 2; i += 1) {
          await sleep(150);
          const next = snapshot();
          const stable = !changed(settled, next);
          settled = next;
          if (stable) break;
        }
        return { timedOut: false, text: collectResponse(code, beforeSet) || latestText || notice, totals: settled, applied: couponApplied(code, beforeSet) };
      }
    }
    return { timedOut: true, text: collectResponse(code, beforeSet) || freshNotice(noticeBase, code), totals: latestTotals, applied: couponApplied(code, beforeSet) };
  }

  function classify(code, text, before, after, applied, timedOut, beforeSet) {
    if (applied || couponApplied(code, beforeSet)) return 'WORKING';
    const disc = discountNearCode(code, beforeSet);
    if (disc && disc.amount > 0) return 'WORKING';
    const saved = Number.isFinite(before.total) && Number.isFinite(after.total) && before.total - after.total > 0.005;
    const raised = Number.isFinite(after.discount) && after.discount - (Number.isFinite(before.discount) ? before.discount : 0) > 0.005;
    const about = Boolean(text) && containsCode(text, code);
    if ((saved || raised) && !about) return 'WORKING';
    if (text && !isErrorish(text) && hasDiscountEvidence(text)) return 'WORKING';
    if (isErrorish(text)) {
      if (RE.expired.test(text)) return 'EXPIRED';
      if (RE.minimum.test(text)) return 'MINIMUM_SPEND_NOT_MET';
      if (RE.eligible.test(text)) return 'PRODUCT_NOT_ELIGIBLE';
      if (RE.used.test(text)) return 'ALREADY_USED';
      if (RE.stack.test(text)) return 'NOT_STACKABLE';
      if (RE.invalid.test(text)) return 'INVALID';
      return 'UNKNOWN_RESPONSE';
    }
    if (text && RE.success.test(text)) return 'WORKING';
    if (saved || raised) return 'WORKING';
    if (timedOut) return 'NO_RESPONSE';
    return 'UNKNOWN_RESPONSE';
  }

  function computeDiscount(ref, after, text, code, beforeSet) {
    let amount = null;
    const disc = discountNearCode(code, beforeSet);
    if (disc && disc.amount > 0) amount = disc.amount;
    if (amount === null && Number.isFinite(ref.total) && Number.isFinite(after.total) && ref.total > after.total) amount = ref.total - after.total;
    if (amount === null && Number.isFinite(after.discount)) {
      const prior = Number.isFinite(ref.discount) ? ref.discount : 0;
      if (after.discount > prior) amount = after.discount - prior;
    }
    if (amount === null && text && hasDiscountEvidence(text)) amount = moneyFromText(text);
    const bases = [ref.subtotal, ref.total, after.subtotal, after.total].filter((v) => Number.isFinite(v) && v > 0);
    const base = bases.length ? Math.max(...bases) : null;
    let percent = amount !== null && base > 0 ? (amount / base) * 100 : null;
    if (percent === null) {
      const m = clean(text || '').match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
      if (m) percent = Number(m[1].replace(',', '.'));
    }
    return {
      amount: amount !== null ? Math.round(amount * 100) / 100 : null,
      percent: percent !== null ? Math.round(percent * 100) / 100 : null
    };
  }

  CT.response = {
    textNodes, textSet, noticeSnapshot, freshNotice, collectResponse, waitForResponse,
    classify, computeDiscount, discountNearCode, couponApplied, couponLine, containsCode, isErrorish, hasDiscountEvidence
  };
})();
