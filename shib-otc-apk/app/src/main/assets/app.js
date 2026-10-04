const $=s=>document.querySelector(s);
const fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const FEED_VERSION='olymptrade-public-shibusd-otc-v1';
const API=(window.__HATCHABLE__?.api||'/api')+'/olymp-shib';

function freshState(){
  return {
    feedVersion:FEED_VERSION,
    balance:10000,startBalance:10000,wins:0,losses:0,history:[],
    active:null,lastTradeTs:0,lastProcessedTs:0,lastSignalTs:0,
    price:null,points:[],sourceFrame:300,sourceTitle:'1D',lastFetchAt:0,lastSourceTs:0,
    feedOk:false,feedError:'',precision:4,alertsEnabled:true,
    learning:{version:3,total:0,patterns:{},tags:{},recent:[]}
  };
}

let saved=null;
try{saved=JSON.parse(localStorage.getItem('shibPaperState')||'null')}catch{}
let state=(saved&&saved.feedVersion===FEED_VERSION)?saved:freshState();
state.learning=state.learning||{version:3,total:0,patterns:{},tags:{},recent:[]};
state.learning.version=3;state.learning.patterns=state.learning.patterns||{};state.learning.tags=state.learning.tags||{};state.learning.recent=state.learning.recent||[];
state.history=state.history||[];state.points=state.points||[];state.lastTradeTs=Number(state.lastTradeTs||0);state.alertsEnabled=state.alertsEnabled!==false;
if(!state.lastTradeTs&&state.history.length){
  state.lastTradeTs=Math.max(0,...state.history.map(x=>Math.floor(Number(x.signalTime||0)/1000)).filter(Number.isFinite));
}

let lastRenderedPrice=state.price||0;
let fetching=false;

function ema(arr,p){if(!arr.length)return 0;let k=2/(p+1),e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}
function sma(arr,p){let a=arr.slice(-p);return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function sd(arr,p){let a=arr.slice(-p),m=sma(arr,p);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length||1))}
function rsi(arr,p=14){if(arr.length<p+1)return 50;let g=0,l=0;for(let i=arr.length-p;i<arr.length;i++){let d=arr[i]-arr[i-1];if(d>0)g+=d;else l-=d}if(!l)return 100;let rs=(g/p)/(l/p);return 100-100/(1+rs)}
function closeStoch(arr,p=14){if(arr.length<p)return 50;let a=arr.slice(-p),hi=Math.max(...a),lo=Math.min(...a),c=a[a.length-1];return hi===lo?50:(c-lo)/(hi-lo)*100}
function closeVolatility(arr,p=14){if(arr.length<p+1)return 0;let a=[];for(let i=arr.length-p;i<arr.length;i++)a.push(Math.abs(arr[i]-arr[i-1]));return a.reduce((x,y)=>x+y,0)/a.length}
function band(v,cuts,labels){for(let i=0;i<cuts.length;i++)if(v<cuts[i])return labels[i];return labels[labels.length-1]}
function hourBucket(ts){const h=new Date(ts).getHours();return h<6?'night':h<12?'morning':h<18?'day':'evening'}

function makeFeatures({side,R,hist,px,mid,upper,lower,st,volPct,slope,e9,e21,e50,ts}){
  const emaTrend=e9>e21&&e21>e50?'bull':e9<e21&&e21<e50?'bear':'mixed';
  const regime=volPct>.7?'highvol':Math.abs(slope)>.18?'trend':'range';
  const rsiBand=band(R,[35,50,65],['low','midlow','midhigh','high']);
  const stochBand=band(st,[25,50,75],['low','midlow','midhigh','high']);
  const bbPos=px>upper?'above':px<lower?'below':px>mid?'upper':'lower';
  const volBand=band(volPct,[.05,.25,.7],['dead','normal','active','extreme']);
  const macd=hist>0?'pos':'neg',direction=side||'NONE';
  const tags=['side:'+direction,'regime:'+regime,'ema:'+emaTrend,'rsi:'+rsiBand,'macd:'+macd,'bb:'+bbPos,'stoch:'+stochBand,'vol:'+volBand,'hour:'+hourBucket(ts),'frame:'+state.sourceFrame];
  const patternKey=[direction,regime,emaTrend,rsiBand,macd,stochBand,volBand,'f'+state.sourceFrame].join('|');
  return {direction,regime,emaTrend,rsiBand,macd,bbPos,stochBand,volBand,volPct,R,st,slope,tags,patternKey};
}

