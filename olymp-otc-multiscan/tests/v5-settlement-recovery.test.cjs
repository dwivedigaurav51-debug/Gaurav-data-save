const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/paper.js'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../app/src/main/assets/index.html'),'utf8');
assert(html.includes('id="paperSettlementHealth"'));
assert(html.includes('id="paperVoidNotice"'));
const controls={},events={},data={},notifications=[];
const t0=Math.floor(Date.now()/300000)*300000;
const clock={now:t0+31*60000};
class MockDate extends Date{
 constructor(...args){super(...(args.length?args:[clock.now]))}
 static now(){return clock.now}
}
for(let i=0;i<7;i++){
 const expiry=clock.now-30*60000-i*60000;
 (data.trades??=[]).push({
  id:'OLD-'+i,symbol:'EURUSD_OTC',name:'EUR/USD OTC',side:'UP',score:100,
  stake:200,entryPrice:1.2,sourceTs:Math.floor((expiry-300000)/1000),signalSourceTs:Math.floor((expiry-300000)/1000),
  entryFrom:expiry-300000,entryUntil:expiry-240000,openedAt:expiry-300000,
  expiresAt:expiry,status:'OPEN',exitAt:null,pnl:null
 });
}
Object.assign(data,{version:3,initial:10000,balance:8600,auto:true,autoRefill:true,refillTotal:0,
 topups:[],armed:[],skipped:[]});
const storage={envargOtcMultiPaperV3_100only:JSON.stringify(data)};
function get(sel){
 if(!controls[sel])controls[sel]={textContent:'',innerHTML:'',hidden:false,checked:true,style:{},className:'',scrollTop:0,
   addEventListener(type,cb){events[sel+':'+type]=cb}};
 return controls[sel];
}
const sandbox={Date:MockDate,console,JSON,Math,Array,Number,String,Intl,Set,Map,
 window:{MultiBridge:{notifySignal(...args){notifications.push(args)}}},
 document:{querySelector:get},
 localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v}},
 alert(){},confirm(){return true},setTimeout(){return 7},clearTimeout(){}};
vm.createContext(sandbox);
vm.runInContext(src,sandbox,{filename:'paper.js',timeout:5000});
const p=sandbox.window.PaperVirtual;
p.render();
assert.equal(p.totals().open,7,'Do not blindly VOID existing trades on reboot before first quote check');
assert.equal(p.getWallet().balance,8600);
const fixed=p.reportFeedError('EURUSD_OTC','HTTP 429',clock.now);
assert.equal(fixed.length,7,'Resolve all seven long-expired trades when quote recovery has failed');
p.render();
assert.equal(p.totals().open,0);
assert.equal(p.totals().voids,7,'Missing prices must not be declared WIN or LOSS');
assert.equal(p.totals().wins,0);
assert.equal(p.totals().losses,0);
assert.equal(p.getWallet().balance,10000,'Refund all seven ₹200 stakes once');
assert(get('#paperSettlementHealth').textContent.includes('7 VOID'));
assert(get('#paperVoidNotice').textContent.includes('7 stalled'));
assert.equal(p.reportFeedError('EURUSD_OTC','HTTP 429',clock.now).length,0,'Repeated recovery cannot refund twice');
assert.equal(p.getWallet().balance,10000);
assert.equal(notifications.length,0,'No misleading WIN or LOSS alerts from a feed timeout');

const newTrade=(symbol,side,entryTs,entryPrice)=>p.onStrong({symbol,name:symbol},{
 side,score:100,price:entryPrice,lastTs:entryTs},clock.now);
const t=Math.floor(clock.now/300000)*300;
assert.equal(newTrade('GBPJPY_OTC','UP',t,100).opened,true);
const w=p.getWallet().trades.find(t=>t.symbol==='GBPJPY_OTC');
assert(w&&w.status==='OPEN');
const expiryTs=Math.ceil(w.expiresAt/300000)*300;
clock.now=expiryTs*1000+1000;
const settle=p.onFeed('GBPJPY_OTC',[{ts:w.sourceTs,c:100},{ts:expiryTs,c:101}],clock.now);
assert.equal(settle[0].status,'WIN','Valid expiry price must still settle as WIN, not forced VOID');
assert.equal(p.totals().wins,1);
assert.equal(p.totals().voids,7);
assert.equal(p.getWallet().balance,10180);
assert.equal(get('#paperResultBig').textContent,'WIN');
assert.equal(get('#paperResultOverlay').hidden,false);
events['#paperResultDismiss:click']();
assert.equal(get('#paperResultOverlay').hidden,true);
assert(storage.envargOtcMultiPaperV3_100only,'Trade history still saved');
console.log('PASS: 7 stale trades are refunded exactly once; valid expiry WIN still works; no fake wins/losses or unexpected alerts');
