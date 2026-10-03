const test=require('node:test'),a=require('node:assert/strict');
const api=require('./lights.cjs');
test('pride duet has coordinated palettes and safe fades',()=>{
 a.equal(typeof api.prideFrame,'function');
 const frames=Array.from({length:20},(_,step)=>[api.prideFrame(step,0),api.prideFrame(step,1)]);
 a.equal(frames[0][0].hue,0);a.equal(frames[0][1].hue,120);
 a.ok(frames.slice(6,12).flat().some(s=>s.saturation===0));
 a.ok(frames[19].every(s=>s.brightness>=50));
 for(const s of frames.flat()){a.equal(s.on_off,1);a.ok(s.brightness>=1&&s.brightness<=70);a.ok(s.transition_period>=650);a.ok(s.hue>=0&&s.hue<360);}
});
