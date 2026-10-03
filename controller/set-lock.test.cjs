const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('failed group set retains lock until every pending write settles',async()=>{
 for(const rejectPending of [false,true]){
  let locked=false,release,finished=false,reads=0;
  const failure=new Error('first write failed'),later=new Error('later write failed');
  const config=['light','lamp'].map((key,i)=>({key,host:String(i),mac:String(i)}));
  const fakeFs={mkdirSync(){},openSync(){assert.equal(locked,false);locked=true;return 1;},writeFileSync(){},closeSync(){},unlinkSync(){locked=false;}};
  const sandbox={module:{exports:{}},__dirname,console:{log(){}},process:{pid:123},setTimeout:fn=>queueMicrotask(fn),require:name=>{
   if(name==='node:fs')return fakeFs;
   if(name==='./devices.json')return config;
   if(name==='tplink-smarthome-api')return {Client:class{async getDevice({host}){return {mac:host,lighting:{
    getLightState:async()=>{reads++;return {};},
    setLightState:()=>host==='0'?Promise.reject(failure):new Promise((resolve,reject)=>{release=()=>rejectPending?reject(later):resolve();})
   }};}}};
   if(['node:path','node:os'].includes(name))return require(name);
   throw new Error('Unexpected dependency '+name);
  }};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('./lights.cjs'),'utf8'),sandbox);
  const result=vm.runInContext('main(["set","all","{\\"brightness\\":20}"])',sandbox).then(()=>{finished=true;return null;},error=>{finished=true;return error;});
  await new Promise(resolve=>setImmediate(resolve));
  try{assert.equal(typeof release,'function');assert.equal(finished,false,'group command must remain pending');assert.equal(locked,true,'pending write must retain lock');}
  finally{release();}
  assert.equal(await result,failure);assert.equal(locked,false);assert.equal(reads,0);
 }
});
