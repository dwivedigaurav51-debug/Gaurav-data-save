const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/paper.js'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/index.html'),'utf8');
const controls={};
const actions={};
function $(selector){
 if(!controls[selector]){
  controls[selector]={checked:true,textContent:'',innerHTML:'',className:'',style:{},
    addEventListener(type,fn){actions[selector+':'+type]=fn}};
 }
 return controls[selector];
}
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
for(const [,id] of src.matchAll(/\$\('#([^']+)'\)/g))assert(ids.has(id),'Missing paper control '+id);
const storage={};const notifications=[];
const clock={now:Math.floor(Date.now()/300000)*300000+15000};
class ClockDate extends Date{
 constructor(...args){super(...(args.length?args:[clock.now]))}
 static now(){return clock.now}
}
const sandbox={
 console,Date:ClockDate,Math,JSON,Number,String,Array,Map,Set,Intl,
 window:{MultiBridge:{notifySignal(...a){notifications.push(a)},notifyPaperResult(){throw Error('WIN/LOSS notification forbidden')}}},
 document:{querySelector:$},
 localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v}},
 alert(){},confirm(){return true}
};
vm.createContext(sandbox);vm.runInContext(src,sandbox,{filename:'paper.js',timeout:5000});
const get=()=>sandbox.window.PaperVirtual;
const asset=symbol=>({symbol,name:symbol.replace('_OTC',' OTC')});
let t0=Math.floor(clock.now/300000)*300;
let item={side:'UP',score:100,price:100,lastTs:t0};
let rejected=get().onStrong(asset('LTCUSD_OTC'),{side:'UP',score:99,price:100,lastTs:t0});
assert.equal(rejected.opened,false,'99/100 must never open a trade');
assert.equal(get().getWallet().balance,10000);
let first=get().onStrong(asset('EURUSD_OTC'),item);
assert.equal(first.opened,true,'Fresh strong signal starts virtual entry');
assert(first.entryUntil>first.entryFrom,'Entry window displays start/end');
assert.equal(first.expiryAt-first.entryFrom,300000,'Five-minute expiry');
assert.equal(get().getWallet().balance,9800,'₹200 deducted on entry');
assert.equal(get().getWallet().trades.length,1);
assert.equal(get().onStrong(asset('EURUSD_OTC'),item).opened,false,'No duplicate concurrent trade');
assert.equal(get().getWallet().balance,9800,'Duplicate does not double-charge');

clock.now=(t0+601)*1000;
const prices1=[{ts:t0,c:100},{ts:t0+300,c:100.1},{ts:t0+600,c:101}];
let outcomes=get().onFeed('EURUSD_OTC',prices1,clock.now,true);
assert.equal(outcomes.length,1,'Future eligible source price settles trade');
assert.equal(outcomes[0].status,'WIN');
assert.equal(outcomes[0].pnl,180,'90% illustration gives ₹180 on ₹200');
assert.equal(get().getWallet().balance,10180);
assert.equal(get().onFeed('EURUSD_OTC',prices1,clock.now,true).length,0,'No repeated WIN');
assert.equal(notifications.length,0,'WIN/LOSS notification suppressed; 100/100 entry only');

item={side:'DOWN',score:100,price:100,lastTs:t0+600};
assert.equal(get().onStrong(asset('GBPJPY_OTC'),item).opened,true);
clock.now=(t0+1201)*1000;
let outcomes2=get().onFeed('GBPJPY_OTC',[{ts:t0+600,c:100},{ts:t0+900,c:100.01},{ts:t0+1200,c:101}],clock.now,true);
assert.equal(outcomes2.length,1);
assert.equal(outcomes2[0].status,'LOSS');
assert.equal(outcomes2[0].pnl,-200);
assert(outcomes2[0].diagnostic.includes('against DOWN'));
assert.equal(get().getWallet().balance,9980,'After one WIN and one LOSS net -₹20');
assert.equal(get().totals().wins,1);
assert.equal(get().totals().losses,1);
assert.equal(get().totals().accuracy,50);

