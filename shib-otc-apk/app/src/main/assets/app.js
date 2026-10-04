const $=s=>document.querySelector(s);
const fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

const state=JSON.parse(localStorage.getItem('shibPaperState')||'null')||{
  balance:10000,startBalance:10000,wins:0,losses:0,history:[],active:null,lastTradeCandle:-99,
  price:0.00001250,candles:[],tick:0,candleIndex:0,seed:918273,
  learning:{version:2,total:0,patterns:{},tags:{},recent:[]}
};
state.learning=state.learning||{version:2,total:0,patterns:{},tags:{},recent:[]};
state.learning.version=2;
state.learning.patterns=state.learning.patterns||{};
state.learning.tags=state.learning.tags||{};
state.learning.recent=state.learning.recent||[];
state.learning.total=Number(state.learning.total||0);

let last=state.price,current=null;

function rand(){state.seed=(state.seed*1664525+1013904223)>>>0;return state.seed/4294967296}
function gauss(){let u=1-rand(),v=1-rand();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function ema(arr,p){if(!arr.length)return 0;let k=2/(p+1),e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}
function sma(arr,p){let a=arr.slice(-p);return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function sd(arr,p){let a=arr.slice(-p),m=sma(arr,p);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length||1))}
function rsi(arr,p=14){if(arr.length<p+1)return 50;let g=0,l=0;for(let i=arr.length-p;i<arr.length;i++){let d=arr[i]-arr[i-1];if(d>0)g+=d;else l-=d}if(!l)return 100;let rs=(g/p)/(l/p);return 100-100/(1+rs)}
function atr(cs,p=14){if(cs.length<p+1)return 0;let tr=[];for(let i=cs.length-p;i<cs.length;i++){let c=cs[i],prev=cs[i-1].c;tr.push(Math.max(c.h-c.l,Math.abs(c.h-prev),Math.abs(c.l-prev)))}return tr.reduce((a,b)=>a+b,0)/tr.length}
function stochastic(cs,p=14){if(cs.length<p)return 50;let a=cs.slice(-p),hi=Math.max(...a.map(x=>x.h)),lo=Math.min(...a.map(x=>x.l)),c=a[a.length-1].c;return hi===lo?50:(c-lo)/(hi-lo)*100}

function band(v,cuts,labels){for(let i=0;i<cuts.length;i++)if(v<cuts[i])return labels[i];return labels[labels.length-1]}
function hourBucket(ts=Date.now()){const h=new Date(ts).getHours();return h<6?'night':h<12?'morning':h<18?'day':'evening'}

function makeFeatures({side,R,hist,px,mid,upper,lower,st,atrPct,slope,e9,e21,e50}){
  const emaTrend=e9>e21&&e21>e50?'bull':e9<e21&&e21<e50?'bear':'mixed';
  const regime=atrPct>.45?'highvol':Math.abs(slope)>.025?'trend':'range';
  const rsiBand=band(R,[35,50,65],['low','midlow','midhigh','high']);
  const stochBand=band(st,[25,50,75],['low','midlow','midhigh','high']);
  const bbPos=px>upper?'above':px<lower?'below':px>mid?'upper':'lower';
  const volBand=band(atrPct,[.04,.15,.45],['dead','normal','active','extreme']);
  const macd=hist>0?'pos':'neg';
  const direction=side||'NONE';
  const tags=[
    'side:'+direction,'regime:'+regime,'ema:'+emaTrend,'rsi:'+rsiBand,
    'macd:'+macd,'bb:'+bbPos,'stoch:'+stochBand,'vol:'+volBand,'hour:'+hourBucket()
  ];
  const patternKey=[direction,regime,emaTrend,rsiBand,macd,stochBand,volBand].join('|');
  return {direction,regime,emaTrend,rsiBand,macd,bbPos,stochBand,volBand,atrPct,R,st,slope,tags,patternKey};
}

function statScore(stat,minSamples,maxAdj){
  if(!stat||stat.n<minSamples)return {adj:0,wr:null,n:stat?.n||0};
  const wr=(stat.w+2)/(stat.n+4);
  const reliability=Math.min(1,(stat.n-minSamples+1)/20);
  const edge=(wr-.5)*2;
  return {adj:edge*maxAdj*reliability,wr,n:stat.n};
}

