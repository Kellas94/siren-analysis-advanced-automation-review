// Portable coordinator regressions. Actual tiny files + explicit transport/IO doubles.
// No Electron, native DuckDB, real disk-full, UI or package qualification.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PipelineCompiler} from '../analysis-desktop/engine/pipeline_compiler.js';
import {prepareExport,publishProducedExport} from '../analysis-desktop/engine/export_identity.js';
import {captureExportReceipt} from '../analysis-desktop/registry/src/export_receipt.js';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const out=fs.mkdtempSync(path.join(process.env.SIREN_PROBE_ROOT||os.tmpdir(),'siren-critical-')),records=[];
const record=name=>records.push({name,pass:true});
const helper=fs.readFileSync(path.join(root,'analysis-desktop/desktop/atomic_workflow_save.cjs'),'utf8');
function saveWith(io){const module={exports:{}};vm.runInNewContext(helper,{module,Buffer,require:n=>n==='node:fs'?io:require(n)});return module.exports.atomicSaveWorkflow;}
const target=path.join(out,'workflow.json'),old=Buffer.from('{"saved":"prior"}'),doc={nodes:[{id:'source',data:{text:'00120 😀 =text',zero:0,empty:'',null:null}}],edges:[]},expected=Buffer.from(JSON.stringify(doc,null,2));
fs.writeFileSync(target,old);saveWith(fs)(target,doc);assert(fs.readFileSync(target).equals(expected));record('Exact authored workflow replaces prior saved file');
fs.writeFileSync(target,old);let wrote=false;
assert.throws(()=>saveWith({...fs,writeSync(fd,b,offset,length,position){fs.writeSync(fd,b,offset,Math.min(11,length),position);wrote=true;throw Error('Injected own-stage ENOSPC');}})(target,doc),/ENOSPC/);
assert(wrote);assert(fs.readFileSync(target).equals(old));record('Injected partial staged write preserves prior file');
let mutation=false;
assert.throws(()=>saveWith({...fs,readFileSync(p,...args){const bytes=fs.readFileSync(p,...args);if(path.basename(p).startsWith('.siren-workflow-save-')){const changed=Buffer.from(bytes);changed[changed.indexOf(Buffer.from('00120'))+4]='9'.charCodeAt(0);fs.writeFileSync(p,changed);const stamp=new Date(Date.now()+2000);fs.utimesSync(p,stamp,stamp);mutation=true;}return bytes;}})(target,doc),/WORKFLOW_SAVE_VERIFY/);
assert(mutation);assert(fs.readFileSync(target).equals(old));record('Same-inode staged mutation during readback refuses publication');

const data=path.join(out,'data');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'namesake.csv'),'v\n99\n');
const definition={nodes:[{id:'source',type:'input',data:{format:'CSV',path:'missing/namesake.csv'}}],edges:[]};
const compiled=new PipelineCompiler(definition,{dataDir:data}).compileToSQL(),inputSQL=compiled.find(step=>step.nodeId==='source').sql;
const intended=path.resolve(data,'missing/namesake.csv').replaceAll('\\','/').replaceAll("'","''"),decoy=path.join(data,'namesake.csv').replaceAll('\\','/').replaceAll("'","''");
assert(inputSQL.includes("read_csv('"+intended+"'"));assert(!inputSQL.includes("read_csv('"+decoy+"'"));record('Missing explicit subpath is not rebound to an existing basename');

const destination=path.join(out,'export.csv'),source={nodeId:'source',viewName:'v_source',rowCount:1},sqlPath=p=>p.replaceAll('\\','/').replaceAll("'","''");
const step={nodeId:'export',nodeType:'export',sql:`COPY v_source TO '${sqlPath(destination)}' (FORMAT CSV);`},prepared=prepareExport(step,source);
fs.writeFileSync(prepared.producerFilePath,'v\n11\n');const proof=publishProducedExport(prepared,{jobId:'job_owned',exportNodeId:'export'});
const job={jobId:'job_owned',status:'completed',pipelineDef:{nodes:[{id:'source',type:'input'},{id:'export',type:'export',data:{path:destination,format:'CSV'}}],edges:[{source:'source',target:'export'}]},generatedSQL:[{...step,sql:prepared.sql,exportDestination:destination}],nodeOutputs:{source:{...source,nodeType:'input',isOutdated:false},export:{nodeId:'export',nodeType:'export',isOutdated:false,producerExport:proof}}};
const receipt=captureExportReceipt(job,'source','export');assert.equal(receipt.fileSha256,proof.fileSha256);fs.writeFileSync(destination,'v\n22\n');assert.throws(()=>captureExportReceipt(job,'source','export'));record('Later same-size destination cannot acquire prior producing identity');

// Whole actual runner source with explicit fake fork/timers, never a real child.
let runnerSource=fs.readFileSync(path.join(root,'analysis-desktop/server/runner_service.js'),'utf8');
runnerSource=runnerSource.replace(/^import .*;\r?\n/gm,'').replace(/^const __filename = .*;\r?\n/m,'').replace(/^const __dirname = .*;\r?\n/m,'').replace('export class RunnerService','class RunnerService')+'\nRunnerService;';
const children=[];class Child extends EventEmitter{constructor(){super();this.pid=70000+children.length;this.connected=true;}send(){ }kill(){return true;}}
const context={console:{log(){},warn(){},error(){}},process:{...process,execPath:process.execPath},path,__dirname:path.join(root,'analysis-desktop/server'),fs,JSON,Map,Set,Date,Promise,Math,Error,Object,Buffer,crypto:require('node:crypto'),fork:()=>{const c=new Child();children.push(c);return c;},setTimeout:fn=>({fn,unref(){}}),clearTimeout(){}};
const Runner=new vm.Script(runnerSource).runInNewContext(context),runner=new Runner({dataDir:data});
const make=id=>runner.createJob({nodes:[{id,type:'input',data:{path:'unused.csv'}}],edges:[]});
const a=make('A'),b=make('__proto__');const pa=runner.runJob(a.jobId),pb=runner.runJob(b.jobId);const rejected=assert.rejects(pa);
const first=children[0];first.emit('error',Error('Injected owned transport failure'));first.emit('exit',1,null);await rejected;
for(let i=0;i<10;i++)await Promise.resolve();assert.equal(children.length,2);const second=children[1];
first.emit('message',{type:'COMPLETED',jobId:b.jobId});assert.equal(b.status,'running');
second.emit('message',{type:'STEP_RESULT',jobId:b.jobId,nodeId:'__proto__',nodeType:'input',rowCount:1,preview:[{v:'00120'}],schema:[{name:'v',type:'VARCHAR'}],viewName:'v_safe'});
second.emit('message',{type:'COMPLETED',jobId:b.jobId,telemetry:{}});await pb;
assert.equal(a.status,'failed');assert.equal(b.status,'completed');assert(Object.hasOwn(JSON.parse(JSON.stringify(b.nodeOutputs)),'__proto__'));runner.destroy();
record('Transport error then exit rejects A, queued B completes, stale child cannot settle B and own-key output survives');
assert.equal(records.length,6);console.log(JSON.stringify({pass:true,scope:'Coordinator portable source/model/actual-file regression; not independent acceptance or native execution',records,outputDirectory:out},null,2));
