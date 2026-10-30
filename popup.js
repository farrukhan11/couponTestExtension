const $ = (id) => document.getElementById(id);
const els = {
  host: $('host'), runBadge: $('runBadge'), codes: $('codes'), reapplyBest: $('reapplyBest'),
  start: $('start'), stop: $('stop'), resetCoupon: $('resetCoupon'), testedCount: $('testedCount'), workingCount: $('workingCount'),
  bestValue: $('bestValue'), originalValue: $('originalValue'), status: $('status'), results: $('results'),
  exportCsv: $('exportCsv'), clearResults: $('clearResults')
};
let currentRun = null;
let engineFrame = 0;
let watchdog = null;

// Self-contained probe executed in every frame to find which one actually
// hosts a coupon field (checkouts sometimes render it in an iframe).
function probeCouponField() {
  const kw = /coupon|promo(?:tional)?|discount|voucher|gift\s*code|offer\s*code|codice\s*sconto|sconto|codice\s*promozionale|promozione|\bbuono\b|code\s*promo|code\s*promotionnel|r[eé]duction|c[oó]digo\s*promocional|c[oó]digo\s*de\s*descuento|descuento|cup[oó]n|gutschein(?:code)?|rabatt(?:code)?|cupom|desconto|kortingscode|korting/i;
  const bad = /email|phone|postal|zip|address|search|quantity|first\s*name|last\s*name|city|state|\btelefono\b|\bindirizzo\b|\bcap\b|citt[aà]|provincia|fiscale|\bnome\b|\bcognome\b/i;
  const vis = (el) => {
    try {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1;
    } catch { return false; }
  };
  const walk = (root) => {
    let list = [];
    try { list = [...root.querySelectorAll('input:not([type=hidden]),textarea')]; } catch {}
    for (const el of list) {
      if (!vis(el)) continue;
      const own = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('title')].filter(Boolean).join(' ');
      if (bad.test(own)) continue;
      if (kw.test(own)) return true;
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i += 1, p = p.parentElement) if (kw.test(p.innerText || '')) return true;
    }
    let hosts = [];
    try { hosts = [...root.querySelectorAll('*')]; } catch {}
    for (const host of hosts) if (host.shadowRoot && walk(host.shadowRoot)) return true;
    return false;
  };
  return walk(document);
}

async function detectCouponFrame(tabId) {
  let results = null;
  try { results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeCouponField }); }
  catch { try { results = await chrome.scripting.executeScript({ target: { tabId }, func: probeCouponField }); } catch { results = null; } }
  if (!results?.length) return 0;
  const hit = results.find((r) => r.result);
  return (hit || results[0]).frameId ?? 0;
}

function parseCodes(raw) {
  // Each line is treated as ONE code, copied as-is — including any spaces
  // in it (e.g. "15% Off Storewide"). We do NOT split on spaces/tabs inside
  // a line anymore, since that used to break multi-word codes into several
  // fake codes. A line is only split further if it clearly contains more
  // than one code separated by a comma or semicolon.
  const lines = String(raw || '').split(/\r?\n+/).map((v) => v.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = /[,;]/.test(line)
      ? line.split(/[,;]+/).map((v) => v.trim()).filter(Boolean)
      : [line];
    out.push(...parts);
  }
  return [...new Set(out)];
}
function working(r) { return ['WORKING','WORKING_UNMEASURED'].includes(r.status); }
function failed(r) { return ['INVALID','EXPIRED','MINIMUM_SPEND_NOT_MET','PRODUCT_NOT_ELIGIBLE','ALREADY_USED','NOT_STACKABLE','LOGIN_REQUIRED','APPLY_BUTTON_DISABLED','APPLY_CLICK_BLOCKED','RESET_REQUIRED'].includes(r.status); }
function discountLabel(r) {
  const parts = [];
  if (Number.isFinite(r.discountPercent) && r.discountPercent > 0) parts.push(`${r.discountPercent.toFixed(2)}%`);
  if (Number.isFinite(r.discountAmount) && r.discountAmount > 0) parts.push(`${r.currencySymbol || ''}${r.discountAmount.toFixed(2)}`);
  return parts.join(' · ') || '—';
}
function setRunning(on) {
  els.start.disabled = on; els.stop.disabled = !on; els.codes.disabled = on; els.reapplyBest.disabled = on; els.resetCoupon.disabled = on;
  els.runBadge.textContent = on ? 'Running' : 'Ready';
  els.runBadge.className = on ? 'badge running' : 'badge';
}
function render(run) {
  currentRun = run || null;
  const results = run?.results || [];
  const best = run?.best || null;
  els.testedCount.textContent = results.length;
  els.workingCount.textContent = results.filter(working).length;
  els.bestValue.textContent = best ? `${best.code} · ${discountLabel(best)}` : '—';
  const baseTotal = run?.baseline?.total;
  els.originalValue.textContent = Number.isFinite(baseTotal)
    ? `${run.baseline.currencySymbol || ''}${baseTotal.toFixed(2)}`
    : '—';
  els.exportCsv.disabled = !results.length;
  els.results.innerHTML = '';
  for (const r of results) {
    const tr = document.createElement('tr');
    if (best?.code === r.code) tr.className = 'best';
    const code = document.createElement('td'); code.textContent = r.code;
    const status = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `status-pill ${working(r) ? 'working' : failed(r) ? 'failed' : 'other'}`;
    pill.textContent = r.status; status.appendChild(pill);
    if (r.message) { const note = document.createElement('div'); note.className='muted'; note.textContent=r.message.slice(0,300); status.appendChild(note); }
    const discount = document.createElement('td'); discount.textContent = discountLabel(r);
    tr.append(code,status,discount); els.results.appendChild(tr);
  }
}
async function activeTab() { return (await chrome.tabs.query({active:true,currentWindow:true}))[0]; }