function adaptiveAdjustment(features){
  const pieces=[];
  const p=statScore(state.learning.patterns[features.patternKey],5,9);
  if(p.n)pieces.push({name:'pattern',...p,weight:1.35});
  for(const tag of features.tags){
    const s=statScore(state.learning.tags[tag],8,3);
    if(s.n)pieces.push({name:tag,...s,weight:1});
  }
  if(!pieces.length)return {adjustment:0,learnedSamples:0,patternWinRate:null,evidence:'Learning: not enough similar trades yet'};
  let num=0,den=0,totalN=0;
  for(const x of pieces){num+=x.adj*x.weight;den+=x.weight;totalN+=x.n}
  let adjustment=Math.max(-12,Math.min(12,num/Math.max(1,den)));
  const exact=state.learning.patterns[features.patternKey];
  const patternWinRate=exact&&exact.n?exact.w/exact.n:null;
  const evidence=patternWinRate==null
    ?'Adaptive score uses learned component history'
    :`Similar pattern: ${exact.w}/${exact.n} WIN (${Math.round(patternWinRate*100)}%)`;
  return {adjustment,learnedSamples:totalN,patternWinRate,evidence};
}

function analysis(){
  const cs=state.candles,closes=cs.map(x=>x.c);
  if(closes.length<55)return {score:50,side:'NONE',baseConfidence:50,confidence:50,adaptiveAdjustment:0,reason:'Collecting candles for deep analysis…',features:null};
  const e9=ema(closes.slice(-80),9),e21=ema(closes.slice(-80),21),e50=ema(closes.slice(-100),50);
  const R=rsi(closes),fast=ema(closes.slice(-60),12),slow=ema(closes.slice(-60),26),mac=fast-slow;
  const macSeries=[];for(let i=Math.max(30,closes.length-20);i<=closes.length;i++){let a=closes.slice(0,i);macSeries.push(ema(a.slice(-60),12)-ema(a.slice(-60),26))}
  const sig=ema(macSeries,9),hist=mac-sig;
  const mid=sma(closes,20),dev=sd(closes,20),upper=mid+2*dev,lower=mid-2*dev,px=closes.at(-1);
  const st=stochastic(cs),A=atr(cs),atrPct=A/px*100,slope=(e9-e21)/px*100;
  let bull=0,bear=0,reasons=[];
  if(e9>e21&&e21>e50){bull+=25;reasons.push('EMA trend bullish')}else if(e9<e21&&e21<e50){bear+=25;reasons.push('EMA trend bearish')}else reasons.push('EMA trend mixed');
  if(R>=52&&R<=72){bull+=14;reasons.push('RSI supports UP')}if(R<=48&&R>=28){bear+=14;reasons.push('RSI supports DOWN')}
  if(hist>0){bull+=17;reasons.push('MACD momentum +')}else{bear+=17;reasons.push('MACD momentum -')}
  if(px>mid&&px<upper)bull+=10;if(px<mid&&px>lower)bear+=10;
  if(st>55&&st<88)bull+=10;if(st<45&&st>12)bear+=10;
  if(slope>.02)bull+=12;else if(slope<-.02)bear+=12;
  if(atrPct>.04&&atrPct<.45){if(bull>bear)bull+=12;else bear+=12;reasons.push('Volatility usable')}else reasons.push('Volatility filter weak');
  const raw=Math.max(bull,bear),side=bull===bear?'NONE':bull>bear?'UP':'DOWN';
  let baseConfidence=Math.min(96,Math.round(50+raw*.48));
  if(Math.abs(bull-bear)<14)baseConfidence=Math.min(baseConfidence,69);
  const features=makeFeatures({side,R,hist,px,mid,upper,lower,st,atrPct,slope,e9,e21,e50});
  const adapt=adaptiveAdjustment(features);
  let confidence=Math.round(Math.max(45,Math.min(97,baseConfidence+adapt.adjustment)));
  if(side==='NONE')confidence=Math.min(confidence,60);

  $('#emaState').textContent=features.emaTrend==='bull'?'Bullish':features.emaTrend==='bear'?'Bearish':'Mixed';
  $('#rsiState').textContent=R.toFixed(1);
  $('#macdState').textContent=hist>0?'Positive':'Negative';
  $('#bbState').textContent=px>upper?'Above upper':px<lower?'Below lower':px>mid?'Upper half':'Lower half';
  $('#stochState').textContent=st.toFixed(1);
  $('#atrState').textContent=atrPct.toFixed(3)+'%';
  $('#regime').textContent=features.regime.toUpperCase();
  return {
    score:raw,side,baseConfidence,confidence,adaptiveAdjustment:adapt.adjustment,
    learnedSamples:adapt.learnedSamples,patternWinRate:adapt.patternWinRate,
    reason:reasons.join(' • ')+' • '+adapt.evidence,features
  };
}

