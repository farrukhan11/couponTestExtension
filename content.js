(() => {
  if (window.__couponTestPhase1Loaded) return;
  window.__couponTestPhase1Loaded = true;

  const RE = {
    coupon: /coupon|promo(?:tional)?|discount|voucher|offer\s*code|gift\s*code/i,
    apply: /apply|redeem|submit|add|use/i,
    remove: /remove|delete|clear|cancel|×|✕|✖/i,
    danger: /place\s*order|submit\s*order|pay\s*now|complete\s*(purchase|order)|buy\s*now|confirm\s*order/i,
    success: /applied|success|accepted|you\s+saved|discount.*applied|promo.*applied/i,
    invalid: /invalid|not\s+valid|doesn['’]?t\s+exist|does\s+not\s+exist|unrecognized|incorrect|cannot\s+be\s+found/i,
    expired: /expired|no\s+longer\s+valid|has\s+ended/i,
    minimum: /minimum|min\.\s*(order|spend)|spend.*(more|at\s+least)/i,
    eligible: /not\s+eligible|doesn['’]?t\s+apply|does\s+not\s+apply|not\s+applicable|excluded|specific\s+(item|product)/i,
    used: /already\s+used|usage\s+limit|one\s+use/i,
    login: /sign\s*in|log\s*in|login|required\s+account|members?\s+only/i,
    stack: /cannot\s+combine|can['’]?t\s+combine|not\s+stackable|one\s+(promo|coupon|discount)/i
  };
  let running=false, abortRequested=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const visible=el=>{ if(!el || !(el instanceof Element)) return false; const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>1&&r.height>1; };
  const textOf=el=>[el?.getAttribute?.('aria-label'),el?.getAttribute?.('placeholder'),el?.getAttribute?.('name'),el?.getAttribute?.('id'),el?.getAttribute?.('title'),el?.textContent].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  function context(el){ let out=textOf(el),p=el?.parentElement; for(let i=0;i<3&&p;i++,p=p.parentElement){const t=(p.innerText||'').replace(/\s+/g,' ').trim(); if(t&&t.length<500) out+=' '+t;} return out; }
  function findCouponInput(){
    const list=[...document.querySelectorAll('input:not([type=hidden]),textarea')].filter(visible).map(el=>{const own=textOf(el),ctx=context(el); let score=0; if(RE.coupon.test(own))score+=12; if(RE.coupon.test(ctx))score+=5; if(/code/i.test(own))score+=2; if(/email|phone|postal|zip|address|search/i.test(own))score-=9; return {el,score};}).sort((a,b)=>b.score-a.score);
    return list[0]?.score>=5?list[0].el:null;
  }
  function findApply(input){
    const list=[...document.querySelectorAll('button,input[type=submit],input[type=button],[role=button],a')].filter(visible).map(el=>{const t=textOf(el); if(RE.danger.test(t)) return {el,score:-100}; let score=RE.apply.test(t)?6:0; if(RE.coupon.test(t))score+=4; if(input?.form && el.closest('form')===input.form)score+=8; if(input?.parentElement?.contains(el))score+=6; if(input&&el.parentElement===input.parentElement)score+=5; return {el,score};}).sort((a,b)=>b.score-a.score);
    return list[0]?.score>=6?list[0].el:null;
  }
  function setValue(input,value){ const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; const d=Object.getOwnPropertyDescriptor(proto,'value'); d?.set?d.set.call(input,value):input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); }
  function safeClick(el){ if(!el) throw new Error('Apply button not found.'); const t=textOf(el); if(RE.danger.test(t)) throw new Error(`Blocked unsafe checkout action: ${t}`); el.scrollIntoView({block:'center'}); el.click(); }
  function num(raw){ if(!raw)return null; let s=String(raw).replace(/[^0-9.,-]/g,''); if(!s)return null; const c=s.lastIndexOf(','),d=s.lastIndexOf('.'); s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,''); const n=parseFloat(s); return Number.isFinite(n)?Math.abs(n):null; }
  function money(text){ const m=[...String(text||'').matchAll(/(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD)\s*[-+]?\s*\d[\d.,]*|\d[\d.,]*\s*(?:USD|EUR|GBP|CAD|AUD)/gi)]; return m.length?num(m[m.length-1][0]):null; }
  function currency(text){ const s=String(text||''); if(s.includes('$'))return '$'; if(s.includes('€'))return '€'; if(s.includes('£'))return '£'; if(s.includes('¥'))return '¥'; if(s.includes('₹'))return '₹'; return (s.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1]||'')+' '; }
  function amount(kind){
    const tests=kind==='subtotal'?[/\bsub\s*total\b/i,/\bitems?\s+total\b/i]:kind==='discount'?[/\bdiscount\b/i,/\bcoupon\b/i,/\bpromo/i,/\bsavings?\b/i]:[/\bgrand\s+total\b/i,/\border\s+total\b/i,/^\s*total\b/i];
    const list=[]; for(const el of [...document.querySelectorAll('div,span,p,li,dt,dd,tr,td,th,strong,b')].filter(visible)){const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim(); if(!t||t.length>180||(kind==='total'&&/subtotal/i.test(t))||!tests.some(r=>r.test(t)))continue; const a=money(t); if(a===null)continue; list.push({amount:a,currency:currency(t),score:(t.length<80?2:0)+(tests[0].test(t)?2:0)});} list.sort((a,b)=>b.score-a.score); return list[0]||null;
  }
  function totals(){ const s=amount('subtotal'),t=amount('total'),d=amount('discount'); return {subtotal:s?.amount??null,total:t?.amount??null,discount:d?.amount??null,currencySymbol:s?.currency||t?.currency||d?.currency||''}; }
  function messages(code=''){
    const set=new Set(); const selectors='[role=alert],[aria-live],.error,.errors,.success,.notice,.message,[class*=error],[class*=success],[class*=message],[class*=notice],[class*=coupon],[class*=promo],[class*=discount]';
    for(const el of document.querySelectorAll(selectors)){if(!visible(el))continue; const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim(); if(t&&t.length<=500)set.add(t);} if(code){for(const el of document.querySelectorAll('div,span,p,li')){if(!visible(el))continue; const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim(); if(t&&t.length<=220&&t.toLowerCase().includes(code.toLowerCase()))set.add(t);}}
    return [...set].slice(0,30).join(' | ');
  }
  function classify(msg,before,after){ if(RE.expired.test(msg))return'EXPIRED'; if(RE.minimum.test(msg))return'MINIMUM_SPEND_NOT_MET'; if(RE.eligible.test(msg))return'PRODUCT_NOT_ELIGIBLE'; if(RE.used.test(msg))return'ALREADY_USED'; if(RE.login.test(msg))return'LOGIN_REQUIRED'; if(RE.stack.test(msg))return'NOT_STACKABLE'; if(RE.invalid.test(msg))return'INVALID'; const saved=Number.isFinite(before.total)&&Number.isFinite(after.total)&&before.total-after.total>0.005; const raised=Number.isFinite(after.discount)&&after.discount-(before.discount||0)>0.005; if(saved||raised)return'WORKING'; if(RE.success.test(msg))return'WORKING_UNMEASURED'; return'UNKNOWN'; }
  function discount(before,after){ let a=null; if(Number.isFinite(before.total)&&Number.isFinite(after.total)&&before.total>after.total)a=before.total-after.total; else if(Number.isFinite(after.discount)&&after.discount>(before.discount||0))a=after.discount-(before.discount||0); const base=Number.isFinite(before.subtotal)&&before.subtotal>0?before.subtotal:Number.isFinite(before.total)&&before.total>0?before.total:null; return {amount:a===null?null:Math.round(a*100)/100,percent:a!==null&&base?Math.round((a/base*100)*100)/100:null}; }
  async function waitUi(){ await sleep(900); let last=document.body?.innerText?.length||0; for(let i=0;i<5;i++){await sleep(400);const now=document.body?.innerText?.length||0;if(now===last)break;last=now;} }
  function removeButton(code){ const list=[...document.querySelectorAll('button,a,[role=button]')].filter(visible).map(el=>{const t=textOf(el); if(RE.danger.test(t))return{el,score:-100}; let score=RE.remove.test(t)?5:0,p=el.parentElement; for(let i=0;i<4&&p;i++,p=p.parentElement){const c=(p.innerText||'').replace(/\s+/g,' ').trim(); if(code&&c.toLowerCase().includes(code.toLowerCase()))score+=12; if(RE.coupon.test(c)&&c.length<350)score+=4;} return{el,score};}).sort((a,b)=>b.score-a.score); return list[0]?.score>=9?list[0].el:null; }
  async function removeCode(code,baseline){ const b=removeButton(code); if(b){safeClick(b); await waitUi(); const state=totals(),msg=messages(code); const gone=!msg.toLowerCase().includes(code.toLowerCase()),reset=!Number.isFinite(baseline.total)||!Number.isFinite(state.total)||Math.abs(state.total-baseline.total)<0.02; if(gone||reset)return true;} const input=findCouponInput(); if(input&&String(input.value||'').toLowerCase()===code.toLowerCase())setValue(input,''); return false; }
  function best(results){ return results.filter(r=>['WORKING','WORKING_UNMEASURED'].includes(r.status)).sort((a,b)=>(b.discountPercent??-1)-(a.discountPercent??-1)||(b.discountAmount??-1)-(a.discountAmount??-1))[0]||null; }
  function notify(summary,run=null){ chrome.runtime.sendMessage({type:'COUPON_TEST_PROGRESS',payload:{summary,run}}).catch(()=>{}); }
  async function applyOne(code,baseline){ const input=findCouponInput(); if(!input)throw new Error('Coupon/discount field not found. Phase 1 expects it to be visible.'); const button=findApply(input); if(!button)throw new Error('Apply/redeem button not found near coupon field.'); setValue(input,''); await sleep(100); setValue(input,code); safeClick(button); await waitUi(); const after=totals(),msg=messages(code),status=classify(msg,baseline,after),d=discount(baseline,after); return {code,status,discountPercent:d.percent,discountAmount:d.amount,currencySymbol:after.currencySymbol||baseline.currencySymbol,baselineSubtotal:baseline.subtotal,baselineTotal:baseline.total,afterTotal:after.total,message:msg,testedAt:new Date().toISOString()}; }
  async function runTests(codes,reapplyBest){
    if(running)throw new Error('Coupon testing is already running.'); running=true; abortRequested=false;
    try {
      if(!findCouponInput())throw new Error('Coupon/discount field not found on this page. Make it visible, then retry.');
      const baseline=totals(),results=[],host=location.hostname,url=location.href; let resetRequired=false;
      for(let i=0;i<codes.length;i++){
        if(abortRequested)break; const code=codes[i]; notify(`Testing ${code} (${i+1}/${codes.length})…`);
        const r=await applyOne(code,baseline); results.push(r); const run={host,url,baseline,results:[...results],best:best(results)}; notify(`${code}: ${r.status}`,run);
        if(['WORKING','WORKING_UNMEASURED'].includes(r.status)&&i<codes.length-1){ const removed=await removeCode(code,baseline); if(!removed){ resetRequired=true; results.push({code:'—',status:'RESET_REQUIRED',discountPercent:null,discountAmount:null,currencySymbol:baseline.currencySymbol,baselineSubtotal:baseline.subtotal,baselineTotal:baseline.total,afterTotal:null,message:'Working coupon could not be safely removed. Testing stopped to avoid stacked/incorrect results.',testedAt:new Date().toISOString()}); break; } }
      }
      const chosen=best(results); if(reapplyBest&&chosen&&!abortRequested&&!resetRequired){ const currentMsg=messages(chosen.code); if(!currentMsg.toLowerCase().includes(chosen.code.toLowerCase())){ try{await applyOne(chosen.code,baseline);}catch{} } }
      const run={host,url,baseline,results,best:chosen,summary:abortRequested?`Stopped. Tested ${results.filter(r=>r.code!=='—').length} code(s).`:resetRequired?'Stopped because the previous working coupon could not be safely removed.':chosen?`Done. Best code: ${chosen.code}${Number.isFinite(chosen.discountPercent)?` (${chosen.discountPercent.toFixed(2)}%)`:''}.`:`Done. No confirmed working coupon found.`}; notify(run.summary,run); return run;
    } finally { running=false; }
  }
  chrome.runtime.onMessage.addListener((m,_sender,sendResponse)=>{
    if(m?.type==='STOP_COUPON_TESTS'){abortRequested=true;sendResponse({ok:true});return;}
    if(m?.type!=='START_COUPON_TESTS')return;
    runTests(m.payload?.codes||[],Boolean(m.payload?.reapplyBest)).then(run=>sendResponse({ok:true,run})).catch(e=>sendResponse({ok:false,error:e.message||String(e)})); return true;
  });
})();
