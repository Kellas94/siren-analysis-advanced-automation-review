// Helper-author, Root-operated metadata/process proof. No analytical execution.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const STORE_PIN='53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618';
const GROUPS=['BEFORE_LINK_STOP_CONSERVES_ACK','COMMITTED_STOP_COLD_RECOVERY','TWO_WRITER_CONFLICT_REFRESH_RETRY'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const entry=id=>({id,wide:'9007199254740993',precision:'9999999999999999999999999999.1234567890',identifier:'00120',empty:'',nullable:null,flag:false});
const append=(state,id)=>({revision:state.revision+1,entries:[...structuredClone(state.entries),entry(id)]});
function validateState(state,previous){
  assert.deepEqual(Object.keys(state).sort(),['entries','revision']);assert.equal(state.revision,state.entries.length);assert.equal(state.revision,(previous?.revision??0)+1);assert.ok(Number.isSafeInteger(state.revision));
  const ids=new Set();for(const value of state.entries){assert.deepEqual(value,entry(value.id));assert.ok(!ids.has(value.id));ids.add(value.id);}
  if(previous)assert.deepEqual(state.entries.slice(0,-1),previous.entries);
}
function inventory(directory){
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name=>{const file=path.join(directory,name),stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());return [name,{bytes:stat.size,sha256:sha(fs.readFileSync(file))}];}));
}
function conserved(before,after){for(const [name,pin]of Object.entries(before))assert.deepEqual(after[name],pin,'Existing metadata bytes changed: '+name);}

