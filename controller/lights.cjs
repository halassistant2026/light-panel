const fields=['mode','hue','saturation','color_temp','brightness'];
function settings(s){const source=s.on_off?s:s.dft_on_state;if(!source)throw new Error('Missing saved light settings');return Object.fromEntries(fields.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));}
function validateSavedState(s){
 const invalid=()=>{throw new Error('Invalid saved light state');};
 if(!s||typeof s!=='object'||Array.isArray(s)||(s.on_off!==0&&s.on_off!==1))invalid();
 const source=s.on_off===1?s:s.dft_on_state;
 if(!source||typeof source!=='object'||Array.isArray(source)||source.mode!=='normal')invalid();
 const ranges={hue:[0,359],saturation:[0,100],color_temp:[0,6500],brightness:[1,100]};
 for(const [key,[min,max]] of Object.entries(ranges)){
  const value=source[key];
  if(!Number.isInteger(value)||value<min||value>max||(key==='color_temp'&&value!==0&&value<2500))invalid();
 }
}
function restorePayload(s){return {...settings(s),on_off:1,transition_period:0};}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sendOptions={timeout:3000};
async function restore(bulbs,states){
 const results=await Promise.allSettled(bulbs.map(async(b,i)=>{
  for(let attempt=0;attempt<3;attempt++)try{
   await b.lighting.setLightState(restorePayload(states[i]),sendOptions);
   if(!states[i].on_off)await b.lighting.setLightState({on_off:0,transition_period:0},sendOptions);
   const actual=await b.lighting.getLightState(sendOptions);
   if(actual.on_off!==states[i].on_off || fields.some(k=>settings(actual)[k]!==settings(states[i])[k]))throw new Error('Restore readback mismatch');
   return actual;
  }catch(e){if(attempt===2)throw e;await sleep(300);}
 }));
 const errors=results.filter(r=>r.status==='rejected');
 if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'Restoration failed; use saved snapshot');
 return results.map(r=>r.value);
}
async function temporary(bulbs,action,persist){
 const states=await Promise.all(bulbs.map(b=>b.lighting.getLightState(sendOptions)));
 states.forEach(settings);
 await persist(states);
 try{await action();}finally{await restore(bulbs,states);}
 return states;
}
function alternatingHue(step,index){return (step+index)%2===0?120:240;}
function pulsePayload(step){return {on_off:1,mode:'normal',hue:200,saturation:65,color_temp:0,brightness:step%2===0?20:1,transition_period:2000};}
function prideFrame(step,i){
 const t=step%20,rainbow=[0,30,60,120,240,280];
 let hue,saturation=100,brightness=(t+i)%2===0?65:30;
 if(t<6){hue=rainbow[(t+i*3)%6];}
 else if(t<12){const p=[[195,55],[330,50],[0,0]][(t-6+i)%3];[hue,saturation]=p;brightness=50;}
 else if(t<16){hue=[325,280,240][(t-12+i)%3];brightness=(t+i)%2===0?60:30;}
 else{hue=rainbow[((t-16)*2+i*3)%6];brightness=t===19?70:55;}
 return {on_off:1,mode:'normal',hue,saturation,color_temp:saturation===0?5000:0,brightness,transition_period:t<6?700:900};
}
function chaseFrame(step,index,count){return index===step%count?{on_off:1,mode:'normal',hue:180,saturation:100,color_temp:0,brightness:35,transition_period:0}:{on_off:0,transition_period:0};}
function chaseInterval(elapsedSeconds,duration=20){return Math.round(1000-900*Math.max(0,Math.min(1,elapsedSeconds/(Number.isFinite(duration)?Math.min(duration,20):20))));}
async function writeChaseStep(bulbs,step){
 const active=step%bulbs.length;
 if(step===0){
  const results=await Promise.allSettled(bulbs.map((b,i)=>i===active?Promise.resolve():b.lighting.setLightState({on_off:0,transition_period:0},sendOptions)));
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 }else await bulbs[(step-1)%bulbs.length].lighting.setLightState({on_off:0,transition_period:0},sendOptions);
 await bulbs[active].lighting.setLightState(chaseFrame(step,active,bulbs.length),sendOptions);
}
function redBlueFrame(step,index){return {on_off:1,mode:'normal',hue:(step+index)%2===0?0:240,saturation:100,color_temp:0,brightness:35,transition_period:2000};}
module.exports={settings,restorePayload,restore,temporary,alternatingHue,pulsePayload,prideFrame,chaseFrame,chaseInterval,writeChaseStep,redBlueFrame};

