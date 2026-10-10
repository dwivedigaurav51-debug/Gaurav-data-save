const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'app/src/main/assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'),'utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
for(const m of js.matchAll(/\$\('#([^']+)'\)/g))assert(ids.has(m[1]),'Missing UI element: '+m[1]);
const elements={};
const get=(selector)=>{
 if(!elements[selector]){
  const el={value:selector==='#threshold'?'78':selector==='#cooldown'?'1':'100',checked:true,
    clientWidth:320,clientHeight:180,textContent:'',innerHTML:'',style:{},
    addEventListener(){},
    getContext(){return {scale(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}};
  elements[selector]=el;
 }
 return elements[selector];
};
const storage={};
const context=vm.createContext({
 console,Math,Date,JSON,Number,String,Array,Object,Set,Map,Intl,
 setInterval(){return 0},confirm(){return false},alert(){},
 navigator:{vibrate(){}},
 localStorage:{getItem(k){return storage[k]??null},setItem(k,v){storage[k]=v}},
 document:{querySelector:get},
 window:{devicePixelRatio:1,addEventListener(){},
   AndroidBridge:{fetchShib(){return JSON.stringify({_bridgeError:'test feed unavailable'})},
     fetchOtc(){return JSON.stringify({_bridgeError:'test feed unavailable'})},
     requestAlertsPermission(){},notifyEvent(){}}}
});
vm.runInContext(js,context,{filename:'app.js',timeout:5000});
const run=(source)=>vm.runInContext(source,context,{timeout:5000});
assert.equal(run("entrySafetyBlocks('DOWN',{emaTrend:'bear',macd:'neg',R:49,st:0,volPct:0.2},4,4.4,3.6).length"),0,'Aligned downtrend should not be blocked solely by stochastic=0');
assert(run("entrySafetyBlocks('DOWN',{emaTrend:'bull',macd:'neg',R:49,st:0,volPct:0.2},4,4.4,3.6).length")>0,'Bullish EMA should block risky DOWN');
assert(run("entrySafetyBlocks('UP',{emaTrend:'bull',macd:'neg',R:68,st:100,volPct:0.9},4,4.4,3.6).length")>0,'Yesterday risk setup remains blocked');
run("state.points=Array.from({length:75},(_,i)=>({ts:Math.floor(Date.now()/300000)*300-(74-i)*300,c:4+0.04*Math.sin(i/4)+i*0.0005}));state.price=state.points.at(-1).c;state.lastSourceTs=state.points.at(-1).ts;state.feedOk=true;");
run('evaluateOnNewPoint()');
assert.equal(run('getSignalAudit().scans'),1,'First candle should count once');
run('evaluateOnNewPoint()');
assert.equal(run('getSignalAudit().scans'),1,'Repeated checks of same candle must not inflate count');
run("state.points.push({ts:state.lastSourceTs+300,c:state.price+0.01});state.lastSourceTs+=300;state.price+=0.01;evaluateOnNewPoint()");
assert.equal(run('getSignalAudit().scans'),2,'A new candle should increment scan count');
run('render()');
assert(get('#dailyAudit').textContent.includes('2 checked'),'Daily audit should be visible');
assert.equal(get('#assetSelect').value,'SHIBUSD_OTC','Default source should remain SHIB');
console.log('PASS: UI selectors, protective filters, one-scan-per-candle audit and render smoke test');
