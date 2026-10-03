const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture({ack=350,stopAt=Infinity,signal=false}={}){
 let now=0,transition=null,stopSent=false;
 const original={on_off:1,mode:'normal',hue:60,saturation:50,color_temp:0,brightness:10};
 let state={...original};const writes=[],reads=[],logs=[],handlers={};
 const sample=()=>transition?{...state,brightness:transition.from+(transition.to-transition.from)*Math.min(1,(now-transition.start)/2000)}:{...state};
 const advance=ms=>{now+=ms;if(signal&&!stopSent&&now>=stopAt){stopSent=true;handlers.SIGTERM?.();}};
 const bulb={mac:'lamp',lighting:{getLightState:async()=>{const s=sample();reads.push({at:now,state:s,unfinished:transition&&now<transition.start+2000});return s;},setLightState:async p=>{
  const before=sample();writes.push({at:now,p:{...p}});
  state={...before,...p};delete state.transition_period;
  transition=null;
  if(p.transition_period){advance(ack);transition={start:now,from:before.brightness,to:p.brightness};}
 }}};
 class Clock extends Date{static now(){return now;}}
 const fakeFs={mkdirSync(){},openSync(){return 1;},writeFileSync(){},closeSync(){},existsSync(){return !signal&&now>=stopAt;},unlinkSync(){}};
 const sandbox={module:{exports:{}},__dirname,Date:Clock,console:{log:x=>logs.push(JSON.parse(x))},process:{pid:123,on:(name,fn)=>{handlers[name]=fn;},off:name=>{delete handlers[name];}},setTimeout:(fn,ms)=>{advance(ms);queueMicrotask(fn);},require:name=>{
  if(name==='node:fs')return fakeFs;
  if(name==='./devices.json')return [{key:'lamp',host:'fake',mac:'lamp'}];
  if(name==='tplink-smarthome-api')return {Client:class{async getDevice(){return bulb;}}};
  if(['node:path','node:os'].includes(name))return require(name);
  throw new Error('Unexpected dependency '+name);
 }};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('./lights.cjs'),'utf8'),sandbox);
 return {writes,reads,logs,original,run:async duration=>{sandbox.duration=String(duration);await vm.runInContext("main(['effect','pulse-blue',duration])",sandbox);return sample();}};
}
for(const duration of [1,3,6])test(`pulse-blue ${duration}s restores gradual transitions without premature target readback`,async()=>{
 const f=fixture();assert.deepEqual(await f.run(duration),f.original);
 assert.ok(f.logs.some(x=>x.effect==='pulse-blue'&&x.restored&&x.verified));
 assert.ok(f.reads.every(r=>!r.unfinished),'target reads require a completed transition');
 const frames=f.writes.filter(w=>w.p.transition_period===2000);
 assert.equal(frames.length,Math.ceil(duration/2));
 assert.equal(f.writes.at(-1).at,duration*1000,'restore at duration boundary, not after clipped fade');
 const phases=f.logs.filter(x=>x.phase!==undefined);
 assert.equal(phases.length,duration===1?0:duration===3?1:2);
});
for(const signal of [false,true])for(const stopAt of [1000,2050])test(`pulse-blue skips intermediate assertion at ${signal?'signal':'stop-file'} boundary ${stopAt}ms`,async()=>{
 const f=fixture({stopAt,signal});assert.deepEqual(await f.run(6),f.original);
 assert.equal(f.logs.filter(x=>x.phase!==undefined).length,0);
 assert.ok(f.reads.every(r=>!r.unfinished));
 assert.equal(f.writes.filter(w=>w.p.transition_period===2000).length,1);
 assert.ok(f.logs.some(x=>x.effect==='pulse-blue'&&x.restored&&x.verified));
});