export async function runProof(context){
  const {out,executables,sources}=context;
  assert.equal(path.dirname(executables),out);assert.equal(fileURLToPath(import.meta.url),path.join(executables,'history-process.mjs'),'Proof executes captured driver');
  for(const source of sources){assert.equal(sha(fs.readFileSync(source.copy)),source.sha256);assert.equal(sha(fs.readFileSync(source.original)),source.sha256);}
  const sourcePins=Object.fromEntries(sources.map(source=>[source.name,source.sha256]));assert.equal(sourcePins['publication-store.mjs'],STORE_PIN);
  const {DirectoryHistory}=await import(pathToFileURL(path.join(executables,'publication-store.mjs')).href);
  const authority={storeId:'owned-history-process-proof',scope:out,kind:'metadata-only'},groups=[],handles=[],processes=[],unexpectedCleanup=[];
  const configs=path.join(out,'configs'),receipts=path.join(out,'receipts'),logs=path.join(out,'logs');for(const dir of [configs,receipts,logs])fs.mkdirSync(dir);
  function launch(base,writerId,mode,directory,expectedHead=null,state=null,gatePhase=null,releaseFile=path.join(base,'release')){
    assert.match(writerId,/^[a-z0-9-]{1,64}$/);assert.ok(!handles.some(h=>h.writerId===writerId),'No reused writer identity');
    const config={protocol:'history-process-worker/1',root:out,writerId,mode,directory,authority,expectedHead,state,gatePhase,markerFile:path.join(base,writerId+'-phase.json'),releaseFile,receiptFile:path.join(receipts,writerId+'.json'),sourcePins};
    const file=path.join(configs,writerId+'.json');json(file,config);const configSha256=sha(fs.readFileSync(file));
    const child=spawn(process.execPath,[path.join(executables,'fs-writer.mjs'),file],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    const handle={writerId,child,config,configSha256,closed:false,exit:null,spawnError:null,controlledStop:null,group:base};handles.push(handle);
    child.stdout.on('data',bytes=>fs.appendFileSync(path.join(logs,writerId+'.stdout.log'),bytes));child.stderr.on('data',bytes=>fs.appendFileSync(path.join(logs,writerId+'.stderr.log'),bytes));
    child.once('error',error=>{handle.spawnError={code:error.code,message:error.message};});
    handle.closePromise=new Promise(resolve=>child.once('close',(code,signal)=>{handle.closed=true;handle.exit={writerId,pid:child.pid,code,signal,closeObserved:true,spawnError:handle.spawnError,controlledStop:handle.controlledStop};processes.push(handle.exit);json(path.join(receipts,writerId+'-exit.json'),handle.exit);resolve(handle.exit);}));
    return handle;
  }
  async function closed(handle,timeout=10000){let timer;try{return await Promise.race([handle.closePromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned process close timeout: '+handle.writerId)),timeout);})]);}finally{clearTimeout(timer);}}
  async function phase(handle,expected){
    const deadline=Date.now()+15000;
    while(!fs.existsSync(handle.config.markerFile)){if(handle.closed)throw Error('Own child closed before phase: '+handle.writerId+' '+JSON.stringify(handle.exit));if(Date.now()>deadline)throw Error('Owned phase timeout: '+handle.writerId);await delay(10);}
    const marker=JSON.parse(fs.readFileSync(handle.config.markerFile));assert.equal(marker.writerId,handle.writerId);assert.equal(marker.pid,handle.child.pid);assert.equal(marker.phase,expected);assert.equal(marker.configSha256,handle.configSha256);assert.deepEqual(marker.sourcePins,sourcePins);assert.deepEqual(marker.expectedHead,handle.config.expectedHead);return marker;
  }
  function receipt(handle){const value=JSON.parse(fs.readFileSync(handle.config.receiptFile));assert.equal(value.pid,handle.child.pid);assert.equal(value.writerId,handle.writerId);assert.equal(value.configSha256,handle.configSha256);assert.deepEqual(value.sourcePins,sourcePins);return value;}
  async function normal(handle,outcomes){const exit=await closed(handle);assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.equal(exit.spawnError,null);const value=receipt(handle);assert.ok(outcomes.includes(value.outcome),'Unexpected worker outcome: '+value.outcome);return {receipt:value,exit};}
  async function stop(handle,expectedPhase){
    assert.ok(handles.includes(handle)&&!handle.closed&&handle.child.pid,'Only captured live own child may stop');
    const marker=await phase(handle,expectedPhase);assert.equal(fs.existsSync(handle.config.receiptFile),false,'No ACK before controlled stop');
    handle.controlledStop={purpose:expectedPhase,method:'captured ChildProcess.kill(SIGTERM)',requestedAt:new Date().toISOString(),returned:false};
    handle.controlledStop.returned=handle.child.kill('SIGTERM');json(path.join(receipts,handle.writerId+'-stop.json'),handle.controlledStop);assert.equal(handle.controlledStop.returned,true);
    const exit=await closed(handle);assert.equal(exit.spawnError,null);assert.ok(exit.signal!==null||exit.code!==0,'Controlled stop must not look like a normal ACK exit');assert.equal(fs.existsSync(handle.config.receiptFile),false,'Stopped writer must not manufacture receipt');return {marker,exit};
  }
  async function cold(base,id,directory){return normal(launch(base,id,'read',directory),['READ']);}
  async function cleanup(base){
    for(const handle of handles.filter(h=>h.group===base&&!h.closed)){
      const detail={writerId:handle.writerId,pid:handle.child.pid,reason:'Unexpected recovery cleanup',requestedAt:new Date().toISOString(),returned:handle.child.kill('SIGKILL')};unexpectedCleanup.push(detail);
      try{detail.exit=await closed(handle);}catch(error){detail.error=error.message;}
    }
  }
  async function group(name,run){
    const base=path.join(out,name.toLowerCase());fs.mkdirSync(base);let record;
    try{const details=await run(base);record={name,status:'PASS',details};}
    catch(error){record={name,status:'FAIL',error:{name:error.name,code:error.code,message:error.message,stack:error.stack,cause:error.cause?{code:error.cause.code,message:error.cause.message}:null}};}
    finally{await cleanup(base);}
    if(unexpectedCleanup.some(item=>handles.find(h=>h.writerId===item.writerId)?.group===base)){record.status='FAIL';record.unexpectedCleanup=true;}
    groups.push(record);json(path.join(base,'group-result.json'),record);process.stdout.write(JSON.stringify({group:name,status:record.status})+'\n');
  }
  function seed(base){const directory=path.join(base,'history'),store=new DirectoryHistory({directory,authority,validateState}),state={revision:1,entries:[entry('base-ack')]},ack=store.commit(state,store.read().head);store.close();return {directory,state,ack,commits:inventory(path.join(directory,'commits')),stages:inventory(path.join(directory,'staging'))};}

  await group(GROUPS[0],async base=>{
    const initial=seed(base),candidate=append(initial.state,'pending-not-promoted');
    const child=launch(base,'before-link-writer','commit',initial.directory,initial.ack.head,candidate,'before-link');const reached=await phase(child,'before-link');
    const stageBeforeStop=inventory(path.join(initial.directory,'staging'));assert.equal(Object.keys(stageBeforeStop).length,2);const stopped=await stop(child,'before-link');
    const fresh=await cold(base,'before-link-cold',initial.directory),read=fresh.receipt.read;
    assert.deepEqual(read.head,initial.ack.head);assert.deepEqual(read.state,initial.state);assert.equal(read.pendingStages,1);const commitsAfter=inventory(path.join(initial.directory,'commits')),stagesAfter=inventory(path.join(initial.directory,'staging'));
    assert.deepEqual(commitsAfter,initial.commits);conserved(initial.stages,stagesAfter);assert.deepEqual(stagesAfter,stageBeforeStop);return {previousAck:initial.ack,phase:reached,stopped,fresh,commitsBefore:initial.commits,commitsAfter,stagesBeforeStop:stageBeforeStop,stagesAfter};
  });
  await group(GROUPS[1],async base=>{
    const initial=seed(base),candidate=append(initial.state,'linked-before-ack');
    const child=launch(base,'committed-writer','commit',initial.directory,initial.ack.head,candidate,'committed');const reached=await phase(child,'committed');
    const commitsBeforeStop=inventory(path.join(initial.directory,'commits')),stagesBeforeStop=inventory(path.join(initial.directory,'staging'));assert.equal(Object.keys(commitsBeforeStop).length,2);conserved(initial.commits,commitsBeforeStop);const stopped=await stop(child,'committed');
    const fresh=await cold(base,'committed-cold',initial.directory),read=fresh.receipt.read;assert.equal(read.head.sequence,2);assert.deepEqual(read.state,candidate);assert.equal(read.pendingStages,0);
    const commitsAfter=inventory(path.join(initial.directory,'commits')),stagesAfter=inventory(path.join(initial.directory,'staging'));assert.deepEqual(commitsAfter,commitsBeforeStop);assert.deepEqual(stagesAfter,stagesBeforeStop);conserved(initial.stages,stagesAfter);return {previousAck:initial.ack,phase:reached,stopped,fresh,commitsBeforeStop,commitsAfter,stagesBeforeStop,stagesAfter};
  });
  await group(GROUPS[2],async base=>{
    const initial=seed(base),release=path.join(base,'race-release');const a=launch(base,'race-a','commit',initial.directory,initial.ack.head,append(initial.state,'race-a'),'before-link',release),b=launch(base,'race-b','commit',initial.directory,initial.ack.head,append(initial.state,'race-b'),'before-link',release);
    const reached=await Promise.all([phase(a,'before-link'),phase(b,'before-link')]);assert.notEqual(a.child.pid,b.child.pid);assert.deepEqual(reached[0].expectedHead,reached[1].expectedHead);const stagedBeforeRace=inventory(path.join(initial.directory,'staging'));assert.equal(Object.keys(stagedBeforeRace).length,3);fs.writeFileSync(release,'release\n',{flag:'wx'});
    const raced=await Promise.all([normal(a,['ACK','CONFLICT']),normal(b,['ACK','CONFLICT'])]);assert.equal(raced.filter(x=>x.receipt.outcome==='ACK').length,1);assert.equal(raced.filter(x=>x.receipt.outcome==='CONFLICT').length,1);const winner=raced.find(x=>x.receipt.outcome==='ACK'),loser=raced.find(x=>x.receipt.outcome==='CONFLICT');assert.equal(loser.receipt.error.code,'HISTORY_CONFLICT');assert.equal(winner.receipt.committed.head.sequence,2);
    const winnerId=winner.receipt.writerId,loserId=loser.receipt.writerId,fresh=await cold(base,'race-refresh',initial.directory);assert.deepEqual(fresh.receipt.read.head,winner.receipt.committed.head);assert.deepEqual(fresh.receipt.read.state,append(initial.state,winnerId));assert.equal(fresh.receipt.read.pendingStages,1);
    const acknowledgedBeforeRetry=inventory(path.join(initial.directory,'commits'));conserved(initial.commits,acknowledgedBeforeRetry);const retryState=append(fresh.receipt.read.state,loserId),retry=await normal(launch(base,'race-loser-retry','commit',initial.directory,fresh.receipt.read.head,retryState),['ACK']);assert.equal(retry.receipt.committed.head.sequence,3);
    const final=await cold(base,'race-final-cold',initial.directory);assert.deepEqual(final.receipt.read.state,retryState);assert.deepEqual(final.receipt.read.state.entries.map(e=>e.id),['base-ack',winnerId,loserId]);assert.equal(final.receipt.read.head.sequence,3);assert.equal(final.receipt.read.pendingStages,1);
    const commitsAfter=inventory(path.join(initial.directory,'commits')),stagesAfter=inventory(path.join(initial.directory,'staging'));conserved(acknowledgedBeforeRetry,commitsAfter);conserved(stagedBeforeRace,stagesAfter);assert.equal(Object.keys(commitsAfter).length,3);assert.equal(Object.keys(stagesAfter).length,4);
    return {expectedHead:initial.ack.head,reached,raced,fresh,retry,final,acknowledgedBeforeRetry,commitsAfter,stagedBeforeRace,stagesAfter};
  });

  let pinError=null;
  try{for(const source of sources){assert.equal(sha(fs.readFileSync(source.original)),source.sha256);assert.equal(sha(fs.readFileSync(source.copy)),source.sha256);}}catch(error){pinError={message:error.message};}
  const allClosed=handles.every(handle=>handle.closed);assert.deepEqual(groups.map(g=>g.name),GROUPS);
  const result={evidenceClass:'HELPER_AUTHOR_ROOT_OPERATED_METADATA_PROCESSES',node:process.version,operatorPid:process.pid,driverSource:import.meta.url,storePin:STORE_PIN,sources,groups,processes,allClosed,unexpectedCleanup,pinError,noEngine:true,noSQL:true,noNativeApp:true,noProviderImport:true,allPassed:groups.every(g=>g.status==='PASS')&&allClosed&&unexpectedCleanup.length===0&&pinError===null,limits:['Actual helper-author metadata process probe, Root-operated; not independent review.','Cold readers import only captured DirectoryHistory; no provider/RPC/engine/browser restart proof.','Intentional stops affect only captured own ChildProcess handles; close events are required, not a successful kill return alone.','No power-loss/directory-fsync/global-orphan guarantee.']};
  json(path.join(out,'RESULT.json'),result);process.stdout.write(JSON.stringify({out,allPassed:result.allPassed,groups:groups.map(g=>({name:g.name,status:g.status})),allClosed,unexpectedCleanup:unexpectedCleanup.length,pinError})+'\n');if(!result.allPassed)process.exitCode=1;return result;
}

async function bootstrap(){
  const label=process.argv[2];assert.equal(process.argv.length,3,'Usage: node scripts/history-process.mjs <fresh-label>');assert.match(label,/^[a-z0-9][a-z0-9-]{0,63}$/);
  const script=fileURLToPath(import.meta.url),scripts=path.dirname(script),stage=path.dirname(scripts),out=path.join(stage,'evidence',label);fs.mkdirSync(out);const executables=path.join(out,'executables');fs.mkdirSync(executables);
  const originals=[['history-process.mjs',script],['fs-writer.mjs',path.join(scripts,'fs-writer.mjs')],['publication-store.mjs',path.join(stage,'provider/src/publication-store.mjs')]],sources=[];
  for(const [name,original]of originals){const stat=fs.lstatSync(original);assert.ok(stat.isFile()&&!stat.isSymbolicLink());const bytes=fs.readFileSync(original),digest=sha(bytes);if(name==='publication-store.mjs')assert.equal(digest,STORE_PIN);const copy=path.join(executables,name);fs.writeFileSync(copy,bytes,{flag:'wx'});assert.equal(sha(fs.readFileSync(copy)),digest);sources.push({name,original,copy,sha256:digest,bytes:bytes.length});}
  json(path.join(out,'SOURCE_PINS.json'),{preparedByPid:process.pid,node:process.version,sources});
  // Import the captured executable copy. Its direct-run guard is false, so all
  // proof logic executes from these frozen bytes without recursive bootstrap.
  const captured=await import(pathToFileURL(path.join(executables,'history-process.mjs')).href);await captured.runProof({out,executables,sources});
}
if(process.argv[1]&&pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url){try{await bootstrap();}catch(error){process.stderr.write(JSON.stringify({fatal:true,name:error.name,code:error.code,message:error.message,stack:error.stack})+'\n');process.exitCode=1;}}
