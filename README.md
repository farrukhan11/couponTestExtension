# CouponTest Extension

Chrome/Chromium Manifest V3 extension that tests many coupon codes on an open cart/checkout page.

## What it does

- Captures the **original order total on page load** (before any coupon).
- For each pasted code: **opens the collapsed coupon section if needed**, fills the code,
  **presses the Apply button**, waits for the page's response, and records the status and
  discount (`original total − new total`).
- Removes a working coupon before moving to the next code, then re-applies the best one.
- Never clicks order/pay/subscribe controls and never navigates away.
- Results can be exported as CSV.

Detection is **multilingual + structural**, so it works across Shopify, WooCommerce, Sellfy and
custom checkouts (including shadow-DOM web components), in English, Italian, French, German,
Spanish, Portuguese and more.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select this folder.
4. Open a cart/checkout page, open CouponTest, paste codes (one per line), and start testing.

## Structure

```
manifest.json
src/dom.js       shadow-DOM-aware DOM helpers, safe clicking, keyword dictionaries
src/totals.js    money scraping (label-first), scene settle, multi-currency
src/detect.js    coupon field / collapsed-section opener / Apply-button detection
src/response.js  response capture, status classification, discount math
src/engine.js    run orchestration (baseline, per-code apply, removal, best, persist)
src/content.js   entry point: page-load baseline, message handler, debug hook
popup.html/.js   toolbar UI
test/            local fixture with plain/collapsed/aria/details/chip/Italian/shadow variants
```

Debug helper (page console): `__couponTestDebug.totals()`, `.findField()`, `.open()`, `.baseline()`.