async function main(args){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const [command='help',target,value]=args;
 const stopFile=path.join(__dirname,'state','effect.stop');
 if(command==='stop'){fs.writeFileSync(stopFile,'stop');console.log('Stop requested; wait for restored readback before new commands');return;}
 const print=x=>console.log(JSON.stringify(x,null,2));
 const invalid=()=>{throw new Error('Invalid command, target, or values; run help');};
 if(command==='help'){console.log('status | set <light|lamp|all> <JSON> | snapshot | restore <path> | effect <rainbow|aurora|sunset|green-blue|pulse-blue|pride|chase|red-blue> <seconds:1-120|forever> | discover [all] | stop');return;}
 if(!['status','set','snapshot','restore','effect','discover'].includes(command))invalid();
 let payload,duration;
 if(command==='set'){
  if(!['light','lamp','all'].includes(target))invalid();
  try{payload=JSON.parse(value);}catch{invalid();}
  if(!payload||Array.isArray(payload)||typeof payload!=='object'||!Object.keys(payload).length)invalid();
  const ranges={on_off:[0,1],hue:[0,359],saturation:[0,100],brightness:[1,100],color_temp:[0,6500],transition_period:[0,10000]};
  for(const [k,v] of Object.entries(payload)){
   if(k==='mode'){if(v!=='normal')invalid();continue;}
   if(!ranges[k]||!Number.isInteger(v)||v<ranges[k][0]||v>ranges[k][1]||(k==='color_temp'&&v!==0&&v<2500))invalid();
  }
 }
 if(command==='effect'){
  duration=value==='forever'?Infinity:Number(value??20);
  if(!['rainbow','aurora','sunset','green-blue','pulse-blue','pride','chase','red-blue'].includes(target)||(value!=='forever'&&!Number.isFinite(duration))||duration<1||(duration>120&&duration!==Infinity))invalid();
 }

 const config=require('./devices.json');
 let snapshot,restoreSelection;
 if(command==='restore'){
  if(!target)invalid();
  snapshot=JSON.parse(fs.readFileSync(target,'utf8'));
  if(!Array.isArray(snapshot?.devices)||!snapshot.devices.length)throw new Error('Invalid snapshot identity');
  const seen=new Set();
  restoreSelection=snapshot.devices.map(d=>{
   const matches=config.filter(c=>typeof d?.mac==='string'&&c.mac===d.mac);
   if(matches.length!==1||seen.has(d.mac))throw new Error('Invalid snapshot identity');
   seen.add(d.mac);return matches[0];
  });
  snapshot.devices.forEach(d=>validateSavedState(d.state));
 }
 const {Client}=require('tplink-smarthome-api');
 const client=new Client({defaultSendOptions:sendOptions});
 const normalized=mac=>String(mac).replace(/[^a-f0-9]/gi,'').toUpperCase();
 if(command==='discover'){
  const iface=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.address.startsWith('192.168.1.'));
  if(!iface)throw new Error('No suitable LAN interface');
  const found=new Map();
  let error;
  client.on('error',e=>{error=e;});
  client.on('device-new',b=>{const entry=config.find(c=>normalized(c.mac)===normalized(b.mac));if(target==='all'||entry)found.set(entry?.key??normalized(b.mac),{key:entry?.key??null,host:b.host,alias:b.alias,mac:b.mac});});
  try{client.startDiscovery({address:iface.address,deviceTypes:['bulb']});await sleep(8000);}finally{client.stopDiscovery();}
  print([...found.values()]);if(error)throw error;if(found.size!==config.length)throw new Error('Not all configured bulbs discovered');return;
 }
 const selected=command==='restore'?restoreSelection:command==='effect'&&target==='pulse-blue'?config.filter(c=>c.key==='lamp'):command==='set'&&target!=='all'?config.filter(c=>c.key===target):config;
 const stateDir=path.join(__dirname,'state');fs.mkdirSync(stateDir,{recursive:true});
 const lock=path.join(stateDir,'control.lock');let locked=false;
 const mutating=['set','restore','effect'].includes(command);
 try{
  if(mutating){const fd=fs.openSync(lock,'wx');locked=true;try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,command}));}finally{fs.closeSync(fd);}}
  const bulbs=await Promise.all(selected.map(async c=>{const b=await client.getDevice({host:c.host});if(normalized(b.mac)!==normalized(c.mac))throw new Error('MAC mismatch for '+c.key+'; rediscover before control');return b;}));
  const read=()=>Promise.all(bulbs.map(b=>b.lighting.getLightState(sendOptions)));
  const report=states=>print(selected.map((c,i)=>({key:c.key,alias:c.alias,host:c.host,state:states[i]})));
  const persist=async states=>{const file=path.join(stateDir,`snapshot-${Date.now()}-${process.pid}.json`);fs.writeFileSync(file,JSON.stringify({devices:selected.map((c,i)=>({...c,state:states[i]}))},null,2),{flag:'wx'});print({snapshot:file});return file;};
  if(command==='status'){report(await read());return;}
  if(command==='snapshot'){await persist(await read());return;}
  if(command==='restore'){report(await restore(bulbs,snapshot.devices.map(d=>d.state)));print({restored:true,verified:true});return;}
  if(command==='set'){
   const writes=await Promise.allSettled(bulbs.map(async b=>b.lighting.setLightState(payload,sendOptions)));
   const failed=writes.find(r=>r.status==='rejected');if(failed)throw failed.reason;
   await sleep((payload.transition_period??0)+150);
   const actual=await read();report(actual);
   for(const s of actual)for(const [k,v] of Object.entries(payload))if(k!=='transition_period'&&(k==='on_off'?s[k]:settings(s)[k])!==v)throw new Error('Set readback mismatch: '+k);
   print({verified:true});return;
  }
  if(fs.existsSync(stopFile))fs.unlinkSync(stopFile);
  let stopped=false;const stop=()=>{stopped=true;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
   await temporary(bulbs,async()=>{
    if(target==='pulse-blue')await bulbs[0].lighting.setLightState({...pulsePayload(1),transition_period:0},sendOptions);
    const start=Date.now();let step=0;
    while(!stopped&&!fs.existsSync(stopFile)&&Date.now()-start<duration*1000){
     const progress=(Date.now()-start)/(duration*1000);
    if(target==='chase'){
     const frameStart=Date.now(),interval=chaseInterval((Date.now()-start)/1000,duration);
     await writeChaseStep(bulbs,step);
     if(step<bulbs.length||progress>0.9)print({phase:step,elapsed_ms:Date.now()-start,interval_ms:interval,write_ms:Date.now()-frameStart,writes_acknowledged:true,active_key:selected[step%bulbs.length].key});
     step++;await sleep(Math.max(0,interval-(Date.now()-frameStart)));continue;
    }
     const changes=bulbs.map((b,i)=>{
      if(target==='red-blue')return b.lighting.setLightState(redBlueFrame(step,i),sendOptions);
      if(target==='pride')return b.lighting.setLightState(prideFrame(step,i),sendOptions);
      if(target==='pulse-blue')return b.lighting.setLightState(pulsePayload(step),sendOptions);
      const hue=target==='green-blue'?alternatingHue(step,i):target==='rainbow'?(step*18+i*180)%360:target==='aurora'?Math.round(170+i*75+25*Math.sin(progress*Math.PI*2)):Math.round(10+i*25+10*Math.sin(progress*Math.PI*2));
      return b.lighting.setLightState({on_off:1,mode:'normal',hue,saturation:target==='sunset'?85:100,color_temp:0,brightness:35,transition_period:target==='green-blue'?0:900},sendOptions);
     });
     const writes=await Promise.allSettled(changes);const failed=writes.find(r=>r.status==='rejected');if(failed)throw failed.reason;
     const acknowledgedAt=Date.now();
     if(target==='green-blue'&&step<2){const states=await read();if(states.some((s,i)=>s.on_off!==1||s.hue!==alternatingHue(step,i)||s.color_temp!==0))throw new Error('Alternation readback mismatch');print({phase:step,verified:true,states});}
     step++;await sleep(Math.max(0,Math.min(start+step*((target==='pulse-blue'||target==='red-blue')?2000:1000),start+duration*1000)-Date.now()));
     if(target==='pulse-blue'&&step<=2){
      const deadline=start+duration*1000;
      if(stopped||fs.existsSync(stopFile)||Date.now()>=deadline)break;
      const expected=pulsePayload(step-1);
      // Acknowledgement can lag frame scheduling; allow the full fade before reading.
      await sleep(Math.max(0,Math.min(acknowledgedAt+expected.transition_period+100,deadline)-Date.now()));
      if(stopped||fs.existsSync(stopFile)||Date.now()>=deadline)break;
      const states=await read();
      if(states.some(s=>s.on_off!==1||s.hue!==200||s.color_temp!==0||Math.abs(s.brightness-expected.brightness)>1))throw new Error('Pulse readback mismatch');
      print({phase:step,verified:true,states});
     }
    }
   },persist);
   report(await read());print({effect:target,restored:true,verified:true,interrupted:stopped});
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
 }finally{if(locked)fs.unlinkSync(lock);}
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.stack??e);process.exitCode=1;});