function statScore(stat,minSamples,maxAdj){
  if(!stat||stat.n<minSamples)return {adj:0,wr:null,n:stat?.n||0};
  const wr=(stat.w+2)/(stat.n+4),reliability=Math.min(1,(stat.n-minSamples+1)/20),edge=(wr-.5)*2;
  return {adj:edge*maxAdj*reliability,wr,n:stat.n};
}
function adaptiveAdjustment(features){
  if(!features)return {adjustment:0,evidence:'No learned setup yet'};
  const pieces=[],p=statScore(state.learning.patterns[features.patternKey],20,9);
  if(p.n)pieces.push({...p,weight:1.35});
  for(const tag of features.tags){const s=statScore(state.learning.tags[tag],20,3);if(s.n)pieces.push({...s,weight:1})}
  if(!pieces.length)return {adjustment:0,evidence:'Learning: need 20 similar completed trades'};
  let num=0,den=0;for(const x of pieces){num+=x.adj*x.weight;den+=x.weight}
  const adjustment=Math.max(-12,Math.min(12,num/Math.max(1,den)));
  const exact=state.learning.patterns[features.patternKey];
  const evidence=exact&&exact.n>=20?`Similar pattern: ${exact.w}/${exact.n} WIN (${Math.round(exact.w/exact.n*100)}%)`:'Adaptive component history active';
  return {adjustment,evidence};
}

function analysis(){
  const closes=state.points.map(x=>x.c),ts=(state.points.at(-1)?.ts||0)*1000;
  if(closes.length<55)return {score:50,side:'NONE',baseConfidence:50,confidence:50,adaptiveAdjustment:0,reason:'Waiting for 55 official SHIB OTC data points…',features:null};
  const e9=ema(closes.slice(-80),9),e21=ema(closes.slice(-80),21),e50=ema(closes.slice(-100),50);
  const R=rsi(closes),fast=ema(closes.slice(-60),12),slow=ema(closes.slice(-60),26),mac=fast-slow;
  const macSeries=[];for(let i=Math.max(30,closes.length-20);i<=closes.length;i++){const a=closes.slice(0,i);macSeries.push(ema(a.slice(-60),12)-ema(a.slice(-60),26))}
  const sig=ema(macSeries,9),hist=mac-sig;
  const mid=sma(closes,20),dev=sd(closes,20),upper=mid+2*dev,lower=mid-2*dev,px=closes.at(-1);
  const st=closeStoch(closes),vol=closeVolatility(closes),volPct=vol/px*100,slope=(e9-e21)/px*100;
  let bull=0,bear=0,reasons=[];
  if(e9>e21&&e21>e50){bull+=25;reasons.push('EMA trend bullish')}else if(e9<e21&&e21<e50){bear+=25;reasons.push('EMA trend bearish')}else reasons.push('EMA trend mixed');
  if(R>=52&&R<=72){bull+=14;reasons.push('RSI supports UP')}if(R<=48&&R>=28){bear+=14;reasons.push('RSI supports DOWN')}
  if(hist>0){bull+=17;reasons.push('MACD momentum +')}else{bear+=17;reasons.push('MACD momentum -')}
  if(px>mid&&px<upper)bull+=10;if(px<mid&&px>lower)bear+=10;
  if(st>55&&st<88)bull+=10;if(st<45&&st>12)bear+=10;
  if(slope>.08)bull+=12;else if(slope<-.08)bear+=12;
  if(volPct>.02&&volPct<1.2){if(bull>bear)bull+=12;else bear+=12;reasons.push('Close volatility usable')}else reasons.push('Volatility filter weak');
  const raw=Math.max(bull,bear),side=bull===bear?'NONE':bull>bear?'UP':'DOWN';
  let baseConfidence=Math.min(96,Math.round(50+raw*.48));if(Math.abs(bull-bear)<14)baseConfidence=Math.min(baseConfidence,69);
  const features=makeFeatures({side,R,hist,px,mid,upper,lower,st,volPct,slope,e9,e21,e50,ts});
  const adapt=adaptiveAdjustment(features),confidence=Math.round(Math.max(45,Math.min(97,baseConfidence+adapt.adjustment)));
  const exhaustionBlocked=(side==='UP'&&st>=90&&R>=70&&(features.bbPos==='upper'||features.bbPos==='above'))||(side==='DOWN'&&st<=10&&R<=30&&(features.bbPos==='lower'||features.bbPos==='below'));
  $('#emaState').textContent=features.emaTrend==='bull'?'Bullish':features.emaTrend==='bear'?'Bearish':'Mixed';
  $('#rsiState').textContent=R.toFixed(1);$('#macdState').textContent=hist>0?'Positive':'Negative';
  $('#bbState').textContent=px>upper?'Above upper':px<lower?'Below lower':px>mid?'Upper half':'Lower half';
  $('#stochState').textContent=st.toFixed(1);$('#atrState').textContent=volPct.toFixed(3)+'%';
  $('#regime').textContent=features.regime.toUpperCase();
  return {score:raw,side,baseConfidence,confidence,adaptiveAdjustment:adapt.adjustment,reason:reasons.join(' • ')+' • '+adapt.evidence,features,bullScore:bull,bearScore:bear,scoreGap:Math.abs(bull-bear),exhaustionBlocked};
}

