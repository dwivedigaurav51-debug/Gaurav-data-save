const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app/src/main/assets/paper.js'),'utf8');
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'),'utf8');
const styles=fs.readFileSync(path.join(root,'app/src/main/assets/styles.css'),'utf8');
assert(html.includes('<details id="paperHistoryDetails"'),'Trade history must fold');
assert(html.includes('<details id="currencyDetails"'),'Currency watchlist must fold');
assert(!html.includes('<details id="paperHistoryDetails" open'),'Trade history is closed by default');
assert(!html.includes('<details id="currencyDetails" open'),'Watchlist is closed by default');
assert(html.includes('id="paperResultOverlay"'),'Large final result display exists');
assert(html.includes('id="paperRefill"'),'Auto-refill setting exists');
assert(styles.includes('.compact-scroll'),'History scroll region exists');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
for(const [,id] of source.matchAll(/\$\('#([^']+)'\)/g))assert(ids.has(id),'Unmatched paper selector '+id);
const elements={},actions={},memory={},alerts=[],clock={now:Math.floor(Date.now()/300000)*300000+15000};
function el(sel){return elements[sel]||(elements[sel]={checked:true,hidden:true,innerHTML:'',textContent:'',className:'',scrollTop:0,style:{},addEventListener(type,fn){actions[sel+':'+type]=fn}})}
class FakeDate extends Date{
 constructor(...args){super(...(args.length?args:[clock.now]))}
 static now(){return clock.now}
}
const sandbox={
 Date:FakeDate,Math,Number,String,JSON,Array,Object,Map,Set,Intl,console,
 window:{MultiBridge:{notifySignal(...args){alerts.push(args)}}},
 localStorage:{getItem:k=>memory[k]??null,setItem:(k,val)=>{memory[k]=val}},
 document:{querySelector:el},
 setTimeout(){return 100},clearTimeout(){},alert(){},
 confirm(){return true}
};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'paper.js',timeout:5000});
const paper=()=>sandbox.window.PaperVirtual;
const asset={symbol:'EURUSD_OTC',name:'EUR/USD OTC'};
const base=Math.floor(clock.now/300000)*300;
assert.equal(paper().onStrong(asset,{score:99,side:'UP',lastTs:base,price:100}).opened,false,'99/100 is never traded');
const accepted=paper().onStrong(asset,{score:100,side:'UP',lastTs:base,price:100});
assert.equal(accepted.opened,true,'100-score trade opens');
assert.equal(paper().getWallet().balance,9800);
paper().renderOpen();
assert(el('#paperOpenList').innerHTML.includes('05:00'),'Second countdown starts at five minutes');
assert(el('#paperOpenList').innerHTML.includes('Expiry Countdown'),'Countdown is visually prominent');

clock.now=(base+301)*1000;
const tentative=paper().onFeed(asset.symbol,[{ts:base,c:100},{ts:base+300,c:101}],clock.now);
assert.equal(tentative.length,0,'Early quote must not settle trade');
paper().renderOpen();
assert(el('#paperOpenList').innerHTML.includes('INDICATIVE WIN'),'Observed source data updates provisional WIN');
assert.equal(paper().totals().open,1,'Provisional WIN is still OPEN');
assert.equal(paper().totals().wins,0,'Provisional WIN must not count as WIN');

clock.now=(base+601)*1000;
paper().renderOpen();
assert(el('#paperOpenList').innerHTML.includes('00:00'),'Countdown reaches zero without fabricating a result');
assert(el('#paperOpenList').innerHTML.includes('RESULT PENDING'),'Wait for verified expiry data');
assert(!el('#paperOpenList').innerHTML.includes('INDICATIVE WIN'),'A pre-expiry preview must not masquerade as a final WIN after expiry');
assert.equal(paper().totals().open,1,'Trade remains open until validated settlement');
const finished=paper().onFeed(asset.symbol,[{ts:base,c:100},{ts:base+300,c:101},{ts:base+600,c:99}],clock.now);
assert.equal(finished.length,1);
assert.equal(finished[0].status,'LOSS','Final quote overrides tentative WIN');
assert.equal(el('#paperResultOverlay').hidden,false,'Big final result appears on screen');
assert.equal(el('#paperResultBig').textContent,'LOSS','Large LOSS is clearly shown');
assert.equal(el('#paperResultSymbol').textContent.includes('EUR/USD'),true);
assert.equal(paper().getWallet().trades[0].status,'LOSS','Completed entry stored in history');
actions['#paperResultDismiss:click']();
assert.equal(el('#paperResultOverlay').hidden,true,'Result dismissible before next signal');
assert.equal(alerts.length,0,'WIN/LOSS never causes a phone notification');

