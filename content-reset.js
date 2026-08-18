(() => {
  if (window.__couponTestResetHelperLoaded) return;
  window.__couponTestResetHelperLoaded = true;

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
      el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.getAttribute?.('name'),
      el?.getAttribute?.('id'), el?.getAttribute?.('class'), el?.textContent
    ].filter(Boolean).join(' '));
  }

  function isCouponish(text) {
    return /coupon|promo|promotion|discount|voucher|code|gift/i.test(text || '');
  }

  function isCartItemRemoveControl(el) {
    if (!el) return false;
    const t = textOf(el);
    const cls = String(el.className || '');
    const href = el.getAttribute?.('href') || '';
    if (/remove\s*(this\s*)?(item|product)|delete\s*(this\s*)?(item|product)|remove\s+from\s+cart|trash/i.test(t)) return true;
    if (/remove_from_cart|remove-item|remove_item|cart_item_key|product-remove/i.test(`${cls} ${href}`)) return true;
    if (el.closest?.('.product-remove,.cart_item,.woocommerce-cart-form__cart-item,.wc-block-cart-items__row,[data-cart-item-key],[class*="cart-item"],[class*="line-item"]')) {
      if (/\bremove\b|delete|trash|×|✕|✖/i.test(`${t} ${cls}`) && !isCouponish(t)) return true;
    }
    return false;
  }

  function safeClick(el) {
    if (!el || !visible(el)) return false;
    if (isCartItemRemoveControl(el)) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const type of ['pointerdown','mousedown','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    try { el.click(); } catch {}
    return true;
  }

  function looksLikeAppliedCouponText(text) {
    const t = clean(text);
    if (!t || t.length > 180) return false;
    if (/subtotal|total|checkout|cart|shipping|tax|paypal|pay later|apple pay|google pay/i.test(t)) return false;
    if (/[-−]\s*(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)?\s*\d[\d.,]*/i.test(t) && /[A-Z0-9][A-Z0-9_-]{2,}/.test(t)) return true;
    if (isCouponish(t) && /[A-Z0-9][A-Z0-9_-]{2,}/.test(t)) return true;
    return false;
  }

  function appliedCouponChips() {
    const selectors = [
      '[data-coupon]','[data-coupon-code]','[data-discount-code]','[data-testid*="discount" i]',
      '[class*="discount" i]','[class*="coupon" i]','[class*="promo" i]','[aria-label*="discount" i]',
      'li','div','span'
    ];
    const chips = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);
        const t = clean(el.innerText || el.textContent || textOf(el));
        const data = clean(el.getAttribute?.('data-coupon') || el.getAttribute?.('data-coupon-code') || el.getAttribute?.('data-discount-code'));
        if (data || looksLikeAppliedCouponText(t)) chips.push({ el, text: data || t, score: data ? 50 : (/[-−]\s*[$€£¥₹]?\d/.test(t) ? 30 : 10) });
      }
    }
    return chips.sort((a, b) => b.score - a.score).map((x) => x.el);
  }

  function directRemoveButtons() {
    const selectors = [
      'button[aria-label*="remove" i]','button[aria-label*="delete" i]','button[title*="remove" i]',
      'button[name*="remove" i]','a[aria-label*="remove" i]','a[title*="remove" i]',
      '[data-testid*="remove" i]','[data-test*="remove" i]','[class*="remove" i]',
      'a[href*="remove_coupon" i]','a.woocommerce-remove-coupon','button.woocommerce-remove-coupon'
    ];
    return [...new Set(selectors.flatMap((s) => [...document.querySelectorAll(s)]))]
      .filter((el) => visible(el) && !isCartItemRemoveControl(el) && (isCouponish(textOf(el)) || isCouponish(textOf(el.closest?.('[class*="discount" i],[class*="coupon" i],[class*="promo" i],tr.cart-discount')))));
  }

  function removeTargetsFromChip(chip) {
    const targets = [];
    const local = chip.querySelectorAll?.('button,a,[role="button"],svg,[aria-label*="remove" i],[title*="remove" i],[class*="remove" i]') || [];
    for (const el of local) {
      const clickable = el.closest?.('button,a,[role="button"]') || el;
      if (clickable && !isCartItemRemoveControl(clickable)) targets.push(clickable);
    }
    const parent = chip.parentElement;
    if (parent) {
      for (const el of parent.querySelectorAll('button,a,[role="button"],svg,[aria-label*="remove" i],[title*="remove" i],[class*="remove" i]')) {
        const clickable = el.closest?.('button,a,[role="button"]') || el;
        if (clickable && !isCartItemRemoveControl(clickable)) targets.push(clickable);
      }
    }
    return [...new Set(targets)].filter(visible);
  }

  async function keyboardRemove(chip) {
    try {
      chip.focus?.();
      chip.click?.();
      for (const key of ['Backspace', 'Delete', 'Escape']) {
        for (const type of ['keydown','keyup']) {
          chip.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
        }
        await sleep(250);
      }
    } catch {}
  }

  async function resetAppliedCoupons() {
    const beforeText = clean(document.body.innerText);

    for (const btn of directRemoveButtons()) {
      if (safeClick(btn)) {
        await sleep(1200);
        if (clean(document.body.innerText) !== beforeText) return { ok: true, message: 'Applied coupon reset using remove button.' };
      }
    }

    const chips = appliedCouponChips();
    for (const chip of chips) {
      for (const target of removeTargetsFromChip(chip)) {
        if (safeClick(target)) {
          await sleep(1200);
          if (!document.body.contains(chip) || clean(chip.innerText || chip.textContent) === '' || clean(document.body.innerText) !== beforeText) {
            return { ok: true, message: 'Applied coupon reset using coupon chip control.' };
          }
        }
      }
      await keyboardRemove(chip);
      await sleep(800);
      if (!document.body.contains(chip) || clean(chip.innerText || chip.textContent) === '') return { ok: true, message: 'Applied coupon reset using keyboard fallback.' };
    }

    return { ok: false, message: chips.length ? 'Could not find a safe clickable remove control inside the applied coupon chip. Remove it manually, then continue.' : 'No applied coupon chip was found on this page.' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'RESET_APPLIED_COUPONS') return;
    resetAppliedCoupons()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, message: error?.message || String(error) }));
    return true;
  });
})();