function updateBucket(obj,key,win){if(!key)return;const s=obj[key]||(obj[key]={n:0,w:0,l:0,last:[]});s.n++;if(win)s.w++;else s.l++;s.last.unshift(win?1:0);s.last=s.last.slice(0,20)}
function learnFromTrade(t,win){const f=t.features;if(!f)return;state.learning.total++;updateBucket(state.learning.patterns,f.patternKey,win);for(const tag of f.tags||[])updateBucket(state.learning.tags,tag,win);state.learning.recent.unshift({time:Date.now(),win:!!win,side:t.side,patternKey:f.patternKey});state.learning.recent=state.learning.recent.slice(0,50)}
function lossReason(t){const f=t.features;if(!f)return 'Pattern underperformed';const p=[];if(f.regime==='highvol'||f.volBand==='extreme')p.push('High volatility');if(f.emaTrend==='mixed')p.push('Mixed EMA trend');if(t.side==='UP'&&f.macd==='neg')p.push('MACD conflict');if(t.side==='DOWN'&&f.macd==='pos')p.push('MACD conflict');if(t.side==='UP'&&f.rsiBand==='high')p.push('RSI too high');if(t.side==='DOWN'&&f.rsiBand==='low')p.push('RSI too low');if(!p.length)p.push('Similar setup needs lower weight');return p.slice(0,2).join(' + ')}

function diagnosticCode(t){
  const f=t.features||{};
  const side=t.side==='UP'?'U':'D';
  const ema=f.emaTrend==='bull'?'B':f.emaTrend==='bear'?'R':'X';
  const macd=f.macd==='pos'?'P':'N';
  const bb=f.bbPos==='above'?'A':f.bbPos==='below'?'B':f.bbPos==='upper'?'U':'L';
  const vol=f.volBand==='extreme'?'X':f.volBand==='active'?'A':f.volBand==='normal'?'N':'D';
  const r=Math.round(Number(f.R||0)),s=Math.round(Number(f.st||0));
  const gap=Math.round(Number(t.scoreGap||Math.abs(Number(t.bullScore||0)-Number(t.bearScore||0))));
  return 'LD-'+String(t.sourceTs||0).slice(-6)+'-'+side+'-R'+String(r).padStart(2,'0')+'-S'+String(s).padStart(2,'0')+'-E'+ema+'-M'+macd+'-B'+bb+'-V'+vol+'-G'+gap;
}

