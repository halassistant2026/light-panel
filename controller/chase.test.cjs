const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chaseFrame,chaseInterval}=require('./lights.cjs');
test('chase accelerates over the full duration instead of two seconds',()=>{
 assert.equal(typeof chaseInterval,'function');
 assert.equal(chaseInterval(0),1000);
 assert.equal(chaseInterval(2),910);
 assert.equal(chaseInterval(10),550);
 assert.equal(chaseInterval(20),100);
 assert.equal(chaseInterval(30),100);
 assert.equal(chaseInterval(5,10),550);
 assert.equal(chaseInterval(10,30),550);
 assert.equal(chaseInterval(20,30),100);
 assert.equal(chaseInterval(25,30),100);
 assert.equal(chaseInterval(30,30),100);
 assert.equal(chaseInterval(-1),1000);
 let last=1001;
 for(let t=0;t<=20;t+=0.05){const ms=chaseInterval(t);assert.ok(ms<=last&&ms>=100);last=ms;}
});
test('chase lights exactly one bulb and cycles across all three',()=>{
 assert.equal(typeof chaseFrame,'function');
 for(let step=0;step<9;step++){
  const frames=[0,1,2].map(i=>chaseFrame(step,i,3));
  assert.deepEqual(frames.map(f=>f.on_off),[0,1,2].map(i=>Number(i===step%3)));
  assert.equal(frames[step%3].hue,180);
  assert.equal(frames[step%3].transition_period,0);
  assert.equal(frames[step%3].brightness,35);
  assert.equal(frames[step%3].color_temp,0);
 }
});
