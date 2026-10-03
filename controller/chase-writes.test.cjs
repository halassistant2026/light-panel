const {test}=require('node:test');
const assert=require('node:assert/strict');
const {writeChaseStep}=require('./lights.cjs');
test('chase writes only, initializes others off, then writes outgoing and incoming',async()=>{
 assert.equal(typeof writeChaseStep,'function');
 const calls=[];
 const bulbs=[0,1,2].map(i=>({lighting:{async getLightState(){throw Error('No reads in chase');},async setLightState(s){calls.push([i,s.on_off]);}}}));
 await writeChaseStep(bulbs,0);
 assert.deepEqual(calls,[[1,0],[2,0],[0,1]]);
 calls.length=0;
 await writeChaseStep(bulbs,1);
 assert.deepEqual(calls,[[0,0],[1,1]]);
 calls.length=0;
 await writeChaseStep(bulbs,3);
 assert.deepEqual(calls,[[2,0],[0,1]]);
});
test('failed off write stops chase before next on',async()=>{
 assert.equal(typeof writeChaseStep,'function');
 let turnedOn=false;
 const bulbs=[{lighting:{async setLightState(){throw Error('offline');}}},{lighting:{async setLightState(){turnedOn=true;}}}];
 await assert.rejects(writeChaseStep(bulbs,1),/offline/);
 assert.equal(turnedOn,false);
});