function diagnoseLoss(t,exit){
  const f=t.features||{},flags=[],reasons=[];
  if(t.side==='DOWN'){
    if(Number(f.R)<=35){flags.push('R-LOW');reasons.push('RSI was already low/oversold, so reversal risk was elevated')}
    if(Number(f.st)<=20){flags.push('S-LOW');reasons.push('Stochastic was extremely low, suggesting the DOWN move may have been stretched')}
    if(f.macd==='pos'){flags.push('M-CONTRA');reasons.push('MACD momentum was positive against the DOWN trade')}
    if(f.emaTrend!=='bear'){flags.push('E-WEAK');reasons.push('EMA structure was not fully bearish')}
    if(f.bbPos==='below'){flags.push('BB-EXTREME');reasons.push('Entry was below the lower Bollinger area, increasing bounce risk')}
  }else{
    if(Number(f.R)>=65){flags.push('R-HIGH');reasons.push('RSI was already high/overbought, so pullback risk was elevated')}
    if(Number(f.st)>=80){flags.push('S-HIGH');reasons.push('Stochastic was extremely high, suggesting the UP move may have been stretched')}
    if(f.macd==='neg'){flags.push('M-CONTRA');reasons.push('MACD momentum was negative against the UP trade')}
    if(f.emaTrend!=='bull'){flags.push('E-WEAK');reasons.push('EMA structure was not fully bullish')}
    if(f.bbPos==='above'){flags.push('BB-EXTREME');reasons.push('Entry was above the upper Bollinger area, increasing pullback risk')}
  }
  if(f.regime==='highvol'||f.volBand==='extreme'){flags.push('V-HIGH');reasons.push('Volatility was unusually high, which can invalidate short-expiry setups')}
  if(Number(t.scoreGap||0)<20){flags.push('G-LOW');reasons.push('Bull/Bear score gap was small, so directional conviction was weak')}
  if(!flags.length){flags.push('PATTERN');reasons.push('No single conflict dominated; this pattern needs more samples before adding a new filter')}
  const movePct=t.entry?((Number(exit)-Number(t.entry))/Number(t.entry))*100:0;
  return {
    code:diagnosticCode(t),
    flags,
    reason:reasons.slice(0,3).join(' • '),
    movePct:+movePct.toFixed(3),
    snapshot:{
      side:t.side,
      confidence:t.confidence,
      baseConfidence:t.baseConfidence,
      bullScore:t.bullScore,
      bearScore:t.bearScore,
      scoreGap:t.scoreGap,
      rsi:Number(f.R||0),
      stochastic:Number(f.st||0),
      emaTrend:f.emaTrend||'unknown',
      macd:f.macd||'unknown',
      bbPos:f.bbPos||'unknown',
      volatility:f.volBand||'unknown',
      regime:f.regime||'unknown',
      slope:Number(f.slope||0)
    }
  };
}

function reconstructLegacyLoss(row){
  const targetTs=Math.floor(Number(row.signalTime||0)/1000);
  const idx=state.points.findIndex(p=>p.ts===targetTs);
  if(idx<54||row.exit==null)return null;
  const closes=state.points.slice(0,idx+1).map(x=>x.c),ts=targetTs*1000;
  const e9=ema(closes.slice(-80),9),e21=ema(closes.slice(-80),21),e50=ema(closes.slice(-100),50);
  const R=rsi(closes),fast=ema(closes.slice(-60),12),slow=ema(closes.slice(-60),26),mac=fast-slow;
  const macSeries=[];for(let i=Math.max(30,closes.length-20);i<=closes.length;i++){const a=closes.slice(0,i);macSeries.push(ema(a.slice(-60),12)-ema(a.slice(-60),26))}
  const hist=mac-ema(macSeries,9),mid=sma(closes,20),dev=sd(closes,20),upper=mid+2*dev,lower=mid-2*dev,px=closes.at(-1);
  const st=closeStoch(closes),vol=closeVolatility(closes),volPct=vol/px*100,slope=(e9-e21)/px*100;
  let bull=0,bear=0;
  if(e9>e21&&e21>e50)bull+=25;else if(e9<e21&&e21<e50)bear+=25;
  if(R>=52&&R<=72)bull+=14;if(R<=48&&R>=28)bear+=14;
  if(hist>0)bull+=17;else bear+=17;
  if(px>mid&&px<upper)bull+=10;if(px<mid&&px>lower)bear+=10;
  if(st>55&&st<88)bull+=10;if(st<45&&st>12)bear+=10;
  if(slope>.08)bull+=12;else if(slope<-.08)bear+=12;
  if(volPct>.02&&volPct<1.2){if(bull>bear)bull+=12;else bear+=12}
  const side=row.side|| (bull>bear?'UP':bear>bull?'DOWN':'NONE');
  const features=makeFeatures({side,R,hist,px,mid,upper,lower,st,volPct,slope,e9,e21,e50,ts});
  const t={
    side,entry:row.entry,confidence:row.confidence,baseConfidence:row.baseConfidence,
    bullScore:bull,bearScore:bear,scoreGap:Math.abs(bull-bear),features,sourceTs:targetTs
  };
  return {diagnostic:diagnoseLoss(t,row.exit),t};
}

function backfillLegacyLosses(){
  let changed=false;
  for(const row of state.history){
    if(row.result!=='LOSS'||row.lossDiagnostic)continue;
    const rebuilt=reconstructLegacyLoss(row);
    if(!rebuilt)continue;
    row.lossDiagnostic=rebuilt.diagnostic;row.lossCode=rebuilt.diagnostic.code;
    row.features=rebuilt.t.features;row.bullScore=rebuilt.t.bullScore;row.bearScore=rebuilt.t.bearScore;row.scoreGap=rebuilt.t.scoreGap;
    changed=true;
  }
  return changed;
}

