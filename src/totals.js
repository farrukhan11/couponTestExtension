// src/totals.js — scrape the order totals (label-first), settle, multi-currency.
(() => {
  const CT = globalThis.CT;
  if (!CT || !CT.dom || CT.totals) return;
  const { qAll, visible, clean } = CT.dom;
  const sleep = CT.dom.sleep;

  const MONEY_RE = /(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi;

  function parseMoney(raw) {
    if (raw == null) return null;
    let s = String(raw).replace(/[^0-9.,\-]/g, '');
    if (!s) return null;
    const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  function moneyFromText(text) {
    const m = [...String(text || '').matchAll(MONEY_RE)];
    return m.length ? parseMoney(m[m.length - 1][0]) : null;
  }
  function currencyFromText(text) {
    const t = String(text || '');
    if (t.includes('$')) return '$';
    if (t.includes('€')) return '€';
    if (t.includes('£')) return '£';
    if (t.includes('¥')) return '¥';
    if (t.includes('₹')) return '₹';
    const code = t.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i);
    return code ? `${code[1].toUpperCase()} ` : '';
  }

  function firstAmount(selectors) {
    for (const selector of selectors) {
      for (const el of qAll(selector)) {
        const raw = clean(el.textContent || '');
        if (!raw || raw.length > 180) continue;
        if (!visible(el)) continue;
        const amount = moneyFromText(raw);
        if (amount === null) continue;
        return { amount, currency: currencyFromText(raw) };
      }
    }
    return null;
  }

  // Label-based detection: find the row/among text that names the total and
  // read the amount from the SAME element. This picks the charged figure on
  // pages that also show a struck-through original (Sellfy: "$948 $568.80").
  function labelledAmount(kind) {
    const rules = kind === 'subtotal'
      ? [/\bsub\s*-?\s*total\b/i, /\bitems?\s+total\b/i, /\bsubtotale\b/i, /\bzwischensumme\b/i, /\bsubtotal\b/i, /\bsoustotal\b/i, /\bsubtotal\b/i]
      : [/\bgrand\s+total\b/i, /\border\s+total\b/i, /\btotal\s+due\b/i, /\btotal\s+a\s+pagar\b/i, /\bimporte\s+total\b/i, /^\s*total\b/i, /^\s*totale\b/i, /\btotale\b/i, /\bsomme\b/i, /\bgesamt\b/i, /\bsumme\b/i];
    const hits = [];
    for (const el of qAll('div,span,p,li,dt,dd,tr,td,th,strong,b,section')) {
      const raw = el.textContent || '';
      if (!raw || raw.length > 180) continue;
      if (kind === 'total' && /sub\s*-?\s*total|savings?|you\s+saved|discount|sconto|risparmi|reduction|rabatt|descuento/i.test(raw)) continue;
      if (!rules.some((r) => r.test(raw))) continue;
      if (!visible(el)) continue;
      const t = clean(el.innerText || raw);
      const amount = moneyFromText(t);
      if (amount === null) continue;
      const score = (t.length < 80 ? 2 : 0) + (rules[0].test(t) ? 2 : 0) - Math.min(10, Math.round(t.length / 40));
      hits.push({ amount, currency: currencyFromText(t), score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0] || null;
  }

  function snapshot() {
    const subtotal = labelledAmount('subtotal')
      || firstAmount(['.cart-subtotal .amount', '.cart-subtotal .woocommerce-Price-amount', '[class*="subtotal" i] [class*="amount" i]', '[data-testid*="subtotal" i]']);
    const total = labelledAmount('total')
      || firstAmount(['.order-total .amount', '.order-total .woocommerce-Price-amount', '[class*="total" i] [class*="amount" i]', '[data-testid*="total" i]', '[class*="grand-total" i]']);
    const discount = firstAmount(['tr.cart-discount .amount', '[class*="discount" i] [class*="amount" i]', '[data-testid*="discount" i]', '[class*="sconto" i] [class*="amount" i]']);
    return {
      subtotal: subtotal ? subtotal.amount : null,
      total: total ? total.amount : null,
      discount: discount ? discount.amount : null,
      currencySymbol: (subtotal && subtotal.currency) || (total && total.currency) || (discount && discount.currency) || ''
    };
  }

  function changed(before, after) {
    return ['total', 'discount', 'subtotal'].some((k) =>
      Number.isFinite(before[k]) && Number.isFinite(after[k]) && Math.abs(before[k] - after[k]) > 0.005);
  }
  async function settle(timeoutMs = 1200) {
    const started = Date.now();
    let prev = snapshot();
    while (Date.now() - started < timeoutMs) {
      await sleep(200);
      const cur = snapshot();
      if (!changed(prev, cur)) return cur;
      prev = cur;
    }
    return snapshot();
  }

  CT.totals = { snapshot, settle, changed, parseMoney, moneyFromText, currencyFromText };
})();
