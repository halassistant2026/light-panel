const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./lights.cjs'),'utf8');
function fixture(snapshot){
 const config=['light','lamp','lamp2'].map((key,i)=>({key,mac:`00:00:00:00:00:0${i+1}`,host:`192.0.2.${i+1}`}));
 const original={on_off:1,mode:'normal',hue:60,saturation:50,color_temp:0,brightness:10};
 const states=config.map(()=>({...original})),access=[],writes=[],logs=[];
 const fakeFs={readFileSync(){return JSON.stringify(snapshot);},mkdirSync(){},openSync(){return 1;},writeFileSync(){},closeSync(){},existsSync(){return false;},unlinkSync(){}};
 const sandbox={module:{exports:{}},__dirname,console:{log:x=>logs.push(x)},process:{pid:123,on(){},off(){}},setTimeout:fn=>queueMicrotask(fn),require:name=>{
  if(name==='node:fs')return fakeFs;
  if(name==='./devices.json'){access.push('config');return config;}
  if(name==='tplink-smarthome-api'){
   access.push('network module');
   return {Client:class{constructor(){access.push('client');}async getDevice({host}){
    access.push(host);const i=config.findIndex(c=>c.host===host);assert.notEqual(i,-1,'only configured hosts');
    return {mac:config[i].mac,lighting:{getLightState:async()=>({...states[i]}),setLightState:async p=>{
     writes.push({host,p});const next={...(states[i].dft_on_state??states[i]),...p};delete next.transition_period;delete next.dft_on_state;
     const on=next.on_off;delete next.on_off;states[i]=on?{on_off:1,...next}:{on_off:0,dft_on_state:next};
    }}};
   }}};
  }
  if(['node:path','node:os'].includes(name))return require(name);
  throw new Error('Unexpected dependency '+name);
 }};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {config,states,original,access,writes,logs,run:args=>{sandbox.args=args;return vm.runInContext('main(args)',sandbox);}};
}
test('CLI restores a pulse-blue lamp-only snapshot without touching other bulbs',async()=>{
 const saved={on_off:0,dft_on_state:{mode:'normal',hue:200,saturation:65,color_temp:0,brightness:20}};
 const f=fixture({devices:[{mac:'00:00:00:00:00:02',host:'203.0.113.99',state:saved}]});
 await f.run(['restore','saved.json']);
 assert.deepEqual(f.access,['config','network module','client','192.0.2.2']);
 assert.deepEqual(f.states,[f.original,saved,f.original]);
 assert.deepEqual(f.writes.map(w=>w.host),['192.0.2.2','192.0.2.2']);
 assert.ok(f.logs.some(x=>{const r=JSON.parse(x);return r.restored===true&&r.verified===true;}));
});
test('CLI preserves snapshot order for reordered subsets and full-group restoration',async()=>{
 for(const identities of [[3,1],[3,2,1]]){
  const devices=identities.map(i=>({mac:`00:00:00:00:00:0${i}`,host:'203.0.113.99',state:{on_off:1,mode:'normal',hue:i*30,saturation:80,color_temp:0,brightness:i*20}}));
  const f=fixture({devices});await f.run(['restore','saved.json']);
  assert.deepEqual(f.access.slice(3),identities.map(i=>`192.0.2.${i}`));
  assert.deepEqual(f.writes.map(w=>w.host),identities.map(i=>`192.0.2.${i}`));
  for(let i=0;i<3;i++)assert.deepEqual(f.states[i],devices.find(d=>d.mac===f.config[i].mac)?.state??f.original);
  assert.deepEqual(JSON.parse(f.logs[0]).map(d=>d.key),identities.map(i=>f.config[i-1].key));
 }
});
test('CLI rejects invalid snapshot identities before network and leaves every bulb untouched',async()=>{
 const state={on_off:1,mode:'normal',hue:200,saturation:65,color_temp:0,brightness:20};
 const known={mac:'00:00:00:00:00:02',state};
 for(const devices of [[],[known,known],[known,{mac:'00:00:00:00:00:99',state}],[{mac:'',state}],[{state}],[null],[{mac:2,state}],undefined]){
  const f=fixture({devices});await assert.rejects(f.run(['restore','saved.json']),/Invalid snapshot identity/);
  assert.deepEqual(f.access,['config']);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.states,[f.original,f.original,f.original]);
 }
 const f=fixture({devices:[known]});f.config.push({...f.config[1],host:'192.0.2.99'});
 await assert.rejects(f.run(['restore','saved.json']),/Invalid snapshot identity/);
 assert.deepEqual(f.access,['config']);assert.deepEqual(f.writes,[]);
});
test('CLI rejects every malformed saved state before loading devices or writing',async()=>{
 const valid={on_off:1,mode:'normal',hue:200,saturation:65,color_temp:0,brightness:20};
 const bad=[{...valid,brightness:0},undefined,null,[],{},0,'state'];
 for(const field of ['mode','hue','saturation','color_temp','brightness']){
  const missing={...valid};delete missing[field];bad.push(missing);
  for(const value of [null,true,'20',1.5,{},[]])bad.push({...valid,[field]:value});
 }
 for(const [field,values] of Object.entries({mode:['other',0],hue:[-1,360],saturation:[-1,101],brightness:[0,101],color_temp:[-1,1,2499,6501]}))
  for(const value of values)bad.push({...valid,[field]:value});
 const invalid=[...bad,...bad.map(dft_on_state=>({on_off:0,dft_on_state})),...[-1,2,1.5,true,false,'1',null,undefined].map(on_off=>({...valid,on_off}))];
 for(const state of invalid){
  // A valid earlier entry must not cause device access before a later invalid entry.
  const f=fixture({devices:[{mac:'00:00:00:00:00:01',state:valid},{mac:'00:00:00:00:00:02',state}]});
  await assert.rejects(f.run(['restore','saved.json']),/Invalid saved light state/);
  assert.deepEqual(f.access,['config']);assert.deepEqual(f.writes,[]);
 }
});
test('CLI preserves valid saved-state range boundaries, off defaults and optional err_code',async()=>{
 for(const on_off of [0,1])for(const color_temp of [0,2500,6500])for(const high of [false,true]){
  const settings={mode:'normal',hue:high?359:0,saturation:high?100:0,color_temp,brightness:high?100:1};
  const saved=on_off?{on_off,...settings}:{on_off,dft_on_state:settings};
  const f=fixture({devices:[{mac:'00:00:00:00:00:02',state:{...saved,err_code:0}}]});
  await f.run(['restore','saved.json']);assert.deepEqual(f.states[1],saved);
 }
});
test('CLI rejects enroll before device config or network access and omits it from help',async()=>{
 const f=fixture();
 await assert.rejects(f.run(['enroll','new','192.0.2.99','New lamp']),/Invalid command/);
 assert.deepEqual(f.access,[]);assert.deepEqual(f.writes,[]);
 await f.run(['help']);assert.doesNotMatch(f.logs.join('\n'),/enroll/);
});
