const {test}=require('node:test');
const assert=require('node:assert/strict');
const {redBlueFrame}=require('./lights.cjs');
const fs=require('node:fs'),vm=require('node:vm');
test('CLI accepts red-blue, defaults to 20 seconds, schedules two-second frames and verifies restore offline',async()=>{
 let now=0;const writes=[],logs=[],timers=[];
 const original={on_off:1,mode:'normal',hue:60,saturation:50,color_temp:0,brightness:10};
 const config=[0,1,2].map(i=>({key:String(i),mac:String(i),host:String(i)}));
 const bulbs=config.map(c=>{let state={...original};return {mac:c.mac,lighting:{getLightState:async()=>({...state}),setLightState:async p=>{writes.push({at:now,key:c.key,p});state={...state,...p};delete state.transition_period;}}};});
 class Clock extends Date {static now(){return now;}}
 const fakeFs={mkdirSync(){},openSync(){return 1;},writeFileSync(){},closeSync(){},existsSync(){return false;},unlinkSync(){}};
 const sandbox={module:{exports:{}},__dirname:__dirname,Date:Clock,console:{log:x=>logs.push(x)},process:{pid:123,on(){},off(){}},setTimeout:(fn,ms)=>{timers.push(ms);now+=ms;queueMicrotask(fn);},require:name=>name==='node:fs'?fakeFs:name==='./devices.json'?config:name==='tplink-smarthome-api'?{Client:class{async getDevice({host}){return bulbs[Number(host)];}}}:require(name)};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('./lights.cjs'),'utf8'),sandbox);
 await vm.runInContext("main(['effect','red-blue'])",sandbox);
 const frames=writes.filter(x=>x.p.transition_period===2000);
 assert.equal(frames.length,30);
 assert.deepEqual([...new Set(frames.map(x=>x.at))],[0,2000,4000,6000,8000,10000,12000,14000,16000,18000]);
 assert.ok(timers.every(ms=>ms===2000));
 assert.ok(logs.some(x=>{try{const r=JSON.parse(x);return r.effect==='red-blue'&&r.restored&&r.verified;}catch{return false;}}));
 for(const b of bulbs)assert.deepEqual(await b.lighting.getLightState(),original);
});
test('red-blue sweep alternates offset red/blue with smooth moderate constant light',()=>{
 assert.equal(typeof redBlueFrame,'function');
 for(let step=0;step<10;step++)for(let i=0;i<3;i++){
  assert.deepEqual(redBlueFrame(step,i),{on_off:1,mode:'normal',hue:(step+i)%2===0?0:240,saturation:100,color_temp:0,brightness:35,transition_period:2000});
 }
});
