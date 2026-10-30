// src/content.js — entry point: capture the ORIGINAL page total on load,
// handle popup messages, and expose a small debug hook.
(() => {
  if (globalThis.__couponTestV8) return;
  globalThis.__couponTestV8 = true;
  const CT = globalThis.CT;
  if (!CT || !CT.engine || !CT.totals || !CT.detect) return;
  const sleep = CT.dom.sleep;

  // Original amount, captured shortly after load (before any coupon). Used as
  // the reference for every code's discount: original - new total.
  let pageTotals = null;
  let resolveBase;
  const ready = new Promise((r) => { resolveBase = r; });
  async function captureBaseline() {
    for (let i = 0; i < 8; i += 1) {
      const t = CT.totals.snapshot();
      if (Number.isFinite(t.total) || Number.isFinite(t.subtotal)) { pageTotals = t; break; }
      await sleep(400);
    }
    if (pageTotals) {
      await sleep(500);
      const t2 = CT.totals.snapshot();
      if (Number.isFinite(t2.total) || Number.isFinite(t2.subtotal)) pageTotals = { ...t2, currencySymbol: t2.currencySymbol || pageTotals.currencySymbol };
    }
    resolveBase();
  }
  CT.baseline = { ready, get: () => pageTotals };
  captureBaseline();

  try {
    window.addEventListener('pagehide', () => {
      if (CT.engine.isRunning()) CT.engine.stop('Testing stopped because the page navigated.');
    }, { capture: true });
  } catch {}

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    if (message.type === 'STOP_COUPON_TESTS') { CT.engine.stop('Stopped by user.'); sendResponse({ ok: true }); return; }
    if (message.type === 'GET_ENGINE_INFO') { sendResponse({ ok: true, version: 8, ready: true }); return; }
    if (message.type === 'GET_RUN_STATUS') { sendResponse({ ok: true, running: CT.engine.isRunning(), run: CT.engine.currentRun() }); return; }
    if (message.type !== 'START_COUPON_TESTS' && message.type !== 'START_COUPON_TESTS_V7') return;
    const codes = [...new Set(((message.payload && message.payload.codes) || []).map((v) => CT.dom.clean(v)).filter(Boolean))];
    const tabId = (message.payload && message.payload.tabId) || (message.tab && message.tab.id) || null;
    CT.engine.runTests(codes, Boolean(message.payload && message.payload.reapplyBest), tabId)
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || String(error) }));
    return true;
  });

  try {
    window.__couponTestDebug = {
      baseline: () => pageTotals,
      findField: () => CT.detect.findField({ includeHidden: true }),
      open: () => CT.detect.openSection(),
      findApply: () => CT.detect.findApply(CT.detect.findField({ includeHidden: true })),
      totals: () => CT.totals.snapshot()
    };
  } catch {}
})();
