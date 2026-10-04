const $=s=>document.querySelector(s);
const fmt=n=>'₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const state=JSON.parse(localStorage.getItem('shibPaperState')||'null')||{
  balance:10000,startBalance:10000,wins:0,losses:0,history:[],active:null,lastTradeCandle:-99,
  price:0.00001250, candles:[], tick:0, candleIndex:0, seed:918273
};
let last=state.price, current=null;
function rand(){
  state.seed=(state.seed*1664525+1013904223)>>>0;
  return state.seed/4294967296;
}
function gauss(){let u=1-rand(),v=1-rand();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function ema(arr,p){if(!arr.length)return 0;let k=2/(p+1),e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}
function sma(arr,p){let a=arr.slice(-p);return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function sd(arr,p){let a=arr.slice(-p),m=sma(arr,p);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length||1))}
function rsi(arr,p=14){if(arr.length<p+1)return 50;let g=0,l=0;for(let i=arr.length-p;i<arr.length;i++){let d=arr[i]-arr[i-1];if(d>0)g+=d;else l-=d}if(!l)return 100;let rs=(g/p)/(l/p);return 100-100/(1+rs)}
function atr(cs,p=14){if(cs.length<p+1)return 0;let tr=[];for(let i=cs.length-p;i<cs.length;i++){let c=cs[i],prev=cs[i-1].c;tr.push(Math.max(c.h-c.l,Math.abs(c.h-prev),Math.abs(c.l-prev)))}return tr.reduce((a,b)=>a+b,0)/tr.length}
function stochastic(cs,p=14){if(cs.length<p)return 50;let a=cs.slice(-p),hi=Math.max(...a.map(x=>x.h)),lo=Math.min(...a.map(x=>x.l)),c=a[a.length-1].c;return hi===lo?50:(c-lo)/(hi-lo)*100}
function analysis(){
  const cs=state.candles, closes=cs.map(x=>x.c);
  if(closes.length<55)return {score:50,side:'NONE',confidence:50,reason:'Collecting candles for deep analysis…'};
  const e9=ema(closes.slice(-80),9),e21=ema(closes.slice(-80),21),e50=ema(closes.slice(-100),50);
  const R=rsi(closes),fast=ema(closes.slice(-60),12),slow=ema(closes.slice(-60),26),mac=fast-slow;
  const macSeries=[]; for(let i=Math.max(30,closes.length-20);i<=closes.length;i++){let a=closes.slice(0,i);macSeries.push(ema(a.slice(-60),12)-ema(a.slice(-60),26))}
  const sig=ema(macSeries,9),hist=mac-sig;
  const mid=sma(closes,20),dev=sd(closes,20),upper=mid+2*dev,lower=mid-2*dev,px=closes.at(-1);
  const st=stochastic(cs),A=atr(cs),atrPct=A/px*100;
  const slope=(e9-e21)/px*100;
  let bull=0,bear=0, reasons=[];
  if(e9>e21&&e21>e50){bull+=25;reasons.push('EMA trend bullish')} else if(e9<e21&&e21<e50){bear+=25;reasons.push('EMA trend bearish')}
  if(R>=52&&R<=72){bull+=14;reasons.push('RSI supports UP')} if(R<=48&&R>=28){bear+=14;reasons.push('RSI supports DOWN')}
  if(hist>0){bull+=17;reasons.push('MACD momentum +')} else {bear+=17;reasons.push('MACD momentum -')}
  if(px>mid&&px<upper){bull+=10} if(px<mid&&px>lower){bear+=10}
  if(st>55&&st<88){bull+=10} if(st<45&&st>12){bear+=10}
  if(slope>.02)bull+=12; else if(slope<-.02)bear+=12;
  if(atrPct>.04&&atrPct<.45){if(bull>bear)bull+=12;else bear+=12;reasons.push('Volatility usable')} else reasons.push('Volatility filter weak');
  const raw=Math.max(bull,bear), side=bull===bear?'NONE':bull>bear?'UP':'DOWN';
  let confidence=Math.min(96,Math.round(50+raw*.48));
  if(Math.abs(bull-bear)<14)confidence=Math.min(confidence,69);
  $('#emaState').textContent=e9>e21&&e21>e50?'Bullish':e9<e21&&e21<e50?'Bearish':'Mixed';
  $('#rsiState').textContent=R.toFixed(1);
  $('#macdState').textContent=hist>0?'Positive':'Negative';
  $('#bbState').textContent=px>upper?'Above upper':px<lower?'Below lower':px>mid?'Upper half':'Lower half';
  $('#stochState').textContent=st.toFixed(1);
  $('#atrState').textContent=atrPct.toFixed(3)+'%';
  $('#regime').textContent=atrPct>.45?'HIGH VOL':Math.abs(slope)>.025?'TREND':'RANGE';
  return {score:raw,side,confidence,reason:reasons.join(' • '),rsi:R,atrPct};
}
function startCandle(){
  current={o:state.price,h:state.price,l:state.price,c:state.price,t:Date.now()};
}
function closeCandle(){
  if(!current)return;
  state.candles.push(current); if(state.candles.length>180)state.candles.shift();
  state.candleIndex++; current=null; startCandle();
  evaluateSignal();
}
function marketTick(){
  if(!current)startCandle();
  const cs=state.candles, prev=cs.at(-1), prev2=cs.at(-2);
  let trend=0;
  if(prev&&prev2)trend=(prev.c-prev2.c)/Math.max(prev2.c,1e-12)*0.15;
  const cycle=Math.sin(state.tick/53)*0.00018;
  const shock=gauss()*0.00055 + trend + cycle;
  state.price=Math.max(0.000001,state.price*(1+shock));
  current.c=state.price; current.h=Math.max(current.h,state.price); current.l=Math.min(current.l,state.price);
  state.tick++;
  if(state.tick%5===0) closeCandle();
  settleIfNeeded();
  render();
  save();
}
function evaluateSignal(){
  const a=analysis(),threshold=Math.max(60,Math.min(95,+$('#threshold').value||78));
  const strong=a.side!=='NONE' && a.confidence>=threshold && a.score>=55;
  if(strong && $('#autoMode').checked && !state.active){
    const cooldown=+$('#cooldown').value||2;
    if(state.candleIndex-state.lastTradeCandle>=cooldown) openTrade(a.side,a.confidence);
  }
}
function openTrade(side,confidence){
  let stake=Math.max(10,+$('#stake').value||100);
  stake=Math.min(stake,state.balance);
  if(stake<10)return;
  state.balance-=stake;
  const tf=+$('#timeframe').value||120;
  const openedAt=Date.now(), expiresAt=openedAt+tf*1000;
  const tradeId='T'+openedAt+'-'+state.candleIndex;
  state.active={tradeId,side,entry:state.price,stake,confidence,expiresTick:state.tick+tf,openedAt,expiresAt};
  state.history.unshift({
    tradeId,signalTime:openedAt,expiryTime:expiresAt,side,entry:state.price,exit:null,
    stake,confidence,result:'OPEN',pnl:null
  });
  state.history=state.history.slice(0,100);
  state.lastTradeCandle=state.candleIndex;
  save();
}
function settleIfNeeded(){
  const t=state.active;if(!t||state.tick<t.expiresTick)return;
  const exit=state.price;
  const win=t.side==='UP'?exit>t.entry:exit<t.entry;
  let pnl;
  if(win){state.balance+=t.stake*1.9;pnl=t.stake*.9;state.wins++} else {pnl=-t.stake;state.losses++}
  let row=state.history.find(x=>x.tradeId&&x.tradeId===t.tradeId);
  if(row){
    row.exit=exit;row.result=win?'WIN':'LOSS';row.pnl=pnl;row.settledAt=Date.now();
    row.expiryTime=row.expiryTime||t.expiresAt||Date.now();
  }else{
    state.history.unshift({
      tradeId:t.tradeId||('T'+t.openedAt),signalTime:t.openedAt||Date.now(),
      expiryTime:t.expiresAt||Date.now(),side:t.side,entry:t.entry,exit,stake:t.stake,
      confidence:t.confidence,result:win?'WIN':'LOSS',pnl,settledAt:Date.now()
    });
  }
  state.history=state.history.slice(0,100);
  state.active=null;
  save();
}
function save(){localStorage.setItem('shibPaperState',JSON.stringify(state))}
function render(){
  const a=analysis(), p=state.price, ch=(p-last)/last*100; last=p;
  $('#price').textContent=p.toFixed(8); $('#priceChange').textContent=(ch>=0?'+':'')+ch.toFixed(3)+'%';
  const threshold=+$('#threshold').value||78, activeSignal=(a.confidence>=threshold&&a.score>=55)?a.side:'NONE';
  const s=$('#signal'); s.textContent=activeSignal==='NONE'?'NO TRADE':'STRONG '+activeSignal; s.className=activeSignal==='UP'?'up':activeSignal==='DOWN'?'down':'neutral';
  $('#confidence').textContent='Confidence '+a.confidence+'/100'; $('#scoreFill').style.width=a.confidence+'%'; $('#reason').textContent=a.reason;
  $('#balance').textContent=fmt(state.balance); const pnl=state.balance-state.startBalance+(state.active?state.active.stake:0); $('#pnl').textContent='P/L '+fmt(pnl);
  if(state.active){
    $('#activeTrade').textContent=state.active.side+' ₹'+state.active.stake;
    $('#activeTrade').className=state.active.side==='UP'?'up':'down';
    const left=Math.max(0,state.active.expiresTick-state.tick);
    $('#tradeTimer').textContent=left+' sec left • expires '+new Date(state.active.expiresAt||Date.now()+left*1000).toLocaleTimeString();
  } else {$('#activeTrade').textContent='None';$('#activeTrade').className='';$('#tradeTimer').textContent='Waiting for strong setup'}
  const n=state.wins+state.losses;$('#winRate').textContent=(n?Math.round(state.wins/n*100):0)+'%';$('#record').textContent=state.wins+'W • '+state.losses+'L';
  $('#history').innerHTML=state.history.map(x=>{
    const signalTs=x.signalTime||x.time||Date.now();
    const expiryTs=x.expiryTime||x.time||signalTs;
    const isOpen=x.result==='OPEN';
    const resultClass=isOpen?'neutral':x.result==='WIN'?'up':'down';
    const exitText=x.exit==null?'—':Number(x.exit).toFixed(8);
    const pnlText=x.pnl==null?'—':(x.pnl>=0?'+':'')+'₹'+Number(x.pnl).toFixed(0);
    const pnlClass=x.pnl==null?'neutral':x.pnl>=0?'up':'down';
    return `<tr>
      <td>${new Date(signalTs).toLocaleTimeString()}</td>
      <td>${new Date(expiryTs).toLocaleTimeString()}</td>
      <td class="${x.side==='UP'?'up':'down'}">${x.side}</td>
      <td>${Number(x.entry).toFixed(8)}</td>
      <td>${exitText}</td>
      <td>₹${Number(x.stake).toFixed(0)}</td>
      <td class="${resultClass}">${isOpen?'⏳ OPEN':x.result}</td>
      <td class="${pnlClass}">${pnlText}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8" class="muted">No virtual signals recorded yet</td></tr>';
  drawChart();
}
function drawChart(){
  const c=$('#chart'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);
  const arr=[...state.candles.slice(-55),...(current?[current]:[])];if(arr.length<2)return;
  const lo=Math.min(...arr.map(v=>v.l)),hi=Math.max(...arr.map(v=>v.h)),pad=(hi-lo)*.1||1e-9;const min=lo-pad,max=hi+pad;
  x.strokeStyle='#233755';x.lineWidth=1;for(let i=1;i<5;i++){let y=h*i/5;x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke()}
  const cw=w/arr.length*.58;arr.forEach((v,i)=>{let cx=(i+.5)*w/arr.length, yH=h-(v.h-min)/(max-min)*h,yL=h-(v.l-min)/(max-min)*h,yO=h-(v.o-min)/(max-min)*h,yC=h-(v.c-min)/(max-min)*h;let up=v.c>=v.o;x.strokeStyle=up?'#3be087':'#ff667e';x.fillStyle=x.strokeStyle;x.beginPath();x.moveTo(cx,yH);x.lineTo(cx,yL);x.stroke();x.fillRect(cx-cw/2,Math.min(yO,yC),cw,Math.max(1,Math.abs(yC-yO)))});
}
$('#resetBtn').onclick=()=>{if(confirm('Reset virtual balance and all trade history?')){localStorage.removeItem('shibPaperState');location.reload()}};
$('#clearHistory').onclick=()=>{state.history=[];state.wins=0;state.losses=0;save();render()};
['stake','threshold','cooldown','timeframe','autoMode'].forEach(id=>$('#'+id).addEventListener('change',()=>{save();render()}));
window.addEventListener('resize',drawChart);
while(state.candles.length<65){ if(!current)startCandle(); for(let j=0;j<5;j++){let shock=gauss()*.00055;state.price*=1+shock;current.c=state.price;current.h=Math.max(current.h,state.price);current.l=Math.min(current.l,state.price)} state.candles.push(current);state.candleIndex++;current=null}
startCandle();render();setInterval(marketTick,1000);