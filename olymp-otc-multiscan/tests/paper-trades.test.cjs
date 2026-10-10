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
 window:{MultiBridge:{notifyPaperResult(...a){notifications.push(a)}}},
 document:{querySelector:$},
 localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v}},
 alert(){},confirm(){return true}
};
vm.createContext(sandbox);vm.runInContext(src,sandbox,{filename:'paper.js',timeout:5000});
const get=()=>sandbox.window.PaperVirtual;
const asset=symbol=>({symbol,name:symbol.replace('_OTC',' OTC')});
let t0=Math.floor(clock.now/300000)*300;
let item={side:'UP',score:92,price:100,lastTs:t0};
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
assert.equal(notifications.length,1,'Only one WIN notification');

item={side:'DOWN',score:88,price:100,lastTs:t0+600};
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

item={side:'UP',score:90,price:100,lastTs:t0+1200};
assert.equal(get().onStrong(asset('BTCUSD_OTC'),item).opened,true);
clock.now=(t0+1801)*1000;
const draw=get().onFeed('BTCUSD_OTC',[{ts:t0+1200,c:100},{ts:t0+1800,c:100}],clock.now,true);
assert.equal(draw[0].status,'DRAW');
assert.equal(draw[0].pnl,0);
assert.equal(get().getWallet().balance,9980);
assert.equal(get().totals().accuracy,50,'Draw excluded from accuracy');
assert.equal(notifications.length,2,'Draw not mislabeled as a WIN');

item={side:'DOWN',score:91,price:100,lastTs:t0+1800};
assert.equal(get().onStrong(asset('PEPEUSD_OTC'),item).opened,true);
clock.now=(t0+2701)*1000;
const missing=get().onFeed('PEPEUSD_OTC',[{ts:t0+1800,c:100},{ts:t0+2700,c:102}],clock.now,true);
assert.equal(missing[0].status,'VOID','Missing expiry quote must not be counted as LOSS');
assert.equal(missing[0].pnl,0);
assert.equal(get().getWallet().balance,9980,'VOID must refund stake');
assert.equal(get().totals().wins,1);
assert.equal(get().totals().losses,1);

const old=get().onStrong(asset('USDJPY_OTC'),{side:'UP',score:98,price:100,lastTs:t0+2400});
assert.equal(old.opened,false,'Old 5m candle must not create retroactive paper trade');
assert(old.reason.includes('ENTRY CLOSED'),'Skipped reason tells user why');
assert.equal(get().getWallet().balance,9980);

get().render();
assert.equal($('#paperWins').textContent,1);
assert.equal($('#paperLosses').textContent,1);
assert.equal($('#paperAccuracy').textContent,'50.0%');
assert($('#paperHistory').innerHTML.includes('LOSS'));
assert($('#paperHistory').innerHTML.includes('Entry / Buy From'));
assert($('#paperHistory').innerHTML.includes('Expiry target'));
assert($('#paperByAsset').innerHTML.includes('EURUSD OTC'));
assert.equal($('#paperOpenCount').textContent,0);
assert(storage.envargOtcMultiPaperV2,'Wallet persists independently');
const saved=JSON.parse(storage.envargOtcMultiPaperV2);
assert.equal(saved.balance,9980);
assert.equal(saved.trades.length,4,'WIN LOSS DRAW VOID all kept');

vm.runInContext(src,sandbox,{filename:'paper-reload.js',timeout:5000});
assert.equal(get().getWallet().balance,9980,'Separate virtual wallet survives reload');
assert.equal(get().totals().wins,1,'Completed WIN survives reload');
console.log('PASS: strong signals auto-open, ₹200 stake, entry window, 5m expiry, WIN/LOSS/DRAW/VOID, skip stale, no double settlement, persistence and per-asset report');
