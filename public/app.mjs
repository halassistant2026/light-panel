export async function mount(doc,fetcher=fetch,confirmRun=confirm,schedule=setTimeout){
 const el=id=>doc.getElementById(id);
 const node=(tag,text,className)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 let patterns=[],rows=[],token='',state={phase:'idle',running:false},pending=false,connected=false,revision=0;
 async function request(url,body){
  const options={cache:'no-store',signal:AbortSignal.timeout(5000)};
  if(body!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
  const response=await fetcher(url,options),data=await response.json();
  if(!response.ok)throw new Error((data.error||`Request failed (${response.status})`)+(response.status===403?' — reload this page to reconnect.':''));
  return data;
 }
 function showFailure(error){connected=false;el('error').textContent=error.message;el('error').hidden=false;}
 function filter(){
  const visible=new Set(filterPatterns(patterns,el('search').value,el('category').value).map(p=>p.id));
  for(const row of rows)row.li.hidden=!visible.has(row.pattern.id);
  el('count').textContent=`${visible.size} / ${patterns.length} patterns`;
  el('empty').hidden=visible.size!==0;
 }
 function render(){
  for(const row of rows){row.button.disabled=pending||!connected||state.running;row.li.className='pattern'+(state.running&&state.id===row.pattern.id?' active':'');}
  el('stop').disabled=pending||!connected||!state.running||state.phase==='stopping';
  el('connection').textContent=connected?'LOCAL / CONNECTED':'LOCAL / OFFLINE';
  const titles={idle:'Ready to run',running:`Running · ${state.id} ${state.name}`,stopping:'Stopping · waiting for verified restoration',restored:'Restored · saved state verified',error:'Attention · restoration not verified'};
  el('status').textContent=connected?(titles[state.phase]||state.phase):'Controller unavailable';
  el('run-detail').textContent=state.running?`${state.duration==='forever'?'Until stopped':`${state.duration} seconds`} · keep this computer awake; restoration can take extra time.`:'Status is panel activity, not a live bulb readback.';
  el('output').textContent=state.output||'No run output yet.';
  el('snapshot').textContent=state.snapshot?`Saved snapshot: ${state.snapshot}`:'';
  if(state.error){el('error').textContent=state.error;el('error').hidden=false;}
 }
 async function run(pattern){
  if(pending||state.running||!connected)return;
  let duration='default';
  if(el('duration').value==='custom'){
   const text=el('seconds').value;
   if(!/^\d+$/.test(text)||Number(text)<1||Number(text)>120){el('error').textContent='Enter a whole number of seconds from 1 to 120.';el('error').hidden=false;return;}
   duration=Number(text);
  }
  if(pattern.warning&&!confirmRun(`${pattern.warning}\nRun ${pattern.id} ${pattern.name}?`))return;
  el('error').hidden=true;pending=true;revision++;render();
  try{state=await request('/api/run',{id:pattern.id,duration});}
  catch(error){showFailure(error);}
  finally{pending=false;render();}
 }
 function build(){
  const categories=[...new Set(patterns.map(p=>p.category))].sort();
  for(const category of categories){const option=node('option',category);option.value=category;el('category').append(option);}
  rows=patterns.map(pattern=>{
   const li=node('li',null,'pattern'),info=node('div');
   info.append(node('h3',pattern.name),node('p',pattern.description,'description'));
   if(pattern.warning)info.append(node('p',pattern.warning,'warning'));
   const button=node('button','Run','run');button.setAttribute('aria-label',`Run ${pattern.id} ${pattern.name}`);button.addEventListener('click',()=>run(pattern));
   li.append(node('span',pattern.id,'code'),info,node('span',pattern.category,'category'),node('span',pattern.duration==='forever'?'Until stopped':`${pattern.duration} sec`,'default-duration'),button);
   return {pattern,li,button};
  });
  el('catalogue').replaceChildren(...rows.map(r=>r.li));filter();
 }
 async function refresh(){
  if(pending)return;
  const atRevision=revision;
  try{
   if(!token){const boot=await request('/api/bootstrap');token=boot.token;patterns=boot.patterns;build();}
   const latest=await request('/api/status');
   if(atRevision!==revision)return;
   state=latest;connected=true;el('error').hidden=true;
  }catch(error){if(atRevision!==revision)return;showFailure(error);}
  render();
 }
 el('search').addEventListener('input',filter);el('category').addEventListener('change',filter);
 el('duration').addEventListener('change',()=>{el('seconds-field').hidden=el('duration').value!=='custom';});
 el('stop').addEventListener('click',async()=>{
  if(pending||!connected||!state.running||state.phase==='stopping')return;
  pending=true;revision++;render();
  try{state=await request('/api/stop',{});}
  catch(error){showFailure(error);}
  finally{pending=false;render();}
 });
 async function poll(){await refresh();schedule(poll,1000);}
 await refresh();
 schedule(poll,1000);
 return {refresh};
}
if(typeof document!=='undefined')mount(document);

export function filterPatterns(patterns,query,category){
 const term=query.trim().toLowerCase();
 return patterns.filter(p=>(category==='all'||p.category===category)&&`${p.id} ${p.name}`.toLowerCase().includes(term));
}