function updateBucket(obj,key,win){
  if(!key)return;
  const s=obj[key]||(obj[key]={n:0,w:0,l:0,last:[]});
  s.n++;if(win)s.w++;else s.l++;
  s.last.unshift(win?1:0);s.last=s.last.slice(0,20);
}

function learnFromTrade(t,win){
  const f=t.features;if(!f)return;
  state.learning.total++;
  updateBucket(state.learning.patterns,f.patternKey,win);
  for(const tag of f.tags||[])updateBucket(state.learning.tags,tag,win);
  state.learning.recent.unshift({time:Date.now(),win:!!win,side:t.side,patternKey:f.patternKey});
  state.learning.recent=state.learning.recent.slice(0,50);
}

function lossReason(t){
  const f=t.features;if(!f)return 'Pattern underperformed';
  const problems=[];
  if(f.regime==='highvol'||f.volBand==='extreme')problems.push('High volatility');
  if(f.emaTrend==='mixed')problems.push('Mixed EMA trend');
  if(t.side==='UP'&&f.macd==='neg')problems.push('MACD conflict');
  if(t.side==='DOWN'&&f.macd==='pos')problems.push('MACD conflict');
  if(t.side==='UP'&&f.rsiBand==='high')problems.push('RSI too high');
  if(t.side==='DOWN'&&f.rsiBand==='low')problems.push('RSI too low');
  if(!problems.length)problems.push('Similar setup needs lower weight');
  return problems.slice(0,2).join(' + ');
}

function startCandle(){current={o:state.price,h:state.price,l:state.price,c:state.price,t:Date.now()}}
function closeCandle(){
  if(!current)return;
  state.candles.push(current);if(state.candles.length>180)state.candles.shift();
  state.candleIndex++;current=null;startCandle();evaluateSignal();
}
function marketTick(){
  if(!current)startCandle();
  const cs=state.candles,prev=cs.at(-1),prev2=cs.at(-2);
  let trend=0;if(prev&&prev2)trend=(prev.c-prev2.c)/Math.max(prev2.c,1e-12)*0.15;
  const cycle=Math.sin(state.tick/53)*0.00018,shock=gauss()*0.00055+trend+cycle;
  state.price=Math.max(0.000001,state.price*(1+shock));
  current.c=state.price;current.h=Math.max(current.h,state.price);current.l=Math.min(current.l,state.price);
  state.tick++;if(state.tick%5===0)closeCandle();settleIfNeeded();render();save();
}

function evaluateSignal(){
  const a=analysis(),threshold=Math.max(60,Math.min(95,+$('#threshold').value||78));
  const strong=a.side!=='NONE'&&a.confidence>=threshold&&a.score>=55;
  if(strong&&$('#autoMode').checked&&!state.active){
    const cooldown=+$('#cooldown').value||2;
    if(state.candleIndex-state.lastTradeCandle>=cooldown)openTrade(a);
  }
}

function openTrade(a){
  let stake=Math.max(10,+$('#stake').value||100);stake=Math.min(stake,state.balance);if(stake<10)return;
  state.balance-=stake;
  const tf=+$('#timeframe').value||120,openedAt=Date.now(),expiresAt=openedAt+tf*1000;
  const tradeId='T'+openedAt+'-'+state.candleIndex;
  state.active={
    tradeId,side:a.side,entry:state.price,stake,confidence:a.confidence,baseConfidence:a.baseConfidence,
    adaptiveAdjustment:a.adaptiveAdjustment,features:a.features,expiresTick:state.tick+tf,openedAt,expiresAt
  };
  state.history.unshift({
    tradeId,signalTime:openedAt,expiryTime:expiresAt,side:a.side,entry:state.price,exit:null,stake,
    confidence:a.confidence,baseConfidence:a.baseConfidence,adaptiveAdjustment:a.adaptiveAdjustment,
    patternKey:a.features?.patternKey||'',result:'OPEN',pnl:null,learningNote:'Waiting for result'
  });
  state.history=state.history.slice(0,100);state.lastTradeCandle=state.candleIndex;save();
}