clock.now=(base+901)*1000;
for(let i=0;i<110;i++){
 const candle=Math.floor(clock.now/300000)*300;
 const opened=paper().onStrong(asset,{score:100,side:'UP',lastTs:candle,price:100});
 assert.equal(opened.opened,true,'Unlimited paper trade '+i+' should open');
 clock.now=(candle+601)*1000;
 const result=paper().onFeed(asset.symbol,[{ts:candle,c:100},{ts:candle+600,c:90}],clock.now);
 assert.equal(result.length,1,'Each trade should settle');
 assert.equal(result[0].status,'LOSS');
 actions['#paperResultDismiss:click']();
 clock.now=(candle+901)*1000;
}
const stats=paper().totals();
paper().render();
assert.equal(stats.trades,111,'More than 100 completed records are retained');
assert.equal(stats.losses,111);
assert(paper().getWallet().refillTotal>=20000,'Demo balance is automatically topped up after it runs low');
assert.equal(stats.pnl,-22200,'Virtual topups do not inflate net P/L');
assert.equal(el('#paperTotalTrades').textContent,'111','Dashboard shows count without five-trade cap');
assert(el('#paperHistoryCount').textContent.includes('111 completed'),'Folded history summary shows total');
assert(el('#paperHistoryMore').hidden===false,'Older history has a load-more button');
const initialHistory=el('#paperHistory').innerHTML.length;
actions['#paperHistoryMore:click']();
assert(el('#paperHistory').innerHTML.length>initialHistory,'Older trades expand inside scroll region');
assert(el('#paperRefillTotal').textContent.startsWith('₹'),'Topups separately displayed');
const raw=memory.envargOtcMultiPaperV3_100only;
assert(raw,'Original V3 storage key reused to preserve history');
vm.runInContext(source,sandbox,{filename:'paper-reload.js',timeout:5000});
assert.equal(paper().totals().trades,111,'Virtual history survives reload');
assert.equal(paper().totals().pnl,-22200,'Lifetime performance survives reload');
const pairCandle=Math.floor(clock.now/300000)*300;
const newTradeA=paper().onStrong(asset,{score:100,side:'UP',lastTs:pairCandle,price:100});
const newTradeB=paper().onStrong({symbol:'GBPJPY_OTC',name:'GBP/JPY OTC'},{score:100,side:'DOWN',lastTs:pairCandle,price:100});
assert(newTradeA.opened&&newTradeB.opened,'Concurrent virtual entries across two currencies supported');
clock.now=(pairCandle+601)*1000;
const closeA=paper().onFeed('EURUSD_OTC',[{ts:pairCandle,c:100},{ts:pairCandle+600,c:101}],clock.now);
const closeB=paper().onFeed('GBPJPY_OTC',[{ts:pairCandle,c:100},{ts:pairCandle+600,c:101}],clock.now);
assert.equal(closeA[0].status,'WIN');
assert.equal(closeB[0].status,'LOSS');
assert.equal(el('#paperResultBig').textContent,'WIN','First final result is not overwritten by second');
actions['#paperResultDismiss:click']();
assert.equal(el('#paperResultBig').textContent,'LOSS','Second final result is shown after first');
actions['#paperResultDismiss:click']();
assert.equal(el('#paperResultOverlay').hidden,true,'Both queued result overlays can close');

console.log('PASS: folded history/watchlist, countdown, tentative quote status, final LOSS modal, 111+ virtual trades, auto-refill, net P/L integrity, persistence');
