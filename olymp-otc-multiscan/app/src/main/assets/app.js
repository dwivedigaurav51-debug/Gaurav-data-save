'use strict';
const $ = selector => document.querySelector(selector);
const PAPER=window.PaperVirtual;
if(!PAPER)throw Error('Missing virtual trading engine');
const FX = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURJPY','EURGBP','EURCHF','EURCAD','EURAUD','EURNZD','GBPJPY','GBPCHF','GBPCAD','GBPAUD','GBPNZD','AUDJPY','AUDCAD','AUDCHF','AUDNZD','CADJPY','CADCHF','CHFJPY'];
const CRYPTO = [['BTCUSD','Bitcoin'],['ETHUSD','Ethereum'],['DOGUSD','Dogecoin'],['PEPEUSD','PEPE'],['LTCUSD','Litecoin'],['XRPUSD','Ripple'],['SOLUSD','Solana']];
const ASSETS = [
 ...FX.map(s=>({symbol:s+'_OTC',name:s.slice(0,3)+'/'+s.slice(3)+' OTC',group:'forex'})),
 ...CRYPTO.map(([s,n])=>({symbol:s+'_OTC',name:n+' OTC',group:'crypto'}))
];
const INDEX = Object.fromEntries(ASSETS.map(a=>[a.symbol,a]));
const STATES = Object.fromEntries(ASSETS.map(a=>[a.symbol,{status:'WAITING',lastTs:0,price:null,score:0,side:'NONE',strong:false,error:'',reason:'Scan not run',dataCount:0,frame:0,checkedAt:0}]));
const POLL_INTERVAL=300000; // one five-minute source candle
const SCAN_OFFSET=12000; // aim for shortly after each 5-minute source boundary
const ALERT_FRESHNESS=420000; // 5m last-close quotes may reach us one cycle late
const REQUIRED_SCORE=100; // strict indicator agreement, NOT a predicted win rate
let inFlight=false,startedAt=0,completedAt=0,lastStart=0,lastCycle=Math.floor((Date.now()-SCAN_OFFSET)/POLL_INTERVAL),activeTab='all',scanDoneCount=0,seenResults=new Set();
let history=readStore('envargMultiSignalHistoryV3_100only',[]);
let seen=readStore('envargMultiSignalSeenV3_100only',{});
let notifications=readStore('envargMultiNotificationsV1',true);