function settleIfNeeded(){
  const t=state.active;if(!t||state.tick<t.expiresTick)return;
  const exit=state.price,win=t.side==='UP'?exit>t.entry:exit<t.entry;let pnl;
  if(win){state.balance+=t.stake*1.9;pnl=t.stake*.9;state.wins++}else{pnl=-t.stake;state.losses++}
  learnFromTrade(t,win);
  let row=state.history.find(x=>x.tradeId&&x.tradeId===t.tradeId);
  const note=win?'Winning setup reinforced':lossReason(t);
  if(row){
    row.exit=exit;row.result=win?'WIN':'LOSS';row.pnl=pnl;row.settledAt=Date.now();
    row.expiryTime=row.expiryTime||t.expiresAt||Date.now();row.learningNote=note;
  }else{
    state.history.unshift({
      tradeId:t.tradeId||('T'+t.openedAt),signalTime:t.openedAt||Date.now(),expiryTime:t.expiresAt||Date.now(),
      side:t.side,entry:t.entry,exit,stake:t.stake,confidence:t.confidence,baseConfidence:t.baseConfidence,
      adaptiveAdjustment:t.adaptiveAdjustment,result:win?'WIN':'LOSS',pnl,settledAt:Date.now(),learningNote:note
    });
  }
  state.history=state.history.slice(0,100);state.active=null;save();
}

function recentWinRate(){
  const a=state.learning.recent.slice(0,20);if(!a.length)return null;
  return a.reduce((s,x)=>s+(x.win?1:0),0)/a.length;
}
function bestWorstPattern(){
  const arr=Object.entries(state.learning.patterns).filter(([,s])=>s.n>=5).map(([k,s])=>({k,...s,wr:s.w/s.n}));
  arr.sort((a,b)=>b.wr-a.wr||b.n-a.n);
  return {best:arr[0]||null,worst:arr.length?arr[arr.length-1]:null};
}

function save(){localStorage.setItem('shibPaperState',JSON.stringify(state))}

function renderLearning(a){
  const rw=recentWinRate(),bw=bestWorstPattern();
  $('#learnedTrades').textContent=state.learning.total;
  $('#recentLearnRate').textContent=rw==null?'—':Math.round(rw*100)+'%';
  $('#adaptiveDelta').textContent=(a.adaptiveAdjustment>=0?'+':'')+a.adaptiveAdjustment.toFixed(1);
  $('#adaptiveDelta').className=a.adaptiveAdjustment>0?'up':a.adaptiveAdjustment<0?'down':'neutral';
  $('#bestPattern').textContent=bw.best?Math.round(bw.best.wr*100)+'% • '+bw.best.n+' trades':'Need 5+ similar trades';
  $('#worstPattern').textContent=bw.worst?Math.round(bw.worst.wr*100)+'% • '+bw.worst.n+' trades':'Need 5+ similar trades';
  $('#engineMode').textContent=state.learning.total<5?'LEARNING':state.learning.total<20?'ADAPTING':'ADAPTIVE V2';
}