function evaluateOnNewPoint(){
  if(!state.feedOk||isFeedStale())return;
  const a=analysis(),threshold=Math.max(60,Math.min(95,+$('#threshold').value||78));
  const p=state.points.at(-1),strong=a.side!=='NONE'&&!a.exhaustionBlocked&&a.confidence>=threshold&&a.score>=55;
  if(strong&&$('#autoMode').checked&&!state.active&&p){
    const cooldown=Math.max(1,+$('#cooldown').value||1);
    const minGap=cooldown*(state.sourceFrame||300);
    if(!state.lastTradeTs||p.ts-state.lastTradeTs>=minGap)openTrade(a);
  }
}
function openTrade(a){
  let stake=Math.max(10,+$('#stake').value||100);stake=Math.min(stake,state.balance);if(stake<10)return;
  const p=state.points.at(-1),openedAt=p.ts*1000,expirySec=state.sourceFrame||300,expiresAt=openedAt+expirySec*1000;
  const tradeId='OT-'+p.ts;state.balance-=stake;
  state.active={tradeId,side:a.side,entry:p.c,stake,confidence:a.confidence,baseConfidence:a.baseConfidence,adaptiveAdjustment:a.adaptiveAdjustment,features:a.features,bullScore:a.bullScore,bearScore:a.bearScore,scoreGap:a.scoreGap,openedAt,expiresAt,sourceTs:p.ts};
  state.history.unshift({tradeId,signalTime:openedAt,expiryTime:expiresAt,side:a.side,entry:p.c,exit:null,stake,confidence:a.confidence,baseConfidence:a.baseConfidence,adaptiveAdjustment:a.adaptiveAdjustment,bullScore:a.bullScore,bearScore:a.bearScore,scoreGap:a.scoreGap,features:a.features,patternKey:a.features?.patternKey||'',result:'OPEN',pnl:null,learningNote:'TRADE TAKEN • waiting for official 5m expiry'});
  state.history=state.history.slice(0,200);state.lastTradeTs=p.ts;state.lastSignalTs=p.ts;save();
  sendAlert('SHIB OTC • Virtual Trade Taken',sideText(a.side)+' • Entry '+priceText(p.c)+' • ₹'+stake+' • Expiry '+new Date(expiresAt).toLocaleTimeString());
}
function settleFromOfficialPoints(){
  const t=state.active;if(!t)return;
  const target=Math.floor(t.expiresAt/1000);
  const exitPoint=state.points.find(p=>p.ts>=target);
  if(!exitPoint)return;
  const exit=exitPoint.c,win=t.side==='UP'?exit>t.entry:exit<t.entry;let pnl;
  if(win){state.balance+=t.stake*1.9;pnl=t.stake*.9;state.wins++}else{pnl=-t.stake;state.losses++}
  learnFromTrade(t,win);
  const row=state.history.find(x=>x.tradeId===t.tradeId),note=win?'Winning setup reinforced':lossReason(t);
  const diagnostic=win?null:diagnoseLoss(t,exit);
  if(row){
    row.exit=exit;row.result=win?'WIN':'LOSS';row.pnl=pnl;row.settledAt=exitPoint.ts*1000;row.learningNote=note;
    if(diagnostic){row.lossDiagnostic=diagnostic;row.lossCode=diagnostic.code}
  }
  sendAlert('SHIB OTC • '+(win?'WIN ✅':'LOSS ❌'),sideText(t.side)+' • Exit '+priceText(exit)+' • '+(pnl>=0?'+':'')+'₹'+pnl.toFixed(0));
  state.active=null;save();
}

function isFeedStale(){
  if(!state.lastSourceTs)return true;
  const age=Date.now()-state.lastSourceTs*1000;
  return age>12*60*1000;
}

function normalizeOlymptradeRaw(raw){
  if(raw&&raw.ok&&Array.isArray(raw.candles))return raw;
  const charts=Array.isArray(raw?.charts)?raw.charts:[];
  const fresh=charts.filter(c=>Array.isArray(c.candles)&&c.candles.length).sort((a,b)=>Number(b.to||0)-Number(a.to||0))[0];
  if(!fresh)throw new Error('No SHIB OTC chart data');
  return {
    ok:true,
    precision:Number(raw?.asset?.precision??4),
    chart_title:fresh.title||'1D',
    candle_frame:Number(fresh.candle_frame||300),
    candles:fresh.candles||[]
  };
}

