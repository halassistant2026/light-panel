import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as ui from '../public/app.mjs';
const patterns=createRequire(import.meta.url)('../patterns.json');
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.handlers={};this.value='';this.hidden=false;this.disabled=false;this.attributes={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,fn){this.handlers[k]=fn;}
 async fire(k){return this.handlers[k]?.({target:this,preventDefault(){}});}
}
function dom(){
 const elements=new Map();
 const doc={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:tag=>new Element(tag)};
 doc.getElementById('category').value='all';doc.getElementById('duration').value='default';doc.getElementById('seconds').value='20';
 return doc;
}
test('console loads real rows, filters accessibly, runs with CSRF and disables conflicting actions',async()=>{
 assert.equal(typeof ui.mount,'function');
 const doc=dom(),calls=[];
 let state={phase:'idle',running:false,output:''};
 const fetcher=async(url,options={})=>{
  calls.push({url,options});
  if(url==='/api/run')state={phase:'running',running:true,id:'L01',name:'Aurora',duration:20};
  return {ok:true,status:200,json:async()=>url==='/api/bootstrap'?{token:'test-token',patterns}:state};
 };
 const app=await ui.mount(doc,fetcher,()=>true,()=>{});
 const rows=doc.getElementById('catalogue').children;
 assert.equal(rows.length,8);
 assert.equal(doc.getElementById('stop').disabled,true);
 doc.getElementById('search').value='l01';await doc.getElementById('search').fire('input');
 assert.equal(rows.filter(x=>!x.hidden).length,1);
 const run=rows[0].children.at(-1);assert.equal(run.attributes['aria-label'],'Run L01 Aurora');
 await run.fire('click');
 const request=calls.find(x=>x.url==='/api/run');
 assert.deepEqual(JSON.parse(request.options.body),{id:'L01',duration:'default'});
 assert.equal(request.options.headers['X-CSRF-Token'],'test-token');
 assert.equal(run.disabled,true);assert.equal(doc.getElementById('stop').disabled,false);
 assert.match(doc.getElementById('status').textContent,/Aurora/);
 state={phase:'restored',running:false,verified:true,output:'verified output'};
 await app.refresh();assert.equal(run.disabled,false);assert.match(doc.getElementById('status').textContent,/Restored/);
});
test('custom duration validates before request and Chase requires flashing confirmation',async()=>{
 const doc=dom(),posts=[];let consent=false,warning='';
 await ui.mount(doc,async(url,options={})=>{
  if(options.method==='POST')posts.push(JSON.parse(options.body));
  return {ok:true,json:async()=>url==='/api/bootstrap'?{token:'t',patterns}:{phase:'idle',running:false}};
 },text=>{warning=text;return consent;},()=>{});
 doc.getElementById('duration').value='custom';await doc.getElementById('duration').fire('change');
 assert.equal(doc.getElementById('seconds-field').hidden,false);
 const run=doc.getElementById('catalogue').children[0].children.at(-1);
 for(const bad of ['','0','121','1.5','1e2']){doc.getElementById('seconds').value=bad;await run.fire('click');}
 assert.equal(posts.length,0);assert.match(doc.getElementById('error').textContent,/1.*120/);
 doc.getElementById('seconds').value='12';await run.fire('click');assert.deepEqual(posts[0],{id:'L01',duration:12});
 const chase=doc.getElementById('catalogue').children[4].children.at(-1);
 await chase.fire('click');assert.equal(posts.length,1);assert.match(warning,/Rapid flashing/);
 consent=true;await chase.fire('click');assert.deepEqual(posts[1],{id:'L05',duration:12});
});
test('stop UI stays busy until polled restoration and displays controller failures',async()=>{
 const doc=dom(),scheduled=[],posts=[];
 let state={phase:'running',running:true,id:'L06',name:'Green-blue swap',duration:'forever'};
 await ui.mount(doc,async(url,options={})=>{
  if(url==='/api/stop'){posts.push(options);state={...state,phase:'stopping'};}
  return {ok:true,json:async()=>url==='/api/bootstrap'?{token:'t',patterns}:state};
 },()=>true,(fn,ms)=>scheduled.push({fn,ms}));
 await doc.getElementById('stop').fire('click');
 assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].body),{});
 assert.equal(doc.getElementById('stop').disabled,true);
 assert.match(doc.getElementById('status').textContent,/waiting/);
 assert.equal(scheduled[0].ms,1000);
 state={phase:'error',running:false,error:'Restoration not verified',snapshot:'saved.json',output:'network failure'};
 await scheduled.shift().fn();
 assert.equal(doc.getElementById('error').hidden,false);assert.match(doc.getElementById('error').textContent,/Restoration/);
 assert.equal(doc.getElementById('output').textContent,'network failure');assert.match(doc.getElementById('snapshot').textContent,/saved.json/);
 assert.equal(scheduled.length,1);
});
test('network/API errors are visible, disable uncertain actions and polling recovers',async()=>{
 const doc=dom(),scheduled=[];let offline=true,rejectRun=false;
 const fetcher=async(url,options={})=>{
  if(offline)throw new Error('Network unavailable');
  if(options.method==='POST'&&rejectRun)return {ok:false,status:403,json:async()=>({error:'Untrusted request; reload page'})};
  return {ok:true,json:async()=>url==='/api/bootstrap'?{token:'t',patterns}:{phase:'idle',running:false}};
 };
 await ui.mount(doc,fetcher,()=>true,(fn)=>scheduled.push(fn));
 assert.equal(doc.getElementById('error').hidden,false);assert.match(doc.getElementById('status').textContent,/unavailable/);
 offline=false;await scheduled.shift()();
 const run=doc.getElementById('catalogue').children[0].children.at(-1);assert.equal(run.disabled,false);assert.equal(doc.getElementById('error').hidden,true);
 rejectRun=true;await run.fire('click');assert.match(doc.getElementById('error').textContent,/reload page/);
 assert.equal(run.disabled,true);
 await scheduled.shift()();assert.equal(run.disabled,false);
});
test('late status response cannot re-enable Run after a newer mutation',async()=>{
 const doc=dom();let hold=false,release;
 const app=await ui.mount(doc,async(url)=>{
  if(url==='/api/bootstrap')return {ok:true,json:async()=>({token:'t',patterns})};
  if(url==='/api/status'&&hold)return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({phase:'idle',running:false})});});
  return {ok:true,json:async()=>url==='/api/run'?{phase:'running',running:true,id:'L01',name:'Aurora',duration:20}:{phase:'idle',running:false}};
 },()=>true,()=>{});
 hold=true;const stale=app.refresh();
 const run=doc.getElementById('catalogue').children[0].children.at(-1);
 await run.fire('click');release();await stale;
 assert.equal(run.disabled,true);assert.match(doc.getElementById('status').textContent,/Running/);
});
test('catalogue filtering combines case-insensitive code/name search with category',()=>{
 assert.equal(typeof ui.filterPatterns,'function');
 assert.deepEqual(ui.filterPatterns(patterns,' l01 ','all').map(p=>p.id),['L01']);
 assert.deepEqual(ui.filterPatterns(patterns,'BLUE','Dynamic').map(p=>p.id),['L06']);
 assert.deepEqual(ui.filterPatterns(patterns,'blue','Colour').map(p=>p.id),['L08']);
 assert.equal(ui.filterPatterns(patterns,'','Ambient').length,3);
 assert.equal(ui.filterPatterns(patterns,'','all').length,patterns.length);
});