function render(){
  const a=analysis(),p=state.price,ch=(p-last)/last*100;last=p;
  $('#price').textContent=p.toFixed(8);$('#priceChange').textContent=(ch>=0?'+':'')+ch.toFixed(3)+'%';
  const threshold=+$('#threshold').value||78,activeSignal=(a.confidence>=threshold&&a.score>=55)?a.side:'NONE';
  const s=$('#signal');
  s.textContent=activeSignal==='NONE'?'NO TRADE':(a.confidence>=88&&state.learning.total>=10?'SUPER STRONG ':'STRONG ')+activeSignal;
  s.className=activeSignal==='UP'?'up':activeSignal==='DOWN'?'down':'neutral';
  $('#confidence').textContent=`Adaptive ${a.confidence}/100 • Base ${a.baseConfidence}/100`;
  $('#scoreFill').style.width=a.confidence+'%';$('#reason').textContent=a.reason;
  $('#balance').textContent=fmt(state.balance);
  const pnl=state.balance-state.startBalance+(state.active?state.active.stake:0);$('#pnl').textContent='P/L '+fmt(pnl);
  if(state.active){
    $('#activeTrade').textContent=state.active.side+' ₹'+state.active.stake;$('#activeTrade').className=state.active.side==='UP'?'up':'down';
    const left=Math.max(0,state.active.expiresTick-state.tick);
    $('#tradeTimer').textContent=left+' sec left • expires '+new Date(state.active.expiresAt||Date.now()+left*1000).toLocaleTimeString();
  }else{$('#activeTrade').textContent='None';$('#activeTrade').className='';$('#tradeTimer').textContent='Waiting for strong adaptive setup'}
  const n=state.wins+state.losses;$('#winRate').textContent=(n?Math.round(state.wins/n*100):0)+'%';$('#record').textContent=state.wins+'W • '+state.losses+'L';
  renderLearning(a);
  $('#history').innerHTML=state.history.map(x=>{
    const signalTs=x.signalTime||x.time||Date.now(),expiryTs=x.expiryTime||x.time||signalTs,isOpen=x.result==='OPEN';
    const resultClass=isOpen?'neutral':x.result==='WIN'?'up':'down',exitText=x.exit==null?'—':Number(x.exit).toFixed(8);
    const pnlText=x.pnl==null?'—':(x.pnl>=0?'+':'')+'₹'+Number(x.pnl).toFixed(0),pnlClass=x.pnl==null?'neutral':x.pnl>=0?'up':'down';
    const scoreText=x.confidence==null?'—':Math.round(x.confidence);
    return `<tr>
      <td>${new Date(signalTs).toLocaleTimeString()}</td><td>${new Date(expiryTs).toLocaleTimeString()}</td>
      <td class="${x.side==='UP'?'up':'down'}">${x.side}</td><td>${Number(x.entry).toFixed(8)}</td><td>${exitText}</td>
      <td>₹${Number(x.stake).toFixed(0)}</td><td>${scoreText}</td>
      <td class="${resultClass}">${isOpen?'⏳ OPEN':x.result}</td><td class="${pnlClass}">${pnlText}</td>
      <td class="muted">${x.learningNote||'—'}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="10" class="muted">No virtual signals recorded yet</td></tr>';
  drawChart();
}

function drawChart(){
  const c=$('#chart'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;
  const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
  const arr=[...state.candles.slice(-55),...(current?[current]:[])];if(arr.length<2)return;
  const lo=Math.min(...arr.map(v=>v.l)),hi=Math.max(...arr.map(v=>v.h)),pad=(hi-lo)*.1||1e-9,min=lo-pad,max=hi+pad;
  x.strokeStyle='#233755';x.lineWidth=1;for(let i=1;i<5;i++){let y=h*i/5;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
  const cw=w/arr.length*.58;arr.forEach((v,i)=>{
    let cx=(i+.5)*w/arr.length,yH=h-(v.h-min)/(max-min)*h,yL=h-(v.l-min)/(max-min)*h,yO=h-(v.o-min)/(max-min)*h,yC=h-(v.c-min)/(max-min)*h,up=v.c>=v.o;
    x.strokeStyle=up?'#3be087':'#ff667e';x.fillStyle=x.strokeStyle;x.beginPath();x.moveTo(cx,yH);x.lineTo(cx,yL);x.stroke();
    x.fillRect(cx-cw/2,Math.min(yO,yC),cw,Math.max(1,Math.abs(yC-yO)));
  });
}

$('#resetBtn').onclick=()=>{if(confirm('Reset virtual balance, history and adaptive learning?')){localStorage.removeItem('shibPaperState');location.reload()}};
$('#clearHistory').onclick=()=>{state.history=[];state.wins=0;state.losses=0;save();render()};
['stake','threshold','cooldown','timeframe','autoMode'].forEach(id=>$('#'+id).addEventListener('change',()=>{save();render()}));
window.addEventListener('resize',drawChart);

while(state.candles.length<65){
  if(!current)startCandle();
  for(let j=0;j<5;j++){let shock=gauss()*.00055;state.price*=1+shock;current.c=state.price;current.h=Math.max(current.h,state.price);current.l=Math.min(current.l,state.price)}
  state.candles.push(current);state.candleIndex++;current=null;
}
startCandle();render();setInterval(marketTick,1000);