async function fetchOfficial(){
  if(fetching)return;fetching=true;
  try{
    let d;
    if(window.AndroidBridge&&typeof window.AndroidBridge.fetchShib==='function'){
      const rawText=window.AndroidBridge.fetchShib();
      const raw=JSON.parse(rawText);
      d=normalizeOlymptradeRaw(raw);
    }else{
      const res=await fetch(API+'?t='+Date.now(),{cache:'no-store'});
      const raw=await res.json();
      if(!res.ok||!raw.ok)throw new Error(raw.error||'Feed unavailable');
      d=normalizeOlymptradeRaw(raw);
    }
    const incoming=(d.candles||[]).map(x=>({ts:Number(x.ts),c:Number(x.c)})).filter(x=>Number.isFinite(x.ts)&&Number.isFinite(x.c)).sort((a,b)=>a.ts-b.ts);
    if(!incoming.length)throw new Error('No official data points');
    const prevLast=state.lastSourceTs;
    state.points=incoming.slice(-400);state.price=state.points.at(-1).c;state.lastSourceTs=state.points.at(-1).ts;
    state.sourceFrame=Number(d.candle_frame||300);state.sourceTitle=d.chart_title||'1D';state.precision=Number(d.precision??4);state.lastFetchAt=Date.now();state.feedError='';
    state.feedOk=!isFeedStale();
    backfillLegacyLosses();
    settleFromOfficialPoints();
    if(state.lastSourceTs!==prevLast){
      state.lastProcessedTs=state.lastSourceTs;
      evaluateOnNewPoint();
    }
  }catch(e){
    state.feedOk=false;state.feedError=String(e?.message||e);
  }finally{
    fetching=false;render();save();
  }
}