function readStore(key,fallback){
 try{const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value)}catch(_){return fallback}
}
function writeStore(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(_){}}
function esc(input){return String(input??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function prettyTime(ms){if(!ms)return '—';return new Date(ms).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function fmtPrice(p){if(!Number.isFinite(p))return '—';if(p>=1000)return p.toLocaleString('en-US',{maximumFractionDigits:3});return p.toLocaleString('en-US',{minimumFractionDigits:p<0.01?5:4,maximumFractionDigits:7})}
function epochSec(raw){
 let t=Number(raw);
 if(!Number.isFinite(t)||t<=0)return 0;
 if(t>1e12)t/=1000;
 return Math.floor(t);
}
function candlePoint(v){
 const t=Array.isArray(v)?v[0]:(v.ts??v.time??v.timestamp??v.t);
 const c=Array.isArray(v)?v[1]:(v.c??v.close??v.closing_price);
 const ts=epochSec(t),close=Number(c);
 return ts>1000000000&&ts<Math.floor(Date.now()/1000)+120&&Number.isFinite(close)&&close>0?{ts,c:close}:null;
}
function median(nums){
 if(!nums.length)return 0;const sorted=nums.slice().sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function normalizeSource(text,symbol){
 let raw;
 try{raw=JSON.parse(text)}catch(_){throw Error('Invalid source JSON')}
 if(!raw||typeof raw!=='object')throw Error('Invalid source response');
 if(raw._bridgeError)throw Error(String(raw._bridgeError));
 if(raw.ok===false)throw Error(String(raw.error||'Source rejected request'));
 const reported=String(raw.asset?.symbol||raw.symbol||raw.meta?.symbol||'').toUpperCase();
 if(reported&&reported!==symbol)throw Error('Wrong asset! Feed returned '+reported);
 const charts=Array.isArray(raw.candles)?[raw]:Array.isArray(raw.charts)?raw.charts:[];
 if(!charts.length)throw Error('No chart/candle array at source');
 let candidates=[];
 for(const chart of charts){
   if(chart.asset?.symbol&&String(chart.asset.symbol).toUpperCase()!==symbol)continue;
   if(!Array.isArray(chart.candles)||!chart.candles.length)continue;
   const unique=new Map();
   for(const c of chart.candles){
     const point=candlePoint(c);
     if(point)unique.set(point.ts,point);
   }
   const points=[...unique.values()].sort((a,b)=>a.ts-b.ts).slice(-500);
   if(points.length<3)continue;
   const recent=points.slice(-18);
   const interval=median(recent.slice(1).map((p,i)=>p.ts-recent[i].ts).filter(d=>d>0));
   const hinted=Number(chart.candle_frame||chart.frame||chart.timeframe||raw.candle_frame||0);
   // Do not call daily or 1-minute data "5m". Both cadence and metadata must agree.
   if(hinted&&hinted!==300)continue;
   if(interval<240||interval>360)continue;
   candidates.push({points,last:points.at(-1).ts,interval});
 }
 if(!candidates.length)throw Error('No usable 5-minute candle series (timeframe mismatch)');
 candidates.sort((a,b)=>b.last-a.last||b.points.length-a.points.length);
 return candidates[0].points;
}
function emaSeries(xs,period){
 const k=2/(period+1),out=[];let v=xs[0];
 for(const x of xs){v=x*k+v*(1-k);out.push(v)}
 return out;
}
function rsi14(prices){
 const n=14;if(prices.length<n+1)return 50;
 let gain=0,loss=0;
 for(let i=prices.length-n;i<prices.length;i++){
  const delta=prices[i]-prices[i-1];gain+=Math.max(0,delta);loss+=Math.max(0,-delta);
 }
 if(loss===0)return gain===0?50:100;
 return 100-100/(1+gain/loss);
}
function candleAnalysis(points){
 if(points.length<60)return {valid:false,reason:'Need '+(60-points.length)+' more 5m candles'};
 const close=points.map(p=>p.c),price=close.at(-1);
 const e9=emaSeries(close,9).at(-1),e21=emaSeries(close,21).at(-1),e50=emaSeries(close,50).at(-1);
 const macFast=emaSeries(close,12),macSlow=emaSeries(close,26),macLine=macFast.map((v,i)=>v-macSlow[i]);
 const macSignal=emaSeries(macLine,9),hist=macLine.at(-1)-macSignal.at(-1);
 const rsi=rsi14(close),last14=close.slice(-14),highest=Math.max(...last14),lowest=Math.min(...last14);
 const oscillator=highest===lowest?50:(price-lowest)/(highest-lowest)*100;
 const last20=close.slice(-20),average=last20.reduce((a,b)=>a+b,0)/last20.length;
 const sd=Math.sqrt(last20.reduce((sum,x)=>sum+(x-average)*(x-average),0)/last20.length);
 const upper=average+2*sd,lower=average-2*sd;
 let movement=0;for(let i=close.length-14;i<close.length;i++)movement+=Math.abs(close[i]-close[i-1]);
 const volPct=(movement/14)/price*100,trendGap=(e9-e21)/price*100;
 let bull=0,bear=0;
 const upTrend=e9>e21&&e21>e50,downTrend=e9<e21&&e21<e50;
 if(upTrend)bull+=30;
 if(downTrend)bear+=30;
 if(hist>0)bull+=20;
 if(hist<0)bear+=20;
 if(rsi>=51&&rsi<65)bull+=15;
 if(rsi>35&&rsi<=49)bear+=15;
 if(oscillator>=50&&oscillator<85)bull+=10;
 if(oscillator>15&&oscillator<=50)bear+=10;
 if(price>average&&price<upper)bull+=10;
 if(price<average&&price>lower)bear+=10;
 if(trendGap>.02)bull+=8;
 if(trendGap<-.02)bear+=8;
 if(volPct>.008&&volPct<.7){bull+=7;bear+=7}
 const side=bull>bear?'UP':bear>bull?'DOWN':'NONE',score=Math.max(bull,bear),gap=Math.abs(bull-bear);
 const blockers=[];
 if(side==='UP'){
  if(!upTrend)blockers.push('EMA trend not fully bullish');
  if(hist<=0)blockers.push('MACD against UP');
  if(rsi>=65||rsi<48)blockers.push('RSI not in safe UP zone');
  if(price>=upper)blockers.push('Price above upper Bollinger');
 }else if(side==='DOWN'){
  if(!downTrend)blockers.push('EMA trend not fully bearish');
  if(hist>=0)blockers.push('MACD against DOWN');
  if(rsi<=35||rsi>52)blockers.push('RSI not in safe DOWN zone');
  if(price<=lower)blockers.push('Price below lower Bollinger');
 }
 if(volPct>=.7||volPct<=.008)blockers.push('Volatility not within safe range');
 if(gap<22)blockers.push('UP/DOWN score gap too small');
 if(score<80)blockers.push('Score '+score+' below 80');
 const strong=side!=='NONE'&&blockers.length===0;
 return {valid:true,score,side,strong,rsi,oscillator,volPct,trendGap,gap,hist,reason:strong?'All main indicators aligned':blockers.slice(0,3).join(' · ')};
}
function latestMatches(){
 const now=Date.now();
 return ASSETS.map(a=>({asset:a,...STATES[a.symbol]})).filter(a=>a.strong&&a.score===REQUIRED_SCORE&&a.status==='LIVE'&&now-a.lastTs*1000<=ALERT_FRESHNESS).sort((a,b)=>b.score-a.score||a.asset.name.localeCompare(b.asset.name));
}
function addSignal(asset,state){
 if(state.score!==REQUIRED_SCORE||!state.strong||state.side==='NONE')return;
 const symbol=asset.symbol,key=String(state.lastTs);
 if(seen[symbol]===key)return;
 const now=Date.now();
 const paper=PAPER.onStrong(asset,state,now);
 seen[symbol]=key;writeStore('envargMultiSignalSeenV3_100only',seen);
 const item={symbol,name:asset.name,side:state.side,score:state.score,price:state.price,candleTs:state.lastTs,detected:now,entryFrom:paper.entryFrom,entryUntil:paper.entryUntil,expiryAt:paper.expiryAt,paperTradeId:paper.tradeId||null,paperStatus:paper.status,paperReason:paper.reason||''};
 history.unshift(item);history=history.slice(0,120);writeStore('envargMultiSignalHistoryV3_100only',history);
 if(paper.opened&&notifications&&window.MultiBridge?.notifySignal){
   const buyWindow=paper.opened?prettyTime(paper.entryFrom)+' - '+prettyTime(paper.entryUntil):'ENTRY CLOSED / PAPER SKIPPED';
   const expiry=paper.opened?prettyTime(paper.expiryAt):'—';
   window.MultiBridge.notifySignal(symbol,state.side,String(state.score),buyWindow,expiry);
 }
}
window.nativeAssetResult=function(symbol,rawText){
 if(!inFlight||!INDEX[symbol]||seenResults.has(symbol))return;
 seenResults.add(symbol);
 const old=STATES[symbol],now=Date.now();
 try{
  const points=normalizeSource(rawText,symbol),last=points.at(-1),age=now-last.ts*1000;
  if(age>720000)throw Error('Stale 5m candles ('+Math.round(age/60000)+'min old)');
  // Settle previously opened paper trades only from eligible *later* 5-minute quotes.
  // A source error or missing expiry candle never becomes a guessed WIN/LOSS.
  PAPER.onFeed(symbol,points,now,false); // no result alerts: signal entry alerts only
  PAPER.onQuote(symbol,points,now,notifications); // fills previously queued 100/100 signal
  const result=candleAnalysis(points);
  const qualified=result.valid&&result.strong&&result.score===REQUIRED_SCORE;
  Object.assign(old,{status:result.valid?'LIVE':'WARMUP',lastTs:last.ts,price:last.c,score:result.score||0,
    side:result.side||'NONE',strong:qualified,error:'',reason:result.valid&&!qualified&&result.strong?'Score '+result.score+'/100 (only 100/100 accepted)':result.reason,dataCount:points.length,frame:300,checkedAt:now});
  if(qualified&&age<=ALERT_FRESHNESS)addSignal(INDEX[symbol],old);
 }catch(ex){
  Object.assign(old,{status:'ERROR',strong:false,side:'NONE',score:0,checkedAt:now,error:String(ex.message||ex).slice(0,160),reason:'Unable to validate feed'});
 }
 updateUI();
};
window.nativeAssetError=function(symbol,error){
 if(!inFlight||!INDEX[symbol]||seenResults.has(symbol))return;
 seenResults.add(symbol);
 Object.assign(STATES[symbol],{status:'ERROR',strong:false,side:'NONE',score:0,error:String(error).slice(0,160),checkedAt:Date.now(),reason:'Source request failed'});
 updateUI();
};
window.nativeScanDone=function(){
 if(!inFlight)return;
 inFlight=false;completedAt=Date.now();scanDoneCount++;
 for(const a of ASSETS){
  if(!seenResults.has(a.symbol)&&STATES[a.symbol].status==='CHECKING'){
   Object.assign(STATES[a.symbol],{status:'ERROR',strong:false,score:0,side:'NONE',error:'Scan timed out',checkedAt:Date.now()});
  }
 }
 updateUI();
};
function startScan(manual=false){
 const now=Date.now();
 if(inFlight)return;
 if(manual&&lastStart&&now-lastStart<120000){
  $('#scanSub').textContent='Manual refresh cooldown: wait '+Math.ceil((120000-(now-lastStart))/1000)+' seconds';
  return;
 }
 if(!window.MultiBridge?.scanAssets){
  $('#scanStatus').textContent='Android data bridge unavailable';
  $('#scanSub').textContent='Install the Android APK; browser preview cannot read OTC source data.';
  $('#scanDot').className='dot bad';return;
 }
 lastStart=now;startedAt=now;inFlight=true;seenResults=new Set();
 for(const a of ASSETS){STATES[a.symbol].status='CHECKING';STATES[a.symbol].error='';STATES[a.symbol].strong=false}
 updateUI();
 try{window.MultiBridge.scanAssets(ASSETS.map(a=>a.symbol).join(','))}
 catch(ex){
  inFlight=false;
  $('#scanSub').textContent='Native scan launch error: '+String(ex.message||ex);
  for(const a of ASSETS)Object.assign(STATES[a.symbol],{status:'ERROR',error:'Scan launch failed'});
  updateUI();
 }
}
function cardStatus(s){
 if(s.status==='LIVE')return s.strong?'STRONG '+s.side:'FEED OK';
 if(s.status==='CHECKING')return 'CHECKING…';
 if(s.status==='WARMUP')return 'WARMUP';
 if(s.status==='ERROR')return 'FEED ERROR';
 return s.status;
}
function updateUI(){
 const now=Date.now();
 for(const a of ASSETS){
  const st=STATES[a.symbol];
  if(st.status==='LIVE'&&st.lastTs&&now-st.lastTs*1000>720000){
   st.status='STALE';st.strong=false;st.reason='Source has stopped updating';
  }
 }
 const matches=latestMatches();
 $('#totalCount').textContent=ASSETS.length;
 $('#liveCount').textContent=ASSETS.filter(a=>['LIVE','WARMUP'].includes(STATES[a.symbol].status)).length;
 $('#strongCount').textContent=matches.length;
 $('#scorePolicy').textContent='ONLY 100/100 · no 99/100 trades or alerts';
 $('#errorCount').textContent=ASSETS.filter(a=>['ERROR','STALE'].includes(STATES[a.symbol].status)).length;
 $('#strongBadge').textContent=matches.length+' (100/100)';
 $('#strongSignals').innerHTML=matches.length?matches.map(s=>{
  const h=history.find(row=>row.symbol===s.asset.symbol&&row.candleTs===s.lastTs);
  const trade=PAPER.getTrade(s.asset.symbol,s.lastTs);
  const openAt=h?.entryFrom;
  const until=h?.entryUntil;
  const exp=trade?.expiresAt||h?.expiryAt;
  const buyText=trade
   ?'PAPER ENTRY '+prettyTime(trade.entryFrom)+' – '+prettyTime(trade.entryUntil)+' · EXP '+prettyTime(exp)
   :h
    ?(h.paperStatus==='WAITING_ENTRY'?(PAPER.isQueued(s.asset.symbol,s.lastTs)?'100/100 · WAITING NEXT VERIFIED 5m CANDLE':'100/100 · WAIT EXPIRED / NO ENTRY'):h.paperStatus==='SKIPPED'?'NO PAPER ENTRY: '+(h.paperReason||'Not eligible'):h.entryUntil>Date.now()?'ENTRY WINDOW '+prettyTime(openAt)+' – '+prettyTime(until):'ENTRY WINDOW CLOSED / NO PAPER TRADE')
    :'Checking entry timing…';
  return '<div class="signalrow '+(s.side==='DOWN'?'down':'')+'"><div><span class="assetname">'+esc(s.asset.name)+'</span>'+
  '<span class="meta">Latest price '+esc(fmtPrice(s.price))+' · candle '+esc(prettyTime(s.lastTs*1000))+'</span>'+
  '<span class="meta-timing '+(!trade?'closed':'')+'">'+esc(buyText)+'</span></div>'+
  '<div><div class="side '+(s.side==='DOWN'?'down':'')+'">'+s.side+' '+(s.side==='UP'?'↑':'↓')+'</div>'+
  '<div class="score">Strong score '+s.score+'/100</div></div></div>'
 }).join(''):'<p class="empty">अभी कोई ताज़ा Strong Signal नहीं मिला। नीचे देखो कौन-सी करेंसी की फीड काम कर रही है और कौन-सी शर्तें पूरी नहीं हैं।</p>';
 const text=$('#search').value.trim().toLowerCase();
 const assets=ASSETS.filter(a=>{
   const s=STATES[a.symbol];
   if(activeTab==='forex'&&a.group!=='forex')return false;
   if(activeTab==='crypto'&&a.group!=='crypto')return false;
   if(activeTab==='strong'&&!(s.strong&&s.status==='LIVE'&&now-s.lastTs*1000<=ALERT_FRESHNESS))return false;
   if(activeTab==='error'&&!['ERROR','STALE'].includes(s.status))return false;
   return (a.name.toLowerCase().includes(text)||a.symbol.toLowerCase().includes(text));
 });
 const rank={LIVE:0,WARMUP:1,CHECKING:2,WAITING:3,STALE:4,ERROR:5};
 assets.sort((a,b)=>{
  const x=STATES[a.symbol],y=STATES[b.symbol];
  return (Number(y.strong)-Number(x.strong))||(rank[x.status]-rank[y.status])||a.name.localeCompare(b.name);
 });
 $('#assetList').innerHTML=assets.length?assets.map(a=>{
  const s=STATES[a.symbol],hit=s.strong&&s.status==='LIVE'&&now-s.lastTs*1000<=ALERT_FRESHNESS;
  const status=cardStatus(s),note=s.error||s.reason;
  const quality=s.status==='LIVE'?'ok':['ERROR','STALE'].includes(s.status)?'bad':'';
  return '<article class="assetrow '+(hit?'hit ':'')+(['ERROR','STALE'].includes(s.status)?'err':'')+'">'+
   '<div><span class="assetname">'+esc(a.name)+'</span><span class="meta">'+esc(note||'Awaiting source')+
   (s.lastTs?' · '+esc(prettyTime(s.lastTs*1000)):'')+'</span></div>'+
   '<div class="right"><strong class="price">'+esc(fmtPrice(s.price))+'</strong>'+
   '<span class="status '+(hit?'hot':quality)+'">'+esc(hit?'STRONG '+s.side+' · '+s.score:status)+'</span></div></article>'
 }).join(''):'<p class="empty">इस फिल्टर में कोई करेंसी नहीं मिली।</p>';
 $('#signalHistory').innerHTML=history.length?history.slice(0,45).map(row=>{
  const trade=PAPER.getTrade(row.symbol,row.candleTs);
  const timing=trade
    ?'ENTRY '+prettyTime(trade.entryFrom)+'–'+prettyTime(trade.entryUntil)+' · EXP '+prettyTime(trade.expiresAt)+' · '+trade.status
    :row.paperStatus==='WAITING_ENTRY'?(PAPER.isQueued(row.symbol,row.candleTs)?'100/100 QUEUED · next fresh candle needed':'100/100 WAIT EXPIRED · no paper entry')
    :row.entryFrom?(row.paperReason||'ENTRY WINDOW CLOSED')+' · Signal '+prettyTime(row.entryFrom)
     :'Legacy pre-100/100 signal (no new trade)';
  return '<div class="historyrow"><div><strong>'+esc(row.name)+'</strong> · '+esc(prettyTime(row.detected))+
  '<small>Candle '+esc(prettyTime(row.candleTs*1000))+' · Quote '+esc(fmtPrice(row.price))+'</small>'+
  '<small>'+esc(timing)+'</small></div>'+
  '<div><div class="side '+(row.side==='DOWN'?'down':'')+'">'+esc(row.side)+'</div><div class="score">'+Number(row.score||0)+'/100</div></div></div>';
 }).join(''):'<p class="empty">अभी कोई Strong Signal दर्ज नहीं है।</p>';
 const checked=ASSETS.filter(a=>seenResults.has(a.symbol)).length;
 $('#scanBtn').disabled=inFlight;
 $('#scanBtn').textContent=inFlight?'Scanning…':'↻ Scan Now';
 $('#scanStatus').textContent=inFlight?'Scanning '+checked+'/'+ASSETS.length+' OTC assets':
   (scanDoneCount?'Last scan complete · '+checked+'/'+ASSETS.length:'Scanner ready');
 $('#scanSub').textContent=inFlight?'Checking 5-minute candles independently • 4 workers':
   (scanDoneCount?'Every 5 minutes while the app is open':'Tap Scan Now or wait for auto scan');
 $('#scanDot').className='dot '+(inFlight?'':scanDoneCount&&$('#liveCount').textContent!=='0'?'good':scanDoneCount?'bad':'');
 $('#lastScan').textContent=prettyTime(startedAt);
 $('#completedScan').textContent=prettyTime(completedAt);
 const nextCycle=Math.floor((Date.now()-SCAN_OFFSET)/POLL_INTERVAL)+1;
 $('#nextScan').textContent=prettyTime(nextCycle*POLL_INTERVAL+SCAN_OFFSET);
 PAPER.render();
}
$('#search').addEventListener('input',updateUI);
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
 activeTab=button.dataset.tab;
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));
 updateUI();
}));
$('#scanBtn').addEventListener('click',()=>startScan(true));
$('#clearHistory').addEventListener('click',()=>{
 if(confirm('Clear Multi Scanner signal history only?')){
  history=[];writeStore('envargMultiSignalHistoryV3_100only',history);updateUI();
 }
});
$('#alertToggle').checked=!!notifications;
$('#alertToggle').addEventListener('change',()=>{
 notifications=$('#alertToggle').checked;
 writeStore('envargMultiNotificationsV1',notifications);
 if(notifications&&window.MultiBridge?.requestNotificationPermission)window.MultiBridge.requestNotificationPermission();
});
if(notifications&&window.MultiBridge?.requestNotificationPermission)window.MultiBridge.requestNotificationPermission();
updateUI();
startScan();
setInterval(()=>{
 const now=Date.now(),cycle=Math.floor((now-SCAN_OFFSET)/POLL_INTERVAL);
 if(cycle>lastCycle&&!inFlight){
   lastCycle=cycle;
   if(now-lastStart>=120000)startScan(); // don't spam broker source
 }
},5000);
setInterval(updateUI,30000);
setInterval(()=>PAPER.renderOpen(),1000);
