const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(base,'app/src/main/assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(base,'app/src/main/assets/index.html'),'utf8');
const java=fs.readFileSync(path.join(base,'app/src/main/java/com/envarg/otcmultiscan/MainActivity.java'),'utf8');
const manifest=fs.readFileSync(path.join(base,'app/src/main/AndroidManifest.xml'),'utf8');
const gradle=fs.readFileSync(path.join(base,'app/build.gradle'),'utf8');
const uiIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const selectors=[...script.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)].map(m=>m[1]);
for(const id of selectors)assert(uiIds.has(id),'Missing HTML element '+id);
assert(gradle.includes('applicationId "com.envarg.otcmultiscan"'));
assert(manifest.includes('Envarg OTC Multi Scanner'));
assert(script.includes('EURUSD_OTC')||script.includes("EURUSD'"));
assert(java.includes('PEPEUSD_OTC')&&java.includes('DOGUSD_OTC'));
const controls={};const alerts=[],intervals=[];
const storage={};
function el(id){
 if(!controls[id]){
  controls[id]={id,value:'',checked:true,disabled:false,textContent:'',innerHTML:'',className:'',style:{},
   dataset:{tab:'all'},addEventListener(){},classList:{toggle(){}}
  };
 }
 return controls[id];
}
const tabs=['all','forex','crypto','strong','error'].map(id=>({
  dataset:{tab:id},addEventListener(){},classList:{toggle(){}}
}));
const fakeDocument={querySelector:el,querySelectorAll:()=>tabs};
const bridge={
 scanAssets(csv){bridge.last=csv;bridge.scans=(bridge.scans||0)+1},
 requestNotificationPermission(){},
 notifySignal(...args){alerts.push(args)}
};
const sandbox={window:{MultiBridge:bridge},document:fakeDocument,
 localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v}},
 setInterval:(fn,ms)=>{intervals.push({fn,ms})},
 confirm:()=>true,console,Date,Math,JSON,Number,String,Array,Set,Map,Intl};
vm.createContext(sandbox);
vm.runInContext(script,sandbox,{filename:'app.js',timeout:5000});
const query=src=>vm.runInContext(src,sandbox,{timeout:5000});
assert.equal(bridge.scans,1,'Scanner starts on app launch');
assert.equal(bridge.last.split(',').length,32,'All 32 assets scanned');
assert.equal(query('ASSETS.length'),32);
const javaSymbols=[...java.matchAll(/"([A-Z]{6,7}_OTC)"/g)].map(m=>m[1]);
for(const symbol of query('ASSETS.map(a=>a.symbol)'))assert(javaSymbols.includes(symbol),'Missing native whitelist '+symbol);
const now=Math.floor(Date.now()/300000)*300;
function validPoints(n=80,spacing=300,oldAge=0){
 return Array.from({length:n},(_,i)=>({
  ts:now-(n-1-i)*spacing-oldAge,
  c:1.1+0.001*Math.sin(i*.7)+i*0.00001
 }));
}
const payload=(symbol,candles,frame=300)=>JSON.stringify({asset:{symbol},charts:[{candle_frame:frame,candles}]});
sandbox.window.nativeAssetResult('EURUSD_OTC',payload('EURUSD_OTC',validPoints()));
assert.equal(query('STATES.EURUSD_OTC.status'),'LIVE','Fresh asset accepted');
assert.equal(query('STATES.EURUSD_OTC.dataCount'),80);
sandbox.window.nativeAssetResult('GBPUSD_OTC',payload('USDJPY_OTC',validPoints()));
assert.equal(query('STATES.GBPUSD_OTC.status'),'ERROR','Mismatched asset rejected');
sandbox.window.nativeAssetResult('AUDUSD_OTC',payload('AUDUSD_OTC',validPoints(80,60)));
assert.equal(query('STATES.AUDUSD_OTC.status'),'ERROR','Wrong time frame rejected');
sandbox.window.nativeAssetResult('USDJPY_OTC',payload('USDJPY_OTC',validPoints(80,300,3600)));
assert.equal(query('STATES.USDJPY_OTC.status'),'ERROR','Stale source rejected');
sandbox.window.nativeAssetResult('EURGBP_OTC',payload('EURGBP_OTC',validPoints(20)));
assert.equal(query('STATES.EURGBP_OTC.status'),'WARMUP','Not enough candles shown honestly');
sandbox.window.nativeAssetError('PEPEUSD_OTC','HTTP 429');
assert.equal(query('STATES.PEPEUSD_OTC.status'),'ERROR','HTTP failure shown');
sandbox.window.nativeScanDone();
assert.equal(query('inFlight'),false);
assert.equal(query('STATES.ETHUSD_OTC.status'),'ERROR','Unanswered assets become error');
query("addSignal(INDEX.EURUSD_OTC,{side:'UP',score:85,lastTs:STATES.EURUSD_OTC.lastTs,price:1.24})");
query("addSignal(INDEX.EURUSD_OTC,{side:'UP',score:85,lastTs:STATES.EURUSD_OTC.lastTs,price:1.24})");
assert.equal(alerts.length,1,'Alert de-duplicated per asset candle');
assert.equal(query('history.length'),1,'History avoids duplicate');
assert(query("$('#assetList').innerHTML.includes('EUR/USD OTC')"));
assert(query("$('#scanStatus').textContent.includes('Last scan complete')"));
console.log('PASS: standalone package, 32 native symbol matches, 5m feed, stale/timeframe/symbol rejection, history/alerts and UI');