// Live progress recovery: the content script writes the run to storage on
// every step (even while no popup is open), so polling storage lets a
// reopened popup show the in-flight run and keep it updated until it ends.
let pollTimer = null;
let startClickedAt = 0;
function finishRun(run) {
  stopPolling(); clearWatchdog(); startClickedAt = 0;
  setRunning(false);
  els.runBadge.textContent = run?.error ? 'Error' : 'Done';
  els.runBadge.className = run?.error ? 'badge error' : 'badge done';
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function beginPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const t = await activeTab();
      const keys = ['couponTest:last'];
      if (t?.id) keys.unshift(`couponTest:${t.id}`);
      const data = await chrome.storage.local.get(keys);
      const candidates = keys.map((k) => data[k]).filter(Boolean);
      if (!candidates.length) return;
      // Prefer an in-flight run; otherwise the most recently started one.
      const run = candidates.find((r) => r.running)
        || candidates.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
      // Just pressed Start: ignore the previous run still sitting in storage.
      if (startClickedAt && !run.running && Date.parse(run.startedAt || 0) < startClickedAt) return;
      render(run);
      if (run.summary) els.status.textContent = run.summary;
      if (run.running) {
        setRunning(true);
        els.runBadge.textContent = 'Running'; els.runBadge.className = 'badge running';
      } else {
        finishRun(run);
      }
    } catch {}
  }, 1000);
}
async function saveRun(tabId, run) { await chrome.storage.local.set({[`couponTest:${tabId}`]:run,'couponTest:last':run}); }
async function clearStoredRun(tabId) {
  const keys = ['couponTest:last'];
  if (tabId) keys.push(`couponTest:${tabId}`);
  await chrome.storage.local.remove(keys);
}
function resetPopupFields() {
  els.codes.value = '';
  els.reapplyBest.checked = true;
  render(null);
  els.runBadge.textContent = 'Ready';
  els.runBadge.className = 'badge';
  els.status.textContent = 'Extension fields reset. If a coupon is applied on the store page, remove it manually from the cart/checkout.';
}
async function loadState() {
  const tab = await activeTab();
  if (tab?.url) { try { els.host.textContent = new URL(tab.url).hostname; } catch {} }
  if (!tab?.id) {
    const fallback = await chrome.storage.local.get(['couponTest:last']);
    if (fallback['couponTest:last']) { render(fallback['couponTest:last']); els.status.textContent = fallback['couponTest:last'].summary || 'Previous results loaded.'; }
    return;
  }
  const data = await chrome.storage.local.get([`couponTest:${tab.id}`, 'couponTest:last']);
  const candidates = [`couponTest:${tab.id}`, 'couponTest:last'].map((k) => data[k]).filter(Boolean);
  const run = candidates.find((r) => r.running)
    || candidates.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
  if (run) { render(run); els.status.textContent = run.summary || 'Previous results loaded.'; }
  if (run && !run.running && run.finishedAt) {
    els.runBadge.textContent = 'Done'; els.runBadge.className = 'badge done';
  }
  // If a run is still in flight (popup was closed and reopened while testing),
  // storage tells us immediately and polling keeps the UI live.
  if (run?.running) {
    setRunning(true);
    els.status.textContent = run.summary || `Testing ${run.results?.length || 0} code(s) so far…`;
    els.runBadge.textContent = 'Running'; els.runBadge.className = 'badge running';
    beginPolling();
    return;
  }
  // Fallback for runs started before this state was persisted: ask the page.
  try {
    const frame = await detectCouponFrame(tab.id);
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'GET_RUN_STATUS' }, { frameId: frame });
    if (status?.running) {
      engineFrame = frame;
      setRunning(true);
      if (status.run) render(status.run);
      els.status.textContent = 'Coupon testing is already running on this page…';
      els.runBadge.textContent = 'Running'; els.runBadge.className = 'badge running';
      beginPolling();
    }
  } catch {}
}
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'COUPON_TEST_PROGRESS') return;
  if (watchdog) armWatchdog();
  if (m.payload?.summary) els.status.textContent = m.payload.summary;
  if (m.payload?.run) {
    render(m.payload.run);
    const tab = activeTab();
    tab.then((t) => { if (t?.id) saveRun(t.id, m.payload.run).catch(() => {}); });
    if (m.payload.run.running === false && pollTimer) finishRun(m.payload.run);
  }
});
const ENGINE_FILES = ['src/dom.js', 'src/totals.js', 'src/detect.js', 'src/response.js', 'src/engine.js', 'src/content.js'];
async function ensureEngine(tabId) {
  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: 'GET_ENGINE_INFO' }).catch(() => null);
    if (info?.ok && info.version === 8) engineFrame = await detectCouponFrame(tabId);
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ENGINE_FILES });
  } catch {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ENGINE_FILES }); }
    catch { return false; }
  }
  await new Promise((r) => setTimeout(r, 250));
  engineFrame = await detectCouponFrame(tabId);
  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: 'GET_ENGINE_INFO' }, { frameId: engineFrame });
    return Boolean(info?.ok && info.version === 8);
  } catch { return false; }
}
function armWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => { els.status.textContent = 'Still working — the store is taking longer than usual…'; }, 120000);
}
function clearWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
els.start.addEventListener('click', async () => {
  const codes = parseCodes(els.codes.value);
  if (!codes.length) return void (els.status.textContent='Paste at least one code.');
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return void (els.status.textContent='Open a normal cart/checkout page first.');
  startClickedAt = Date.now() - 2000;
  setRunning(true); els.status.textContent=`Testing ${codes.length} code(s)…`; armWatchdog(); beginPolling();
  try {
    if (!(await ensureEngine(tab.id))) throw new Error('Coupon engine could not be loaded on this tab. Refresh the store page and try again.');
    // The page acknowledges immediately; progress/results arrive via storage polling.
    const res = await chrome.tabs.sendMessage(tab.id,{type:'START_COUPON_TESTS',payload:{codes,reapplyBest:els.reapplyBest.checked,tabId:tab.id}},{frameId:engineFrame});
    if (!res?.ok) throw new Error(res?.error || 'Testing failed to start.');
  } catch (e) {
    stopPolling(); clearWatchdog(); startClickedAt = 0; setRunning(false);
    els.status.textContent=e.message || String(e); els.runBadge.textContent='Error'; els.runBadge.className='badge error';
  }
});
els.stop.addEventListener('click', async () => { const tab=await activeTab(); if(tab?.id) chrome.tabs.sendMessage(tab.id,{type:'STOP_COUPON_TESTS'},{frameId:engineFrame}).catch(()=>{}); els.status.textContent='Stopping after current action…'; });
els.resetCoupon.addEventListener('click', async () => {
  const tab = await activeTab();
  stopPolling();
  await clearStoredRun(tab?.id);
  resetPopupFields();
});
els.clearResults.addEventListener('click', async () => { stopPolling(); const tab=await activeTab(); if(tab?.id) await clearStoredRun(tab.id); render(null); els.status.textContent='Results cleared.'; });
els.exportCsv.addEventListener('click', () => {
  const results=currentRun?.results || []; if(!results.length) return;
  const headers=['store','page','code','status','discount_percent','discount_amount','currency','baseline_subtotal','baseline_total','after_total','message','tested_at'];
  const esc=v=>{
    let s = String(v ?? '');
    // Neutralize spreadsheet formula injection from page-derived text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g,'""')}"`;
  };
  const lines=[headers.join(',')];
  for(const r of results) lines.push([currentRun.host,currentRun.url,r.code,r.status,r.discountPercent ?? '',r.discountAmount ?? '',r.currencySymbol ?? '',r.baselineSubtotal ?? '',r.baselineTotal ?? '',r.afterTotal ?? '',r.message ?? '',r.testedAt].map(esc).join(','));
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a'); a.href=url; a.download=`coupon-test-${currentRun.host || 'results'}.csv`; a.click(); URL.revokeObjectURL(url);
});
loadState().catch(e=>{els.status.textContent=e.message || String(e);});
