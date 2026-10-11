const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(base,'app/src/main/assets/app.js'),'utf8');
const paper=fs.readFileSync(path.join(base,'app/src/main/assets/paper.js'),'utf8');
const html=fs.readFileSync(path.join(base,'app/src/main/assets/index.html'),'utf8');
assert(html.includes('id="paperEntryStatus"'),'Latest signal must show immediately');
assert(html.includes('id="paperQuickBtn"'),'Targeted refresh button is required');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
for(const text of [app,paper])for(const [,id] of text.matchAll(/\$\('#([^']+)'\)/g)){
 assert(ids.has(id),'Undefined UI control '+id);
}
const baseMs=Math.floor(Date.now()/300000)*300000;
const clock={now:baseMs+90000};
class TestDate extends Date {
 constructor(...args){super(...(args.length?args:[clock.now]))}
 static now(){return clock.now}
}
const controls={},timers=[],calls=[],alerts=[],memory={};
function el(s){
 return controls[s]||(controls[s]={checked:true,disabled:false,value:'',textContent:'',innerHTML:'',style:{},
   classList:{toggle(){}},dataset:{},addEventListener(){}});
}
const sandbox={
 console,Date:TestDate,Math,JSON,Number,String,Array,Object,Map,Set,Intl,
 localStorage:{getItem:k=>memory[k]??null,setItem:(k,v)=>{memory[k]=v}},
 document:{querySelector:el,querySelectorAll:()=>['all','forex','crypto','strong','error'].map(tab=>({dataset:{tab},addEventListener(){},classList:{toggle(){}}}))},
 window:{MultiBridge:{
    scanAssets(csv){calls.push({at:clock.now,symbols:csv.split(',')})},
    requestNotificationPermission(){},
    notifySignal(...args){alerts.push(args)},
    notifyPaperResult(){throw Error('No result notifications in 100/100 mode')}
 }},
 setInterval(fn,ms){timers.push({fn,ms})},
 confirm(){return false},alert(){}
};
vm.createContext(sandbox);
vm.runInContext(paper,sandbox,{filename:'paper.js',timeout:5000});
vm.runInContext(app,sandbox,{filename:'app.js',timeout:5000});
function run(code){return vm.runInContext(code,sandbox,{timeout:5000})}
assert.equal(calls.length,1,'Initial market scan starts once');
assert.equal(calls[0].symbols.length,32,'Every full market scan still includes 32 assets');
run("window.nativeScanDone()");
run("STATES.GBPUSD_OTC.status='LIVE'");
const candle=Math.floor(clock.now/300000)*300-300;
run("addSignal(INDEX.EURUSD_OTC,{strong:true,side:'UP',score:100,price:1.12,lastTs:"+candle+"})");
run("PAPER.renderOpen()");
assert(el('#paperEntryStatus').textContent.includes('WAITING'),'Signal must show as waiting immediately');
assert.equal(run('PAPER.getWallet().armed.length'),1,'Closed-candle 100/100 signal gets queued');
assert.equal(run('PAPER.getWallet().trades.length'),0,'Do not pretend queued signal was actually traded');
assert.equal(run('history.length'),1,'Qualifying 100/100 signal visible in history immediately');
assert.equal(alerts.length,0,'Queued-only signal does not send false entry notification');
assert.equal(el('#paperQuickBtn').disabled,false,'Waiting symbol can be checked manually');

clock.now+=60000;
assert.equal(run('checkPendingNow(true)'),true,'Manual fast check should be available');
assert.equal(calls.length,2);
assert.equal(calls[1].symbols.join(','),'EURUSD_OTC','Only the pending paper asset should be fetched');
assert.equal(run("STATES.GBPUSD_OTC.status"),'LIVE','Other markets must not be reset or marked checking');
const nowCandle=Math.floor(clock.now/300000)*300;
const candles=Array.from({length:80},(_,i)=>({ts:nowCandle-(79-i)*300,c:1.10+i*.0001}));
const response=JSON.stringify({asset:{symbol:'EURUSD_OTC'},charts:[{candle_frame:300,candles}]});
sandbox.window.nativeAssetResult('EURUSD_OTC',response);
assert.equal(run('PAPER.getWallet().armed.length'),0,'New valid source candle fills queued virtual trade');
assert.equal(run('PAPER.getWallet().trades.length'),1);
assert.equal(run('PAPER.getWallet().trades[0].status'),'OPEN');
assert.equal(run('PAPER.getWallet().balance'),9800,'₹200 debited only when paper entry actually opens');
assert.equal(alerts.length,1,'Only confirmed 100/100 paper entry alerts');
assert.equal(alerts[0][2],'100');
assert.equal(el('#paperEntryStatus').textContent.includes('PAPER OPEN'),true);
assert.equal(run("STATES.GBPUSD_OTC.status"),'LIVE');
sandbox.window.nativeAssetError('GBPUSD_OTC','stale out-of-scan response');
assert.equal(run("STATES.GBPUSD_OTC.status"),'LIVE','Unrelated async feed error must be ignored');
run("window.nativeScanDone()");
assert.equal(run("STATES.GBPUSD_OTC.status"),'LIVE','Targeted scan cannot label other assets erroneous');
assert(el('#scanStatus').textContent.includes('Fast paper check'),'Accelerated scan is identified clearly');

const fiveSecondTimer=timers.find(t=>t.ms===5000);
assert(fiveSecondTimer,'Keep scheduled five-minute full scan');
clock.now=baseMs+313000;
fiveSecondTimer.fn();
assert.equal(calls.length,3,'Full scheduled scan still fires after targeted refresh');
assert.equal(calls[2].symbols.length,32,'Priority check cannot starve the full 32-market scan');

const rapidBefore=calls.length;
assert.equal(run('checkPendingNow(true)'),false,'Fast checks do not duplicate requests while a scan is active');
assert.equal(calls.length,rapidBefore);
assert(timers.some(t=>t.ms===10000),'Automatic fast-check scheduler is registered');
console.log('PASS: original V4 32-asset workflow, instant queued status, focused 1-asset refresh, opening after real new quote, 100-only alert, no stale-market errors, full scan survives');
