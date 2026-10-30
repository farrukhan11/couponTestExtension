/* Shared checkout widget used by fixture.html so the CouponTest extension can
   be exercised against realistic, varied coupon flows.

   opts.mode:
     plain        - coupon input always visible (baseline)
     toggle       - "Have a coupon code?" button reveals the input
     accordion    - aria-expanded button reveals the input
     details      - native <details>/<summary>
     chipReplace  - after a working code the entry UI becomes an applied chip
   opts.lang: 'en' | 'it'  (localized labels / Apply button)
   opts.collapseOnBlur: hide the panel when the field loses focus (SPA-like)
   opts.shadow: render inside a shadow root (new-Shopify style)            */

function checkoutTemplate(root, opts = {}) {
  const mode = opts.mode || 'plain';
  const lang = opts.lang || 'en';
  const it = lang === 'it';
  const L = it
    ? { ph: 'Codice sconto', apply: 'Applica', toggle: 'Hai un codice sconto?', subtotal: 'Subtotale', discount: 'Sconto', total: 'Totale', saved: (c, s) => `Codice ${c} applicato! Hai risparmiato ${s}.`, expired: (c) => `Il codice ${c} è scaduto.`, invalid: (c) => `Il codice ${c} non è valido.`, notEligible: (c) => `Il codice ${c} non è applicabile agli articoli nel carrello.` }
    : { ph: 'Discount code', apply: 'Apply', toggle: 'Have a coupon code?', subtotal: 'Subtotal', discount: 'Order discount', total: 'Total', saved: (c, s) => `Coupon ${c} applied! You saved ${s}.`, expired: (c) => `Coupon ${c} has expired.`, invalid: (c) => `Coupon ${c} is invalid. Enter a valid discount code.`, notEligible: (c) => `Coupon ${c} is not eligible for the items in your cart.` };

  root.__couponOpts = { mode, lang, collapseOnBlur: opts.collapseOnBlur === true, shadow: opts.shadow === true };

  const couponForm = `
    <div class="coupon">
      <input type="text" placeholder="${L.ph}" aria-label="${L.ph}" name="discount_code" autocomplete="off" />
      <button type="button" data-apply>${L.apply}</button>
    </div>`;

  let entry;
  if (mode === 'plain') entry = couponForm;
  else if (mode === 'details') entry = `<details data-details><summary>${L.toggle}</summary>${couponForm}</details>`;
  else if (mode === 'accordion') entry = `<button type="button" data-toggle aria-expanded="false">${L.toggle} <span aria-hidden="true">▾</span></button><div data-panel hidden>${couponForm}</div>`;
  else entry = `<button type="button" data-toggle aria-expanded="false">${L.toggle}</button><div data-panel hidden>${couponForm}</div>`;

  root.innerHTML = `
    <style>
      .row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}
      .coupon{display:flex;gap:8px;margin:10px 0}
      .coupon-block[hidden]{display:none}
      input{flex:1;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px;font:inherit}
      button{padding:9px 14px;border:0;border-radius:8px;background:#101828;color:#fff;font:inherit;font-weight:700;cursor:pointer}
      [data-toggle]{background:transparent;color:#101828;font-weight:600;padding:6px 0;text-align:left}
      summary{cursor:pointer;font-weight:600;padding:6px 0}
      .msg{margin:8px 0;font-size:13px;min-height:18px}
      .msg.error{color:#b42318}.msg.ok{color:#067647}
      .chips:empty{display:none}
      .chip{display:inline-flex;align-items:center;gap:6px;background:#ecfdf3;color:#067647;border-radius:999px;padding:4px 8px;font-size:12px;margin-right:6px}
      .chip button{background:transparent;color:#067647;font-size:14px;padding:0 2px}
      .sub{font-weight:800}
    </style>
    <div class="coupon-block" data-coupon-block>${entry}</div>
    <div class="chips" data-chips></div>
    <div class="msg" role="alert" aria-live="polite"></div>
    <div class="totals">
      <div class="row"><span>${L.subtotal}</span><span data-subtotal>$200.00</span></div>
      <div class="row"><span>${L.discount}</span><span data-discount>$0.00</span></div>
      <div class="row sub"><span>${L.total}</span><span data-total>$200.00</span></div>
    </div>
  `;
}

function wireCheckout(root, opts = root.__couponOpts || {}) {
  const mode = opts.mode || 'plain';
  const lang = opts.lang || 'en';
  const it = lang === 'it';
  const CODES = window.COUPON_FIXTURE.CODES;
  const EXPIRED = window.COUPON_FIXTURE.EXPIRED;
  const input = root.querySelector('input[name="discount_code"]') || root.querySelector('input');
  const btn = root.querySelector('[data-apply]');
  const msg = root.querySelector('.msg');
  const chips = root.querySelector('[data-chips]');
  const block = root.querySelector('[data-coupon-block]');
  const subEl = root.querySelector('[data-subtotal]');
  const discEl = root.querySelector('[data-discount]');
  const totalEl = root.querySelector('[data-total]');
  const toggle = root.querySelector('[data-toggle]');
  const panel = root.querySelector('[data-panel]');
  const details = root.querySelector('[data-details]');
  const subtotal = 200;
  const money = (n) => `$${n.toFixed(2)}`;
  let applied = null;

  const setOpen = (open) => {
    if (details) details.open = open;
    if (panel) panel.toggleAttribute('hidden', !open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  };
  if (toggle) toggle.addEventListener('click', () => setOpen(panel ? panel.hasAttribute('hidden') : false));
  if (opts.collapseOnBlur && input && panel) input.addEventListener('blur', () => setTimeout(() => setOpen(false), 0));

  function render() {
    const disc = applied ? subtotal * (CODES[applied.code] / 100) : 0;
    subEl.textContent = money(subtotal);
    discEl.textContent = applied ? `-${money(disc)}` : money(0);
    totalEl.textContent = money(subtotal - disc);
    chips.innerHTML = applied
      ? `<span class="chip">${applied.code} · -${money(disc)} <button type="button" data-remove="${applied.code}" aria-label="${it ? 'Rimuovi' : 'Remove'} ${applied.code}">×</button></span>`
      : '';
    const remove = chips.querySelector('[data-remove]');
    if (remove) remove.addEventListener('click', () => { applied = null; msg.textContent = ''; if (block) block.removeAttribute('hidden'); setOpen(true); render(); });
    if (mode === 'chipReplace' && block) block.toggleAttribute('hidden', Boolean(applied));
  }

  btn.addEventListener('click', () => {
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    if (CODES[code]) {
      applied = { code };
      render();
      msg.className = 'msg ok';
      msg.textContent = it ? `Codice ${code} applicato! Hai risparmiato ${money(subtotal * (CODES[code] / 100))}.` : `Coupon ${code} applied! You saved ${money(subtotal * (CODES[code] / 100))}.`;
    } else if (EXPIRED[code]) {
      msg.className = 'msg error';
      msg.textContent = it ? `Il codice ${code} è scaduto.` : `Coupon ${code} has expired.`;
    } else if (code === 'NOTELIGIBLE') {
      msg.className = 'msg error';
      msg.textContent = it ? `Il codice ${code} non è applicabile.` : `Coupon ${code} is not eligible for the items in your cart.`;
    } else {
      msg.className = 'msg error';
      msg.textContent = it ? `Il codice ${code} non è valido.` : `Coupon ${code} is invalid. Enter a valid discount code.`;
    }
  });

  render();
}
