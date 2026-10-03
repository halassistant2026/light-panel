const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
async function fixture(t, options={}) {
 assert.ok(fs.existsSync(path.join(root,'server.cjs')), 'HTTP server exists');
 const {createPanel}=require('../server.cjs');
 const app=createPanel(options);
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{app.server.close(r);app.server.closeAllConnections();}));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 return {...app,base,get:p=>fetch(base+p),post:async(p,body,headers={})=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-CSRF-Token':(await (await fetch(base+'/api/bootstrap')).json()).token,...headers},body:JSON.stringify(body)})};
}
test('loopback HTTP exposes catalogue bootstrap, instance token, idle state and health',async t=>{
 const a=await fixture(t); const b=await fixture(t);
 const first=await (await a.get('/api/bootstrap')).json();
 assert.deepEqual(first.patterns,require('../patterns.json'));
 assert.match(first.token,/^[a-f0-9]{64}$/);
 assert.notEqual(first.token,(await (await b.get('/api/bootstrap')).json()).token);
 assert.equal((await (await a.get('/api/status')).json()).phase,'idle');
 assert.equal((await (await a.get('/api/health')).json()).ok,true);
 assert.equal((await a.get('/not-a-file')).status,404);
});
test('HTTP boundary rejects untrusted requests and never exposes arbitrary paths',async t=>{
 const a=await fixture(t);
 assert.equal((await a.get('/api/bootstrap')).headers.get('access-control-allow-origin'),null);
 assert.equal(await new Promise((resolve,reject)=>require('node:http').get(a.base+'/api/bootstrap',{headers:{Host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject)),403);
 assert.equal((await a.post('/api/run',{id:'L01'},{Origin:'https://evil.test'})).status,403);
 assert.equal((await a.post('/api/run',{id:'L01'},{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await a.post('/api/run',{id:'L01'},{Origin:'null'})).status,403);
 assert.equal((await a.post('/api/run',{id:'L01'},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await fetch(a.base+'/api/run',{method:'POST'})).status,403);
 for(const p of ['/server.cjs','/patterns.json','/../server.cjs','/%2e%2e/server.cjs']) assert.equal((await a.get(p)).status,404);
 assert.equal((await a.get('/api/health')).headers.get('x-content-type-options'),'nosniff');
});
function fakeRunner(){
 const calls=[];
 const spawn=(file,args,options)=>{
  const child=new (require('node:events').EventEmitter)();
  child.stdout=new (require('node:stream').PassThrough)();child.stderr=new (require('node:stream').PassThrough)();
  child.report=x=>child.stdout.write(JSON.stringify(x,null,2)+'\n');
  calls.push({file,args,options,child}); return child;
 }; return {spawn,calls};
}
test('run reserves a single child and reports restored only after verified output plus exit',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 const r=await a.post('/api/run',{id:'L05',duration:'default'});
 assert.equal(r.status,202);
 assert.equal(runner.calls.length,1);
 const c=runner.calls[0];
 assert.equal(c.file,process.execPath);
 assert.deepEqual(c.args,[path.join(root,'controller','lights.cjs'),'effect','chase','30']);
 assert.equal(c.options.shell,false);
 assert.equal((await a.post('/api/run',{id:'L01'})).status,409);
 c.child.report({effect:'chase',restored:true,verified:true});
 assert.equal((await (await a.get('/api/status')).json()).running,true);
 c.child.emit('close',0,null);
 const s=await (await a.get('/api/status')).json();
 assert.equal(s.phase,'restored');assert.equal(s.verified,true);assert.equal(s.running,false);
});
test('run input is a closed schema with bounded integer durations or catalogue defaults',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 for(const body of [{id:'L01',duration:0},{id:'L01',duration:121},{id:'L01',duration:1.5},{id:'L01',duration:'20'},{id:'L01',duration:'forever'},{id:'L01',duration:null},{id:'L99'},null,[],{id:'L01',command:'stop'}]){
  assert.equal((await a.post('/api/run',body)).status,400,JSON.stringify(body));
 }
 assert.equal(runner.calls.length,0);
 const token=(await (await a.get('/api/bootstrap')).json()).token;
 const raw=body=>fetch(a.base+'/api/run',{method:'POST',headers:{Origin:a.base,'X-CSRF-Token':token,'Content-Type':'application/json'},body});
 assert.equal((await raw('{bad')).status,400);
 assert.equal((await raw(' '.repeat(5000))).status,413);
 for(const [id,duration,expected] of [['L01',1,'1'],['L02',120,'120'],['L06','default','forever'],['L07',undefined,'forever']]){
  assert.equal((await a.post('/api/run',{id,duration})).status,202);
  assert.equal(runner.calls.at(-1).args.at(-1),expected);
  runner.calls.at(-1).child.emit('close',1,null);
 }
});
test('cooperative stop waits for snapshot readiness and both child exits before accepting another run',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 assert.equal((await a.post('/api/stop',{})).status,409);
 assert.equal(runner.calls.length,0);
 await a.post('/api/run',{id:'L06'});
 assert.equal((await a.post('/api/stop',{})).status,202);
 assert.equal(runner.calls.length,1,'do not lose stop request to controller startup cleanup');
 runner.calls[0].child.report({snapshot:'snapshot-test.json'});
 assert.equal(runner.calls.length,2);
 assert.deepEqual(runner.calls[1].args,[runner.calls[0].args[0],'stop']);
 assert.equal(runner.calls[1].options.shell,false);
 assert.equal((await a.post('/api/stop',{})).status,202);
 assert.equal(runner.calls.length,2,'stop is idempotent');
 runner.calls[0].child.report({effect:'green-blue',restored:true,verified:true});
 runner.calls[0].child.emit('close',0,null);
 assert.equal((await a.post('/api/run',{id:'L01'})).status,409,'stop helper still running');
 runner.calls[1].child.emit('close',0,null);
 const s=await (await a.get('/api/status')).json();assert.equal(s.phase,'restored');assert.equal(s.running,false);
 assert.equal((await a.post('/api/run',{id:'L01'})).status,202);
 runner.calls[2].child.emit('close',1,null);
});
test('failed stop can be retried without releasing running effect',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 await a.post('/api/run',{id:'L01'});runner.calls[0].child.report({snapshot:'saved.json'});
 await a.post('/api/stop',{});runner.calls[1].child.stderr.write('stop disk failure');runner.calls[1].child.emit('close',1,null);
 let s=await (await a.get('/api/status')).json();
 assert.match(s.error,/Stop request failed/);assert.equal(s.running,true);assert.equal(s.phase,'running');
 await a.post('/api/stop',{});assert.equal(runner.calls.length,3);
 runner.calls[2].child.emit('close',0,null);
 assert.equal((await (await a.get('/api/status')).json()).running,true);
 runner.calls[0].child.stderr.write('Restoration failed; use saved snapshot');runner.calls[0].child.emit('close',1,null);
 s=await (await a.get('/api/status')).json();assert.equal(s.phase,'error');assert.equal(s.verified,false);assert.equal(s.snapshot,'saved.json');
 assert.match(s.output,/Restoration failed/);
});
test('spawn errors are captured rather than crashing HTTP service',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 await a.post('/api/run',{id:'L01'});
 runner.calls[0].child.emit('error',new Error('fake executable missing'));
 runner.calls[0].child.emit('close',-2,null);
 const s=await (await a.get('/api/status')).json();assert.equal(s.phase,'error');assert.match(s.output,/fake executable missing/);
 await a.post('/api/run',{id:'L01'});runner.calls[1].child.report({snapshot:'s.json'});
 await a.post('/api/stop',{});runner.calls[2].child.emit('error',new Error('stop spawn failure'));runner.calls[2].child.emit('close',-2,null);
 assert.equal((await (await a.get('/api/status')).json()).running,true);
 runner.calls[1].child.emit('close',1,null);
 const b=await fixture(t,{spawn:()=>{throw new Error('synchronous spawn failure');}});
 assert.equal((await b.post('/api/run',{id:'L01'})).status,202);
 assert.equal((await (await b.get('/api/status')).json()).phase,'error');
});
test('bounded parser recovers after oversized noise and parses fragmented verified records',()=>{
 const {objectReader}=require('../server.cjs');assert.equal(typeof objectReader,'function');
 const objects=[],reader=objectReader(x=>objects.push(x));
 reader.write('x'.repeat(100000));assert.ok(reader.buffered()<=65536);
 reader.write('\n{\n  "ignored": "'+ 'x'.repeat(100000)+'"\n}\n');assert.ok(reader.buffered()<=65536);
 const record=JSON.stringify({effect:'aurora',restored:true,verified:true},null,2)+'\n';
 for(const char of record)reader.write(char);
 assert.deepEqual(objects,[{effect:'aurora',restored:true,verified:true}]);
});
test('completion diagnostics distinguish unverified exit and failure even with a success marker',async t=>{
 for(const [record,code] of [[{effect:'sunset',restored:true,verified:true},0],[{effect:'aurora',verified:true},0],[{effect:'aurora',restored:true,verified:true},1]]){
  const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
  await a.post('/api/run',{id:'L01'});const c=runner.calls.at(-1).child;
  c.report({snapshot:'failed-snapshot.json'});
  c.stdout.write('x'.repeat(100000)+'\n');c.stderr.write('ERROR '.repeat(10000));c.report(record);c.emit('close',code,null);
  const s=await (await a.get('/api/status')).json();
  assert.equal(s.exitCode,code);assert.equal(s.phase,'error');assert.equal(s.verified,false);assert.equal(s.restored,false);assert.ok(s.output.length<=32768);
  for(let attempt=0;attempt<2;attempt++){
   const rejected=await a.post('/api/run',{id:'L02'});
   assert.equal(rejected.status,409,'unverified restoration requires manual recovery');
   assert.match((await rejected.json()).error,/manual recovery/i);
   assert.deepEqual(await (await a.get('/api/status')).json(),s,'retain failed snapshot and output');
  }
  assert.equal(runner.calls.length,1);
  assert.equal((await a.post('/api/stop',{})).status,409);
 }
});
test('snapshot readiness with an empty path still blocks after an unverified exit',async t=>{
 const runner=fakeRunner(),a=await fixture(t,{spawn:runner.spawn});
 await a.post('/api/run',{id:'L01'});runner.calls[0].child.report({snapshot:''});
 runner.calls[0].child.emit('close',1,null);
 assert.equal((await a.post('/api/run',{id:'L02'})).status,409);
 assert.equal(runner.calls.length,1);
});
test('serves accessible console shell and only allowlisted local assets',async t=>{
 const a=await fixture(t);
 const r=await a.get('/');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);
 const html=await r.text();
 for(const text of ['<html lang="en">','name="viewport"','for="search"','for="category"','for="duration"','id="catalogue"','role="status"','Stop &amp; restore','/app.mjs','/style.css']) assert.ok(html.includes(text),text);
 assert.equal((await a.get('/style.css')).status,200);
 assert.equal((await a.get('/app.mjs')).status,200);
 assert.equal((await a.get('/test/panel.test.cjs')).status,404);
});
test('production listener binds only IPv4 loopback and exposes real health',async t=>{
 const {listenPanel}=require('../server.cjs');assert.equal(typeof listenPanel,'function');
 const app=await listenPanel(0);
 t.after(()=>new Promise(r=>{app.server.close(r);app.server.closeAllConnections();}));
 assert.equal(app.server.address().address,'127.0.0.1');
 const res=await fetch(`http://127.0.0.1:${app.server.address().port}/api/health`);
 assert.deepEqual(await res.json(),{ok:true,pid:process.pid});
});
test('catalogue preserves stable codes, slugs, defaults and unique identifiers',()=>{
 assert.ok(fs.existsSync(path.join(root,'patterns.json')), 'pattern catalogue exists');
 const p=require('../patterns.json');
 assert.deepEqual(p.map(x=>[x.id,x.name,x.slug,x.duration]),[
 ['L01','Aurora','aurora',20],['L02','Rainbow','rainbow',20],['L03','Pride','pride',20],['L04','Sunset','sunset',20],['L05','Chase','chase',30],['L06','Green-blue swap','green-blue','forever'],['L07','Blue pulse','pulse-blue','forever'],['L08','Red/Blue Sweep','red-blue',20]]);
 assert.equal(new Set(p.map(x=>x.id)).size,p.length);
 assert.equal(new Set(p.map(x=>x.slug)).size,p.length);
 for(const x of p) assert.ok(x.category && x.description);
});
