const $ = (id) => document.getElementById(id);
const els = {
  host: $('host'), runBadge: $('runBadge'), codes: $('codes'), reapplyBest: $('reapplyBest'),
  start: $('start'), stop: $('stop'), resetCoupon: $('resetCoupon'), testedCount: $('testedCount'), workingCount: $('workingCount'),
  bestValue: $('bestValue'), status: $('status'), results: $('results'), exportCsv: $('exportCsv'), clearResults: $('clearResults')
};
let currentRun = null;

function parseCodes(raw) {
  return [...new Set(raw.split(/[\n,;\t ]+/).map(v => v.trim()).filter(Boolean))];
}
function working(r) { return ['WORKING','WORKING_UNMEASURED'].includes(r.status); }
function discountLabel(r) {
  if (Number.isFinite(r.discountPercent) && r.discountPercent > 0) return `${r.discountPercent.toFixed(2)}%`;
  if (Number.isFinite(r.discountAmount) && r.discountAmount > 0) return `${r.currencySymbol || ''}${r.discountAmount.toFixed(2)}`;
  return '—';
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
  els.exportCsv.disabled = !results.length;
  els.results.innerHTML = '';
  for (const r of results) {
    const tr = document.createElement('tr');
    if (best?.code === r.code) tr.className = 'best';
    const code = document.createElement('td'); code.textContent = r.code;
    const status = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `status-pill ${working(r) ? 'working' : ['INVALID','EXPIRED'].includes(r.status) ? 'failed' : 'other'}`;
    pill.textContent = r.status; status.appendChild(pill);
    if (r.message) { const note = document.createElement('div'); note.className='muted'; note.textContent=r.message.slice(0,120); status.appendChild(note); }
    const discount = document.createElement('td'); discount.textContent = discountLabel(r);
    tr.append(code,status,discount); els.results.appendChild(tr);
  }
}
async function activeTab() { return (await chrome.tabs.query({active:true,currentWindow:true}))[0]; }
async function saveRun(tabId, run) { await chrome.storage.local.set({[`couponTest:${tabId}`]:run,'couponTest:last':run}); }
async function loadState() {
  const tab = await activeTab();
  if (tab?.url) { try { els.host.textContent = new URL(tab.url).hostname; } catch {} }
  if (!tab?.id) return;
  const data = await chrome.storage.local.get([`couponTest:${tab.id}`,'couponTest:last']);
  const run = data[`couponTest:${tab.id}`] || data['couponTest:last'];
  if (run) { render(run); els.status.textContent = run.summary || 'Previous results loaded.'; }
}
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type !== 'COUPON_TEST_PROGRESS') return;
  if (m.payload?.summary) els.status.textContent = m.payload.summary;
  if (m.payload?.run) render(m.payload.run);
});
els.start.addEventListener('click', async () => {
  const codes = parseCodes(els.codes.value);
  if (!codes.length) return void (els.status.textContent='Paste at least one code.');
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return void (els.status.textContent='Open a normal cart/checkout page first.');
  setRunning(true); els.status.textContent=`Testing ${codes.length} code(s)…`;
  try {
    const res = await chrome.tabs.sendMessage(tab.id,{type:'START_COUPON_TESTS',payload:{codes,reapplyBest:els.reapplyBest.checked}});
    if (!res?.ok) throw new Error(res?.error || 'Testing failed.');
    render(res.run); await saveRun(tab.id,res.run); els.status.textContent=res.run.summary || 'Testing complete.';
    els.runBadge.textContent='Done'; els.runBadge.className='badge done';
  } catch (e) { els.status.textContent=e.message || String(e); els.runBadge.textContent='Error'; els.runBadge.className='badge error'; }
  finally { setRunning(false); }
});
els.stop.addEventListener('click', async () => { const tab=await activeTab(); if(tab?.id) chrome.tabs.sendMessage(tab.id,{type:'STOP_COUPON_TESTS'}).catch(()=>{}); els.status.textContent='Stopping after current action…'; });
els.resetCoupon.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return void (els.status.textContent='Open the store cart/checkout page first.');
  els.resetCoupon.disabled = true;
  els.status.textContent = 'Trying to reset applied coupon…';
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'RESET_APPLIED_COUPONS' });
    els.status.textContent = res?.message || (res?.ok ? 'Applied coupon reset.' : 'Could not reset applied coupon.');
    els.runBadge.textContent = res?.ok ? 'Reset' : 'Manual';
    els.runBadge.className = res?.ok ? 'badge done' : 'badge error';
  } catch (e) {
    els.status.textContent = 'Reset helper not loaded yet. Reload extension and refresh the page.';
    els.runBadge.textContent = 'Error';
    els.runBadge.className = 'badge error';
  } finally {
    els.resetCoupon.disabled = false;
  }
});
els.clearResults.addEventListener('click', async () => { const tab=await activeTab(); if(tab?.id) await chrome.storage.local.remove(`couponTest:${tab.id}`); render(null); els.status.textContent='Results cleared.'; });
els.exportCsv.addEventListener('click', () => {
  const results=currentRun?.results || []; if(!results.length) return;
  const headers=['store','page','code','status','discount_percent','discount_amount','currency','baseline_subtotal','baseline_total','after_total','message','tested_at'];
  const esc=v=>`"${String(v ?? '').replace(/"/g,'""')}"`;
  const lines=[headers.join(',')];
  for(const r of results) lines.push([currentRun.host,currentRun.url,r.code,r.status,r.discountPercent ?? '',r.discountAmount ?? '',r.currencySymbol ?? '',r.baselineSubtotal ?? '',r.baselineTotal ?? '',r.afterTotal ?? '',r.message ?? '',r.testedAt].map(esc).join(','));
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a'); a.href=url; a.download=`coupon-test-${currentRun.host || 'results'}.csv`; a.click(); URL.revokeObjectURL(url);
});
loadState().catch(e=>{els.status.textContent=e.message || String(e);});
