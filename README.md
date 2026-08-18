# CouponTest Extension

Chrome/Chromium Manifest V3 extension for testing multiple coupon codes on an already-open cart or checkout page.

## Phase 1

- User manually opens a cart/checkout page and makes the coupon field visible.
- Paste multiple coupon codes into the extension popup.
- The extension detects the visible coupon/promo/discount field and Apply button.
- Codes are tested sequentially.
- Results are classified as working, invalid, expired, minimum-spend, product-not-eligible, login-required, not-stackable, or unknown.
- The extension measures before/after totals where possible and calculates discount amount and percentage.
- Best working code is highlighted and can be re-applied at the end.
- Results can be exported as CSV.
- The extension never clicks Place Order / Pay Now / Submit Order actions.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open a store cart/checkout page with a visible coupon field.
6. Open CouponTest, paste codes, and start testing.

Phase 2 will add automatic opening of collapsed coupon sections.