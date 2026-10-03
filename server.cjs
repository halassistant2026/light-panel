'use strict';
const http=require('node:http');
const {randomBytes}=require('node:crypto');
const patterns=require('./patterns.json');
const controller=require('node:path').join(__dirname,'controller','lights.cjs');
// Controller emits pretty-printed top-level JSON objects; keep parsing bounded
// separately from the rolling display log so forever effects cannot grow memory.
function objectReader(onObject){
 let line='',object='',dropping=false;
 return {buffered:()=>line.length+object.length,write(text){
  for(const char of text){
   if(char!=='\n'){
    if(!dropping)line+=char;
    if(line.length+object.length>65536){line='';object='';dropping=true;}
    continue;
   }
   if(!dropping){
    line=line.replace(/\r$/,'');
    if(line==='{')object='';
    if(line==='{'||object)object+=line+'\n';
    if(line==='}'&&object){let parsed;try{parsed=JSON.parse(object);}catch{}object='';if(parsed)onObject(parsed);}
   }
   line='';dropping=false;
  }
 }};
}
function createPanel({spawn=require('node:child_process').spawn}={}){
 const token=randomBytes(32).toString('hex');
 let active=null;
 let state={phase:'idle',running:false,restored:null,verified:false,output:'',error:null};
 const append=text=>{state.output=(state.output+text).slice(-32768);};
 function finish(run){
  if(!run.closed||run.stopPending)return;
  state.running=false;state.exitCode=run.code;state.verified=run.code===0&&run.verified;state.restored=state.verified;
  state.phase=state.verified?'restored':'error';
  state.error=state.verified?null:'Restoration not verified. Check controller output and saved snapshot.';
  state.finishedAt=new Date().toISOString();active=null;
 }
 function requestStop(run){
  run.stopRequested=true;state.phase='stopping';
  if(!run.ready||run.stopSent||run.closed)return;
  run.stopSent=true;run.stopPending=true;
  let stopper;
  try{stopper=spawn(process.execPath,[controller,'stop'],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch(error){append(error.message+'\n');run.stopPending=false;run.stopSent=false;state.phase='running';state.error='Stop request failed. Retry Stop & restore.';return;}
  stopper.on('error',error=>append(error.message+'\n'));
  stopper.stdout.setEncoding('utf8');stopper.stderr.setEncoding('utf8');
  stopper.stdout.on('data',append);stopper.stderr.on('data',append);
  stopper.on('close',code=>{
   run.stopPending=false;
   if(code!==0&&!run.closed){run.stopSent=false;state.phase='running';state.error='Stop request failed. Effect may still be running; retry Stop & restore.';}
   finish(run);
  });
 }
 function start(pattern,duration){
  state={phase:'running',running:true,id:pattern.id,name:pattern.name,duration,startedAt:new Date().toISOString(),restored:null,verified:false,output:'',error:null};
  const run={verified:false};active=run;
  let child;
  try{child=spawn(process.execPath,[controller,'effect',pattern.slug,String(duration)],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch(error){append(error.message+'\n');run.closed=true;run.code=-1;finish(run);return;}
  child.on('error',error=>append(error.message+'\n'));
  run.child=child;
  const reader=objectReader(obj=>{
   if(obj.effect===pattern.slug&&obj.restored===true&&obj.verified===true)run.verified=true;
   if(typeof obj.snapshot==='string'){run.ready=true;state.snapshot=obj.snapshot;if(run.stopRequested)requestStop(run);}
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',text=>{append(text);reader.write(text);});
  child.stderr.setEncoding('utf8');child.stderr.on('data',append);
  child.on('close',code=>{run.closed=true;run.code=code;finish(run);});
 }
 const server=http.createServer((req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const port=server.address().port;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(403,{error:'Invalid Host'});
  if(req.method==='POST'){
   if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-csrf-token']!==token||['cross-site','none'].includes(req.headers['sec-fetch-site']))return send(403,{error:'Untrusted request'});
   if(req.headers['content-type']!=='application/json')return send(415,{error:'Use application/json'});
  }
  if(req.method==='POST'&&['/api/run','/api/stop'].includes(req.url)){
   let body='',size=0,tooLarge=false;
   req.on('data',chunk=>{size+=chunk.length;if(size>4096){tooLarge=true;body='';}else if(!tooLarge)body+=chunk;});
   req.on('end',()=>{
    if(tooLarge)return send(413,{error:'Body exceeds 4096 bytes'});
    let data;try{data=JSON.parse(body);}catch{return send(400,{error:'Invalid JSON'});}
    const allowed=req.url==='/api/stop'?[]:['id','duration'];
    if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).some(k=>!allowed.includes(k)))return send(400,{error:'Invalid request fields'});
    if(req.url==='/api/stop'){
     if(!active)return send(409,{error:'No effect owned by this panel is running'});
     requestStop(active);return send(202,state);
    }
    const pattern=patterns.find(p=>p.id===data.id);
    if(!pattern)return send(400,{error:'Unknown pattern code'});
    const useDefault=data.duration===undefined||data.duration==='default';
    if(!useDefault&&(!Number.isInteger(data.duration)||data.duration<1||data.duration>120))return send(400,{error:'Duration must be an integer from 1 to 120, or default'});
    if(active)return send(409,{error:'An effect is already running'});
    if(typeof state.snapshot==='string'&&!state.verified)return send(409,{error:'Restoration not verified. Manual recovery required; preserve the snapshot/output, restore and verify the saved state, then restart the panel.'});
    start(pattern,useDefault?pattern.duration:data.duration);send(202,state);
   });return;
  }
  if(req.method==='GET'&&req.url==='/api/bootstrap')return send(200,{token,patterns});
  if(req.method==='GET'&&req.url==='/api/status')return send(200,state);
  if(req.method==='GET'&&req.url==='/api/health')return send(200,{ok:true,pid:process.pid});
  const assets={'/':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.mjs':['app.mjs','text/javascript']};
  if(req.method==='GET'&&Object.hasOwn(assets,req.url)){
   const [file,type]=assets[req.url];
   require('node:fs').readFile(require('node:path').join(__dirname,'public',file),(error,content)=>{
    if(error)return send(500,{error:'Static asset unavailable'});
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);
   });return;
  }
  send(404,{error:'Not found'});
 });
 return {server};
}
async function listenPanel(port=8766){
 const app=createPanel();
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
 return app;
}
module.exports={createPanel,objectReader,listenPanel};
if(require.main===module){
 listenPanel().then(({server})=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,pid:process.pid}))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
