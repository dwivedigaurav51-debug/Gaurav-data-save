'use strict';
// An independent, auditable VIRTUAL ledger. Source candles are *not* executable quotes.
// Outcomes use the first validated five-minute source point at/after paper expiry.
window.PaperVirtual=(()=>{
 const KEY='envargOtcMultiPaperV2';
 const INITIAL=10000,STAKE=200,PAYOUT=.90,DURATION=300000,ENTRY_WINDOW=60000,MAX_QUOTE_AGE=120000,SETTLEMENT_GRACE=300000;
 const $=s=>document.querySelector(s);
 const getSaved=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){return null}};
 const fallback=()=>({version:2,initial:INITIAL,balance:INITIAL,auto:true,trades:[],skipped:[]});
 let wallet=getSaved();
 if(!wallet||wallet.version!==2||!Array.isArray(wallet.trades)||!Number.isFinite(wallet.balance))wallet=fallback();
 wallet.skipped=Array.isArray(wallet.skipped)?wallet.skipped:[];
 wallet.auto=wallet.auto!==false;
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(wallet))}catch(_){}};
 const fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
 const price=n=>Number.isFinite(n)?Number(n).toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:7}):'—';
 const time=ms=>ms?new Date(ms).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const countdown=ms=>{
   if(ms<=0)return '00:00';
   const seconds=Math.ceil(ms/1000);
   return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 };
 function openCount(){return wallet.trades.filter(t=>t.status==='OPEN').length}
 function skip(asset,reason,now){
  wallet.skipped.unshift({symbol:asset.symbol,name:asset.name,reason,time:now});
  wallet.skipped=wallet.skipped.slice(0,40);save();
 }
 function onStrong(asset,st,detectedAt=Date.now()){
  const sourceMs=Number(st.lastTs)*1000;
  const age=detectedAt-sourceMs;
  const allowedUntil=Math.min(detectedAt+ENTRY_WINDOW,sourceMs+MAX_QUOTE_AGE);
  const info={entryFrom:detectedAt,entryUntil:allowedUntil,expiryAt:null,opened:false,status:'SKIPPED',reason:''};
  const fail=(reason)=>{info.reason=reason;skip(asset,reason,detectedAt);return info};
  if(!wallet.auto)return fail('AUTO PAPER OFF');
  if(!Number.isFinite(st.price)||st.price<=0||!Number.isFinite(sourceMs)||sourceMs<=0)return fail('INVALID PRICE / TIMESTAMP');
  if(age< -10000)return fail('FUTURE SOURCE CANDLE');
  if(age>=MAX_QUOTE_AGE||allowedUntil<=detectedAt)return fail('ENTRY CLOSED: quote older than 2 minutes');
  if(wallet.trades.some(t=>t.status==='OPEN'&&t.symbol===asset.symbol))return fail('ACTIVE TRADE on same currency');
  if(wallet.balance<STAKE)return fail('VIRTUAL BALANCE BELOW ₹200');
  const id=asset.symbol+':'+String(st.lastTs);
  if(wallet.trades.some(t=>t.id===id))return fail('ALREADY TRADED THIS SOURCE CANDLE');
  const trade={
   id,symbol:asset.symbol,name:asset.name,side:st.side,score:st.score,
   stake:STAKE,payout:PAYOUT,entryPrice:st.price,sourceTs:st.lastTs,
   entryFrom:detectedAt,entryUntil:allowedUntil,openedAt:detectedAt,expiresAt:detectedAt+DURATION,
   status:'OPEN',exitPrice:null,exitAt:null,settledAt:null,pnl:null,diagnostic:''
  };
  wallet.balance-=STAKE;
  wallet.trades.unshift(trade);
  // Keep all completed entries so lifetime WIN/LOSS totals and virtual P/L
  // cannot silently lose older trades when the history grows.
  save();
  info.opened=true;info.status='OPEN';info.expiryAt=trade.expiresAt;info.tradeId=trade.id;
  return info;
 }
 function onFeed(symbol,points,observedAt=Date.now(),notify=false){
  if(!Array.isArray(points)||!points.length)return [];
  const last=points.at(-1);
  if(!last||!Number.isFinite(last.ts))return [];
  const updates=[];
  for(const t of wallet.trades){
   if(t.status!=='OPEN'||t.symbol!==symbol)continue;
   if(observedAt<t.expiresAt)continue; // no future win/loss guesses
   const candidates=points.filter(p=>
     Number.isFinite(p.c)&&p.c>0&&
     p.ts>t.sourceTs&&p.ts*1000>=t.expiresAt&&
     p.ts*1000<=t.expiresAt+SETTLEMENT_GRACE&&p.ts*1000<=observedAt
   );
   const exit=candidates[0];
   if(exit){
    const same=Math.abs(exit.c-t.entryPrice)<=Math.max(1e-10,t.entryPrice*1e-10);
    const won=t.side==='UP'?exit.c>t.entryPrice:exit.c<t.entryPrice;
    t.status=same?'DRAW':won?'WIN':'LOSS';
    t.exitPrice=exit.c;t.exitAt=exit.ts*1000;t.settledAt=observedAt;
    t.pnl=same?0:won?Math.round(t.stake*t.payout*100)/100:-t.stake;
    if(same)wallet.balance+=t.stake;
    else if(won)wallet.balance+=t.stake+t.pnl;
    const movement=(exit.c-t.entryPrice)/t.entryPrice*100;
    t.diagnostic=t.status==='LOSS'
      ?'Source price '+(movement>=0?'rose ':'fell ')+Math.abs(movement).toFixed(4)+'% against '+t.side+
       '. Indicator agreement cannot guarantee the next 5m outcome.'
      :t.status==='DRAW'?'Entry and exit source prices matched. Stake refunded.':'Entry direction matched later source price.';
    updates.push(t);
   }else if(last.ts*1000>t.expiresAt+SETTLEMENT_GRACE){
    t.status='VOID';t.pnl=0;t.settledAt=observedAt;
    t.diagnostic='No validated source point near expiry; refunded. Not counted as WIN or LOSS.';
    wallet.balance+=t.stake;
    updates.push(t);
   }
  }
  if(updates.length){
   save();
   if(notify&&window.MultiBridge?.notifyPaperResult){
    for(const t of updates){
      if(t.status==='WIN'||t.status==='LOSS')
       window.MultiBridge.notifyPaperResult(t.symbol,t.status,fmt(t.pnl),time(t.exitAt));
    }
   }
  }
  return updates;
 }
 function getTrade(symbol,sourceTs){
  return wallet.trades.find(t=>t.symbol===symbol&&t.sourceTs===sourceTs)||null;
 }
 function totals(){
  const all=wallet.trades;
  const wins=all.filter(t=>t.status==='WIN').length;
  const losses=all.filter(t=>t.status==='LOSS').length;
  const draws=all.filter(t=>t.status==='DRAW').length;
  const voids=all.filter(t=>t.status==='VOID').length;
  const open=all.filter(t=>t.status==='OPEN').length;
  const pnl=all.filter(t=>Number.isFinite(t.pnl)).reduce((sum,t)=>sum+t.pnl,0);
  return {wins,losses,draws,voids,open,pnl,accuracy:wins+losses?wins/(wins+losses)*100:null};
 }
 function tradeCard(t,isOpen){
  const status=safe(t.status),p=t.pnl;
  const cls=t.status==='WIN'?'wintrade':t.status==='LOSS'?'losstrade':t.status==='VOID'?'voidtrade':'';
  const pill=t.status==='WIN'?'winpill':t.status==='LOSS'?'losspill':'';
  const remaining=t.expiresAt-Date.now();
  const sub=isOpen?(remaining>0?'Expiry in '+countdown(remaining):'Expiry passed — waiting for validated future 5m quote'):
       (t.exitAt?'Settled source '+time(t.exitAt):'No matching expiry quote');
  return '<div class="papertrade '+cls+'"><div class="head"><strong>'+safe(t.name)+' · '+safe(t.side)+' '+(t.side==='UP'?'↑':'↓')+'</strong><span class="pill '+pill+'">'+status+(p!==null?' · '+safe(fmt(p)):'')+'</span></div>'+
   '<div class="timerline">'+safe(sub)+'</div>'+
   '<div class="tradegrid">'+
     '<div><small>Entry / Buy From</small><b>'+safe(time(t.entryFrom))+'</b></div>'+
     '<div><small>Entry / Buy Until</small><b>'+safe(time(t.entryUntil))+'</b></div>'+
     '<div><small>Expiry target</small><b>'+safe(time(t.expiresAt))+'</b></div>'+
     '<div><small>Entry source price</small><b>'+safe(price(t.entryPrice))+'</b></div>'+
     '<div><small>Exit source price</small><b>'+safe(price(t.exitPrice))+'</b></div>'+
     '<div><small>Stake / Score</small><b>₹'+Number(t.stake||0)+' · '+Number(t.score||0)+'/100</b></div>'+
   '</div>'+(t.diagnostic?'<div class="sub">'+safe(t.diagnostic)+'</div>':'')+
   '<div class="sub">Opened '+safe(time(t.openedAt))+' · Signal candle '+safe(time(t.sourceTs*1000))+' · '+(t.exitAt?'Exit '+safe(time(t.exitAt)):'Awaiting source result')+'</div></div>';
 }
 function renderOpen(){
  const open=wallet.trades.filter(t=>t.status==='OPEN');
  $('#paperPending').textContent=open.length+' active';
  $('#paperOpenList').innerHTML=open.length
   ?open.map(t=>tradeCard(t,true)).join('')
   :'<p class="empty">अभी कोई खुली वर्चुअल ट्रेड नहीं।</p>';
 }
 function render(){
  const t=totals();
  $('#paperBalance').textContent=fmt(wallet.balance);
  $('#paperWins').textContent=t.wins;
  $('#paperLosses').textContent=t.losses;
  $('#paperAccuracy').textContent=t.accuracy===null?'—':t.accuracy.toFixed(1)+'%';
  $('#paperPnl').textContent=(t.pnl>0?'+':'')+fmt(t.pnl);
  $('#paperPnl').className=t.pnl>0?'win':t.pnl<0?'lose':'';
  $('#paperOpenCount').textContent=t.open;
  $('#paperAuto').checked=!!wallet.auto;
  $('#paperTotals').textContent=(t.wins+t.losses)+' completed W/L · '+t.draws+' DRAW · '+t.voids+' VOID · '+t.open+' OPEN';
  renderOpen();
  const closed=wallet.trades.filter(t=>t.status!=='OPEN');
  $('#paperHistory').innerHTML=closed.length
   ?closed.slice(0,60).map(t=>tradeCard(t,false)).join('')
   :'<p class="empty">अभी कोई पूरी हुई virtual trade नहीं। खुली ट्रेड ऊपर दिखाई देगी।</p>';
  const groups={};
  for(const row of wallet.trades){
   if(!groups[row.symbol])groups[row.symbol]={name:row.name,w:0,l:0,d:0,v:0,o:0,pnl:0};
   const g=groups[row.symbol];
   if(row.status==='WIN')g.w++;
   if(row.status==='LOSS')g.l++;
   if(row.status==='DRAW')g.d++;
   if(row.status==='VOID')g.v++;
   if(row.status==='OPEN')g.o++;
   g.pnl+=Number(row.pnl)||0;
  }
  const rows=Object.values(groups).sort((a,b)=>(b.w+b.l)-(a.w+a.l)||a.name.localeCompare(b.name));
  $('#paperByAsset').innerHTML=rows.length
   ?rows.map(g=>'<div class="reportline"><span>'+safe(g.name)+'</span><b>'+g.w+'W / '+g.l+'L'+(g.o?' · '+g.o+' OPEN':'')+' · '+(g.w+g.l?(g.w/(g.w+g.l)*100).toFixed(0)+'%':'—')+'</b></div>').join('')
   :'<p class="empty">अभी कोई ट्रेड डेटा नहीं।</p>';
  $('#paperSkipped').textContent=wallet.skipped.length+' skipped entries'+(wallet.skipped[0]?' · Last: '+wallet.skipped[0].name+' — '+wallet.skipped[0].reason:'');
 }
 $('#paperAuto').checked=wallet.auto;
 $('#paperAuto').addEventListener('change',()=>{
   wallet.auto=$('#paperAuto').checked;save();render();
 });
 $('#paperReset').addEventListener('click',()=>{
   if(openCount()){alert('Active paper trade का रिजल्ट आने तक virtual wallet reset नहीं कर सकते।');return}
   if(!confirm('Reset ONLY Multi Scanner virtual balance, trade history and accuracy to ₹10,000?'))return;
   wallet=fallback();save();render();
 });
 return {onStrong,onFeed,getTrade,totals,render,renderOpen,getWallet:()=>wallet};
})();