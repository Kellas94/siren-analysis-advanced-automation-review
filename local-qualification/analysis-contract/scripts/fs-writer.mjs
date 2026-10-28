// Helper-author, Root-operated metadata worker. No provider/engine/app imports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const STORE_PIN='53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618';
const configFile=path.resolve(process.argv[2]||'');
const configBytes=fs.readFileSync(configFile);assert.ok(configBytes.length<=65536,'Bounded owned worker config');
let config=JSON.parse(configBytes.toString('utf8'));
const root=path.resolve(config.root);
const inside=file=>{assert.equal(typeof file,'string');const absolute=path.resolve(file),relative=path.relative(root,absolute);assert.ok(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'Path outside owned evidence');return absolute;};
inside(configFile);assert.equal(config.protocol,'history-process-worker/1');assert.match(config.writerId,/^[a-z0-9-]{1,64}$/);assert.ok(['commit','read'].includes(config.mode));
const expectedKeys=['protocol','root','writerId','mode','directory','authority','expectedHead','state','gatePhase','markerFile','releaseFile','receiptFile','sourcePins'];assert.deepEqual(Object.keys(config).sort(),expectedKeys.sort());
const directory=inside(config.directory),marker=inside(config.markerFile),release=inside(config.releaseFile),receiptFile=inside(config.receiptFile);
const executableRoot=path.join(root,'executables');
assert.equal(fs.realpathSync(fileURLToPath(import.meta.url)),fs.realpathSync(path.join(executableRoot,'fs-writer.mjs')),'Execute only captured own worker');
const sourceNames=['history-process.mjs','fs-writer.mjs','publication-store.mjs'];const observedPins={};
for(const name of sourceNames){const file=inside(path.join(executableRoot,name)),stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Regular captured source only');observedPins[name]=sha(fs.readFileSync(file));assert.equal(observedPins[name],config.sourcePins[name]);}
assert.equal(observedPins['publication-store.mjs'],STORE_PIN);
const {DirectoryHistory,strictHistoryJson}=await import(pathToFileURL(path.join(executableRoot,'publication-store.mjs')).href);
config=strictHistoryJson(config);
if(config.mode==='read'){assert.equal(config.state,null);assert.equal(config.expectedHead,null);assert.equal(config.gatePhase,null);}
else assert.ok(config.gatePhase===null||['before-link','committed'].includes(config.gatePhase));
const configSha256=sha(configBytes),phases=[];
function validateState(state,previous){
  assert.deepEqual(Object.keys(state).sort(),['entries','revision']);assert.ok(Number.isSafeInteger(state.revision)&&state.revision>0);assert.ok(Array.isArray(state.entries));assert.equal(state.revision,state.entries.length);assert.equal(state.revision,(previous?.revision??0)+1);
  const ids=new Set();for(const entry of state.entries){assert.deepEqual(Object.keys(entry).sort(),['empty','flag','id','identifier','nullable','precision','wide']);assert.equal(typeof entry.id,'string');assert.ok(!ids.has(entry.id));ids.add(entry.id);assert.equal(entry.identifier,'00120');assert.equal(entry.wide,'9007199254740993');assert.equal(entry.precision,'9999999999999999999999999999.1234567890');assert.equal(entry.empty,'');assert.equal(entry.flag,false);assert.equal(entry.nullable,null);}
  if(previous)assert.deepEqual(state.entries.slice(0,-1),previous.entries);
}
const identity={writerId:config.writerId,pid:process.pid,node:process.version,configSha256,sourcePins:observedPins};
let history,outcome;
try{
  history=new DirectoryHistory({directory,authority:config.authority,validateState,onPhase(phase){
    phases.push(phase);process.stdout.write(JSON.stringify({event:'phase',writerId:config.writerId,pid:process.pid,phase})+'\n');
    if(phase!==config.gatePhase)return;
    fs.writeFileSync(marker,JSON.stringify({...identity,phase,expectedHead:config.expectedHead},null,2)+'\n',{flag:'wx'});
    const deadline=Date.now()+30000;
    while(!fs.existsSync(release)){
      if(Date.now()>deadline)throw Object.assign(Error('Owned metadata phase gate timeout'),{code:'PROBE_GATE_TIMEOUT'});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
  }});
  const before=history.read();
  if(config.mode==='read')outcome={...identity,outcome:'READ',read:before,phases};
  else{const committed=history.commit(config.state,config.expectedHead);outcome={...identity,outcome:'ACK',before,committed,phases};}
}catch(error){outcome={...identity,outcome:error.code==='HISTORY_CONFLICT'?'CONFLICT':'ERROR',error:{name:error.name,code:error.code,message:error.message,cause:error.cause?{code:error.cause.code,message:error.cause.message}:null},phases};if(outcome.outcome==='ERROR')process.exitCode=1;}
finally{history?.close();}
fs.writeFileSync(receiptFile,JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({event:'receipt',writerId:config.writerId,pid:process.pid,outcome:outcome.outcome})+'\n');
