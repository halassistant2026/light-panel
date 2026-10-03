const test=require('node:test');
test('CLI advertises supported commands without accessing lights',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,[require.resolve('./lights.cjs'),'help'],{encoding:'utf8'});
 assert.equal(result.status,0);assert.match(result.stdout,/status.*set.*snapshot.*restore.*effect.*discover/s);
});
test('invalid commands are rejected before network access',()=>{
 const {spawnSync}=require('node:child_process');
 for(const args of [['set','all','{"brightness":101}'],['effect','strobe','20'],['effect','rainbow','NaN'],['set','unknown','{"on_off":0}']]){
  const result=spawnSync(process.execPath,[require.resolve('./lights.cjs'),...args],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Invalid/);
 }
});
test('temporary changes restore every bulb even when the effect fails',async()=>{
 assert.equal(typeof api.temporary,'function');
 const start=[{on_off:0,dft_on_state:{mode:'normal',hue:0,saturation:0,color_temp:5000,brightness:100}},{on_off:1,mode:'normal',hue:0,saturation:0,color_temp:5000,brightness:1}];
 const bulbs=start.map(original=>{let state=structuredClone(original);return {lighting:{getLightState:async()=>structuredClone(state),setLightState:async p=>{const s={...api.settings(state),...p};delete s.transition_period;const on=s.on_off;delete s.on_off;state=on?{...s,on_off:1}:{on_off:0,dft_on_state:s};}}};});
 let persisted=false;
 await assert.rejects(api.temporary(bulbs,async()=>{assert.ok(persisted);await Promise.all(bulbs.map(b=>b.lighting.setLightState({on_off:1,hue:180,brightness:35})));throw new Error('simulated failure');},async states=>{assert.deepEqual(states,start);persisted=true;}),/simulated failure/);
 assert.deepEqual(await Promise.all(bulbs.map(b=>b.lighting.getLightState())),start);
});
const assert=require('node:assert/strict');
let api; try {api=require('./lights.cjs');} catch(e) {if(e.code!=='MODULE_NOT_FOUND')throw e;api={};}
test('off-state settings survive restoration payload construction',()=>{
 assert.equal(typeof api.restorePayload,'function');
 const state={on_off:0,dft_on_state:{mode:'normal',hue:0,saturation:0,color_temp:5000,brightness:100},err_code:0};
 assert.deepEqual(api.restorePayload(state),{on_off:1,mode:'normal',hue:0,saturation:0,color_temp:5000,brightness:100,transition_period:0});
});