item={side:'UP',score:100,price:100,lastTs:t0+1200};
assert.equal(get().onStrong(asset('BTCUSD_OTC'),item).opened,true);
clock.now=(t0+1801)*1000;
const draw=get().onFeed('BTCUSD_OTC',[{ts:t0+1200,c:100},{ts:t0+1800,c:100}],clock.now,true);
assert.equal(draw[0].status,'DRAW');
assert.equal(draw[0].pnl,0);
assert.equal(get().getWallet().balance,9980);
assert.equal(get().totals().accuracy,50,'Draw excluded from accuracy');
assert.equal(notifications.length,0,'DRAW/WIN do not trigger extra notifications');

item={side:'DOWN',score:100,price:100,lastTs:t0+1800};
assert.equal(get().onStrong(asset('PEPEUSD_OTC'),item).opened,true);
clock.now=(t0+2701)*1000;
const missing=get().onFeed('PEPEUSD_OTC',[{ts:t0+1800,c:100},{ts:t0+2700,c:102}],clock.now,true);
assert.equal(missing[0].status,'VOID','Missing expiry quote must not be counted as LOSS');
assert.equal(missing[0].pnl,0);
assert.equal(get().getWallet().balance,9980,'VOID must refund stake');
assert.equal(get().totals().wins,1);
assert.equal(get().totals().losses,1);

// Reproduce the bug: a 100/100 closed candle can be 5m old at scan time.
// Do not drop it. Wait for next newer source price, then start a NEW virtual trade.
const queued=get().onStrong(asset('USDJPY_OTC'),{side:'UP',score:100,price:100,lastTs:t0+2400});
assert.equal(queued.status,'WAITING_ENTRY','Five-minute-old closed candle must queue instead of silently disappearing');
assert.equal(queued.opened,false);
assert.equal(get().getWallet().armed.length,1);
assert.equal(get().getWallet().balance,9980,'Queued signal does not debit wallet before entry');
get().render();
assert($('#paperArmedList').innerHTML.includes('WAITING ENTRY'));
clock.now=(t0+3001)*1000;
const opened=get().onQuote('USDJPY_OTC',[{ts:t0+2700,c:100.5}],clock.now,true);
assert.equal(opened.length,1,'A new source candle must activate queued 100/100 virtual trade');
assert.equal(opened[0].opened,true);
assert.equal(opened[0].expiryAt-opened[0].entryFrom,300000);
assert.equal(get().getWallet().balance,9780);
assert.equal(get().getWallet().armed.length,0);
assert.equal(notifications.length,1,'Only queued 100/100 trade entry sends notification');
assert.equal(notifications[0][2],'100');
clock.now=(t0+3601)*1000;
const delayedWin=get().onFeed('USDJPY_OTC',[{ts:t0+2700,c:100.5},{ts:t0+3600,c:101}],clock.now,true);
assert.equal(delayedWin[0].status,'WIN');
assert.equal(get().getWallet().balance,10160);
assert.equal(notifications.length,1,'Virtual WIN must not notify; entry only');

const old=get().onStrong(asset('NZDUSD_OTC'),{side:'UP',score:100,price:100,lastTs:t0+2700});
assert.equal(old.opened,false,'Extremely old source candle must not create a backdated trade');
assert(old.reason.includes('EXPIRED'),'Expired source signal explains why it was skipped');
get().render();
assert.equal($('#paperWins').textContent,2);
assert.equal($('#paperLosses').textContent,1);
assert.equal($('#paperAccuracy').textContent,'66.7%');
assert($('#paperHistory').innerHTML.includes('LOSS'));
assert($('#paperHistory').innerHTML.includes('Entry / Buy From'));
assert($('#paperHistory').innerHTML.includes('Expiry target'));
assert($('#paperByAsset').innerHTML.includes('EURUSD OTC'));
assert.equal($('#paperOpenCount').textContent,0);
assert(storage.envargOtcMultiPaperV3_100only,'V3 100/100 wallet persists independently');
const saved=JSON.parse(storage.envargOtcMultiPaperV3_100only);
assert.equal(saved.balance,10160);
assert.equal(saved.trades.length,5,'WIN LOSS DRAW VOID and delayed-entry WIN kept');

vm.runInContext(src,sandbox,{filename:'paper-reload.js',timeout:5000});
assert.equal(get().getWallet().balance,10160,'Separate 100/100 wallet survives reload');
assert.equal(get().totals().wins,2,'Completed WIN survives reload');
console.log('PASS: 100/100-only paper entries, closed-candle waiting queue, delayed entry, expiry WIN/LOSS/DRAW/VOID, no result alerts, persistence');
