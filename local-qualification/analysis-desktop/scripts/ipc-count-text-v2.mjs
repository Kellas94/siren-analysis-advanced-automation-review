import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {RunnerService} from '../candidate/analysis/server/runner_service.js';
import {countSchema,countModel,countIfModel,countDefinition,writeCountData} from '../count-fixture.mjs';
import {writeTextData,textDefinition,expectedText,textCounts,lookupSchema} from '../text-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]);assert(out.startsWith(path.join(root,'evidence')+path.sep));fs.mkdirSync(out);
const runner=new RunnerService({dataDir:out,tempDir:path.join(out,'temp'),maxMemory:'512MB',threads:2}),records=[],children=[];let index=0;
const track=()=>{const child=runner.worker;if(child&&!children.some(r=>r.child===child)){const row={child,pid:child.pid};row.done=new Promise(resolve=>child.once('close',(code,signal)=>{row.code=code;row.signal=signal;resolve();}));children.push(row);}};track();const init=runner.initWorker.bind(runner);runner.initWorker=()=>{init();track();};
const save=(name,value)=>{const p=path.join(out,name+'.json');assert(!fs.existsSync(p));fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');};
fs.copyFileSync(import.meta.filename,path.join(out,'executed-probe.mjs'));fs.copyFileSync(path.join(root,'count-fixture.mjs'),path.join(out,'executed-fixture.mjs'));fs.copyFileSync(path.join(root,'text-fixture.mjs'),path.join(out,'executed-text-fixture.mjs'));
const source=path.join(out,'counts.csv');writeCountData(source);
async function run(def){const job=runner.createJob(def);try{await runner.runJob(job.jobId);}catch{}const result=runner.getJob(job.jobId);save('job-'+(++index),result);return result;}
function scalar(job,value){assert.equal(job.status,'completed');assert.equal(job.telemetry.totalSourceRows,80);const o=job.nodeOutputs.counted;assert.equal(o.rowCount,1);assert.deepEqual(o.schema.map(c=>({name:c.name,type:c.type})),[{name:'conditional_count',type:'BIGINT'}]);assert.deepEqual(o.preview,[{conditional_count:String(value)}]);return o;}
const pass=(name,job,details={})=>{records.push({name,pass:true,jobId:job.jobId,...details});console.log(JSON.stringify({pass:name}));};
let finished=false,fatal=null;
try{
 for(const [column,total]of [['num',64],['big',68],['u64',80],['u128',80],['s128',80],['floating',66],['quoted"amount',80],['numeric_text',80],['text',60],['flag',80]]){const job=await run(countDefinition(source,countModel(column)));scalar(job,total);pass('COUNT non-NULL scalar '+column,job,{expected:String(total)});}
 for(const [label,model,total]of [
  ['last20',countIfModel('id','gte','60'),20],['NULL',countIfModel('text','isNull'),20],['empty-text',countIfModel('text','isEmpty'),20],
  ['equals-literal',countIfModel('text','eq','=SUM(A1:A2)'),20],['false',countIfModel('flag','eq',false),53],
  ['zero',countIfModel('num','eq','0'),16],['zero-including-NULL',countIfModel('num','eq','0',{nulls:'include'}),32],
  ['list',countIfModel('text','in',['KEEP','=SUM(A1:A2)']),40],['exclude-list',countIfModel('text','notIn',['KEEP','=SUM(A1:A2)']),20],
  ['no-match',countIfModel('num','eq','9999'),0]
 ]){const job=await run(countDefinition(source,model));scalar(job,total);const visible=label==='last20'?job.nodeOutputs.typed.preview.filter(r=>r.id>=60).length:null;pass('COUNTIF '+label,job,{expected:String(total),upstreamPreviewRows:job.nodeOutputs.typed.preview.length,visibleMatches:visible});if(label==='last20')assert(visible<total);}
 for(const model of [countModel(),countIfModel('id','gte','0')]){const job=await run(countDefinition(source,model,countSchema,{empty:true}));scalar(job,0);assert.equal(job.nodeOutputs.empty.rowCount,0);pass(model.operation+' empty input returns BIGINT zero in one row',job,{expected:'0'});}
 for(const [label,model]of [['extra COUNT criteria',{...countModel(),criteria:{}}],['COUNTIF two rules',{...countIfModel('id','gte','0'),criteria:{version:'analysis.criteria/1',op:'and',rules:[{column:'id',operator:'isNotNull'},{column:'num',operator:'isNotNull'}]}}]]){
  const job=await run(countDefinition(source,model));assert.equal(job.status,'failed');assert.deepEqual(job.nodeOutputs,{});assert.deepEqual(job.generatedSQL,[]);pass('Refuse '+label+' before SQL/results',job);
 }
 const stale=countSchema.map(c=>({...c,type:c.name==='num'?'BIGINT':c.type})),bad=await run(countDefinition(source,countModel(),stale));assert.equal(bad.status,'failed');assert.match(bad.error,/FUNCTION_INPUT_SCHEMA_CHANGED/);assert.equal(bad.nodeOutputs.counted,undefined);pass('Actual upstream schema drift refuses before Count output',bad);
 const retry=await run(countDefinition(source));scalar(retry,64);pass('Current-schema retry succeeds on retained worker',retry,{expected:'64'});
 const combined=await run(textDefinition(writeTextData(out)));assert.equal(combined.status,'completed');assert.equal(combined.telemetry.totalSourceRows,90);assert.equal(combined.nodeOutputs.lookup.rowCount,80);assert.equal(combined.nodeOutputs.lookup.preview.length,50);assert.deepEqual(combined.nodeOutputs.lookup.schema.map(c=>({name:c.name,type:c.type})),lookupSchema);
 for(const row of combined.nodeOutputs.lookup.preview){const wanted=expectedText(row.id);for(const [name,value]of Object.entries(wanted))assert.equal(row[name],value);assert.equal(row.numeric_text,'00120');}
 for(const [id,value]of Object.entries(textCounts)){const o=combined.nodeOutputs[id];assert.equal(o.rowCount,1);assert.deepEqual(o.schema.map(c=>({name:c.name,type:c.type})),[{name:'conditional_count',type:'BIGINT'}]);assert.deepEqual(o.preview,[{conditional_count:value}]);}
 pass('Full text LEFT RIGHT MID Filter Lookup and scalar Count preserve exact text identities',combined,{counts:textCounts,sourceRows:90,resultRows:80,previewRows:50});
 assert.equal(records.length,27);finished=true;
}catch(error){fatal={message:error.message,stack:error.stack};throw error;}
finally{runner.destroy();await Promise.all(children.map(c=>c.done));save('RESULT',{kind:'Root direct Node service to actual worker IPC; no desktop UI or independent operator',finished,records,fatal,jobs:index,workers:children.map(({pid,code,signal})=>({pid,code,signal}))});}