function recentWinRate(){const a=state.learning.recent.slice(0,20);if(!a.length)return null;return a.reduce((s,x)=>s+(x.win?1:0),0)/a.length}
function bestWorstPattern(){const arr=Object.entries(state.learning.patterns).filter(([,s])=>s.n>=20).map(([k,s])=>({k,...s,wr:s.w/s.n}));arr.sort((a,b)=>b.wr-a.wr||b.n-a.n);return {best:arr[0]||null,worst:arr.length?arr[arr.length-1]:null}}
function save(){localStorage.setItem('shibPaperState',JSON.stringify(state))}
function priceText(v){if(v==null)return '—';return Number(v).toFixed(Math.max(4,state.precision||4))}
function sideText(side){return side==='UP'?'UP / BUY':'DOWN / SELL'}
function countdownText(expiresAt){
  const sec=Math.max(0,Math.ceil((Number(expiresAt)-Date.now())/1000));
  const m=String(Math.floor(sec/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');
  return m+':'+s;
}
function sendAlert(title,body){
  if(!state.alertsEnabled)return;
  try{
    if(window.AndroidBridge&&typeof window.AndroidBridge.notifyEvent==='function'){
      window.AndroidBridge.notifyEvent(String(title),String(body));
    }else if(navigator.vibrate){
      navigator.vibrate([250,120,250]);
    }
  }catch(e){}
}
function renderLearning(a){const rw=recentWinRate(),bw=bestWorstPattern();$('#learnedTrades').textContent=state.learning.total;$('#recentLearnRate').textContent=rw==null?'—':Math.round(rw*100)+'%';$('#adaptiveDelta').textContent=(a.adaptiveAdjustment>=0?'+':'')+a.adaptiveAdjustment.toFixed(1);$('#adaptiveDelta').className=a.adaptiveAdjustment>0?'up':a.adaptiveAdjustment<0?'down':'neutral';$('#bestPattern').textContent=bw.best?Math.round(bw.best.wr*100)+'% • '+bw.best.n+' trades':'Need 20+ similar trades';$('#worstPattern').textContent=bw.worst?Math.round(bw.worst.wr*100)+'% • '+bw.worst.n+' trades':'Need 20+ similar trades';$('#engineMode').textContent=state.learning.total<20?'LEARNING':state.learning.total<50?'ADAPTING':'ADAPTIVE V3'}

function renderLossDiagnostics(){
  const losses=state.history.filter(x=>x.result==='LOSS');
  $('#lossCount').textContent=losses.length+' LOSS'+(losses.length===1?'':'ES');
  if(!losses.length){
    $('#lossDiagnostics').innerHTML='<div class="loss-empty">No diagnosed losses yet.</div>';
    return;
  }
  $('#lossDiagnostics').innerHTML=losses.map((x,i)=>{
    const d=x.lossDiagnostic;
    if(!d){
      return `<div class="loss-item">
        <div class="loss-head"><b>LOSS #${losses.length-i} • ${sideText(x.side)}</b><span class="down">₹-${Number(x.stake||0).toFixed(0)}</span></div>
        <div class="loss-meta">${new Date(x.signalTime).toLocaleString()} • Entry ${priceText(x.entry)} → Exit ${priceText(x.exit)}</div>
        <div class="loss-code">LEGACY-${x.tradeId||'LOSS'} • detailed snapshot unavailable</div>
        <div class="loss-reason">This trade was recorded before Loss Diagnostic Lab started saving full entry conditions.</div>
      </div>`;
    }
    const s=d.snapshot||{};
    return `<div class="loss-item">
      <div class="loss-head"><b>LOSS #${losses.length-i} • ${sideText(x.side)}</b><span class="down">₹-${Number(x.stake||0).toFixed(0)}</span></div>
      <div class="loss-meta">${new Date(x.signalTime).toLocaleString()} • Entry ${priceText(x.entry)} → Exit ${priceText(x.exit)} • Score ${Math.round(x.confidence||0)}</div>
      <div class="loss-code">${d.code}</div>
      <div class="loss-reason"><b>Likely weakness:</b> ${d.reason}</div>
      <div class="loss-meta">Flags: ${(d.flags||[]).join(', ')} • RSI ${Number(s.rsi||0).toFixed(1)} • Stoch ${Number(s.stochastic||0).toFixed(1)} • EMA ${s.emaTrend||'—'} • MACD ${s.macd||'—'} • BB ${s.bbPos||'—'} • Vol ${s.volatility||'—'} • Bull/Bear ${Math.round(Number(s.bullScore||0))}/${Math.round(Number(s.bearScore||0))} • Gap ${Math.round(Number(s.scoreGap||0))}</div>
    </div>`;
  }).join('');
}

function render(){
  const a=analysis(),p=state.price;
  $('#price').textContent=priceText(p);
  const ch=lastRenderedPrice&&p!=null?(p-lastRenderedPrice)/lastRenderedPrice*100:0;if(p!=null)lastRenderedPrice=p;
  $('#priceChange').textContent=(ch>=0?'+':'')+ch.toFixed(3)+'%';
  const stale=isFeedStale(),threshold=+$('#threshold').value||78,activeSignal=(!stale&&state.feedOk&&!a.exhaustionBlocked&&a.confidence>=threshold&&a.score>=55)?a.side:'NONE';
  const s=$('#signal');s.textContent=stale?'NO TRADE • FEED STALE':activeSignal==='NONE'?'NO TRADE':(a.confidence>=88&&state.learning.total>=20?'SUPER STRONG ':'STRONG ')+activeSignal;s.className=activeSignal==='UP'?'up':activeSignal==='DOWN'?'down':'neutral';
  $('#confidence').textContent=`Adaptive ${a.confidence}/100 • Base ${a.baseConfidence}/100`;$('#scoreFill').style.width=a.confidence+'%';$('#reason').textContent=a.reason;
  const action=$('#signalAction');
  if(state.active){
    action.textContent=`✅ VIRTUAL TRADE TAKEN • ${sideText(state.active.side)} • ₹${state.active.stake} • Entry ${priceText(state.active.entry)}`;
    action.className=state.active.side==='UP'?'up':'down';
  }else if(stale){
    action.textContent='No trade taken • feed stale';
    action.className='muted';
  }else if(activeSignal!=='NONE'){
    const cd=Math.max(1,+$('#cooldown').value||1),eligibleAfter=state.lastTradeTs+cd*(state.sourceFrame||300);
    action.textContent=state.lastTradeTs&&state.lastSourceTs<eligibleAfter?'Strong signal active • waiting for next eligible official candle':'Strong signal ready • waiting for new official candle';
    action.className='muted';
  }else{
    action.textContent='No virtual trade taken on this candle';
    action.className='muted';
  }
  const dot=$('#feedDot'),fs=$('#feedStatus');
  if(state.feedOk&&!stale){dot.style.background='#33d17a';fs.textContent=`OLYMPTRADE SHIB OTC • official public feed • ${Math.round(state.sourceFrame/60)}m • ${new Date(state.lastSourceTs*1000).toLocaleTimeString()}`}
  else{dot.style.background='#ff667e';fs.textContent='OLYMPTRADE FEED • '+(state.feedError||'STALE / waiting')}
  $('#alertsToggle').checked=state.alertsEnabled;
  $('#balance').textContent=fmt(state.balance);const pnl=state.balance-state.startBalance+(state.active?state.active.stake:0);$('#pnl').textContent='P/L '+fmt(pnl);
  if(state.active){
    $('#activeTrade').textContent=sideText(state.active.side)+' • ₹'+state.active.stake;
    $('#activeTrade').className=state.active.side==='UP'?'up':'down';
    const left=countdownText(state.active.expiresAt);
    $('#tradeTimer').textContent=(left==='00:00'?'00:00 • waiting official close':left+' left')+' • expires '+new Date(state.active.expiresAt).toLocaleTimeString();
  }else{$('#activeTrade').textContent='None';$('#activeTrade').className='';$('#tradeTimer').textContent='Waiting for next eligible strong signal'}
  const n=state.wins+state.losses;$('#winRate').textContent=(n?Math.round(state.wins/n*100):0)+'%';$('#record').textContent=state.wins+'W • '+state.losses+'L';renderLearning(a);
  $('#history').innerHTML=state.history.map(x=>{const isOpen=x.result==='OPEN',resultClass=isOpen?'neutral':x.result==='WIN'?'up':'down',exitText=x.exit==null?'—':priceText(x.exit),pnlText=x.pnl==null?'—':(x.pnl>=0?'+':'')+'₹'+Number(x.pnl).toFixed(0),pnlClass=x.pnl==null?'neutral':x.pnl>=0?'up':'down';return `<tr><td>${new Date(x.signalTime).toLocaleTimeString()}</td><td>${new Date(x.expiryTime).toLocaleTimeString()}</td><td class="${x.side==='UP'?'up':'down'}">${sideText(x.side)}</td><td>${priceText(x.entry)}</td><td>${exitText}</td><td>₹${Number(x.stake).toFixed(0)}</td><td>${Math.round(x.confidence||0)}</td><td class="${resultClass}">${isOpen?'⏳ OPEN':x.result}</td><td class="${pnlClass}">${pnlText}</td><td class="muted">${x.learningNote||'—'}</td></tr>`}).join('')||'<tr><td colspan="10" class="muted">No official-feed virtual signals recorded yet</td></tr>';
  renderLossDiagnostics();
  drawChart();
}

function drawChart(){
  const c=$('#chart'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
  const arr=state.points.slice(-80);if(arr.length<2)return;
  const vals=arr.map(v=>v.c),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.1||.01,min=lo-pad,max=hi+pad;
  x.strokeStyle='#233755';x.lineWidth=1;for(let i=1;i<5;i++){const y=h*i/5;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
  x.strokeStyle='#8fb8ff';x.lineWidth=2;x.beginPath();arr.forEach((v,i)=>{const xx=i/(arr.length-1)*w,yy=h-(v.c-min)/(max-min)*h;if(i===0)x.moveTo(xx,yy);else x.lineTo(xx,yy)});x.stroke();
}

$('#resetBtn').onclick=()=>{if(confirm('Reset official-feed virtual balance, history and adaptive learning?')){state=freshState();save();render();fetchOfficial()}};
$('#clearHistory').onclick=()=>{state.history=[];state.wins=0;state.losses=0;save();render()};
['stake','threshold','cooldown','autoMode'].forEach(id=>$('#'+id).addEventListener('change',()=>{save();render()}));
$('#alertsToggle').addEventListener('change',()=>{
  state.alertsEnabled=$('#alertsToggle').checked;
  if(state.alertsEnabled&&window.AndroidBridge&&typeof window.AndroidBridge.requestAlertsPermission==='function'){
    try{window.AndroidBridge.requestAlertsPermission()}catch(e){}
  }
  save();render();
});
window.addEventListener('resize',drawChart);
if(state.alertsEnabled&&window.AndroidBridge&&typeof window.AndroidBridge.requestAlertsPermission==='function'){
  try{window.AndroidBridge.requestAlertsPermission()}catch(e){}
}
render();fetchOfficial();setInterval(fetchOfficial,10000);setInterval(()=>{if(state.active)render()},1000);