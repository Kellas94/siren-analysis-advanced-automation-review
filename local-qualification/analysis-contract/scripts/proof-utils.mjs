// Root proof helpers: actual copied consumer/service/RPC, not a second data engine.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {AnalysisNodeTransport} from '../reference-consumer/mini_ui/analysis_node_transport.mjs';
import {AnalysisCatalogConsumer} from '../reference-consumer/mini_ui/analysis_catalog_consumer.mjs';
import {UiFunctionService} from '../reference-consumer/mini_ui/ui_function_service.mjs';
import {createFormDocument,createControl} from '../reference-consumer/mini_ui/ui_form_model.js';
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const walk=d=>fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.isFile()?[path.join(d,e.name)]:[]);
export const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export const save=(dir,name,value)=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function sourcePins(root,providerRoot=path.join(root,'provider'),bootstrap=path.join(root,'scripts/bootstrap.mjs')){return[...walk(providerRoot),...walk(path.join(root,'reference-consumer')),...walk(path.join(root,'legacy-consumer')),bootstrap].map(p=>({path:p,sha256:sha(fs.readFileSync(p))}));}
export function connect(configFile,out,label){
 const transport=new AnalysisNodeTransport(configFile),seen=new Set();
 const remote={ownedSession:true,catalog:()=>transport.catalog(),execute:r=>transport.execute(r),cancel:id=>transport.cancel(id),close:()=>transport.close(),status:async id=>{const s=await transport.status(id);if(s.settled&&!seen.has(id)){seen.add(id);save(out,label+'-raw-'+id,s);}return s;}};
 const consumer=new AnalysisCatalogConsumer(remote),service=new UiFunctionService({analysisConsumer:consumer,runner:{activeJobs:new Map(),run(){throw Error('No UI analytical fallback');},cancelJob(){return{stopped:true,success:false};}}});return{transport,consumer,service,label};
}
export function form(entry){
 assert(entry.executable);const f=createFormDocument(entry.name),inputs={};f.formId='durable_history_form';for(const [i,p]of entry.parameters.entries()){const id='parameter_'+i;f.controls.push(createControl(p.type==='boolean'?'checkbox':p.type==='string'?'text':'number',{id,label:p.name,dataType:p.type,defaultValue:p.default??'',required:p.required,position:{x:20,y:20+i*80}}));inputs[p.name]=id;}
 f.controls.push(createControl('button',{id:'run',label:'Run Analysis'}),createControl('table',{id:'table',label:'Actual result'}));f.functions=[{id:'analysis_action',name:entry.name,kind:'analysis-workflow',reference:structuredClone(entry.reference),parameters:structuredClone(entry.parameters),returns:structuredClone(entry.returns)}];f.actions=[{id:'action',buttonId:'run',functionId:'analysis_action',inputs,outputs:[{controlId:'table',field:'result',mode:'table'}]}];return f;
}
export async function run(connection,doc,id,out,values={}){const r=await connection.service.triggerButton(doc,values,{buttonId:'run',jobId:id});save(out,id,r);return r;}
export function scalar(result,value,unit='rows'){assert.equal(result.status,'COMPLETED',JSON.stringify(result));const t=result.outputs.table;assert.deepEqual(t.rows,[{conditional_count:String(value)}]);assert.equal(t.coverage.sourceRows,90);assert.equal(t.coverage.resultRows,1);assert.equal(t.coverage.transferredRows,1);assert.equal(t.coverage.status,'COMPLETE');assert.deepEqual(t.schema.map(c=>[c.name,c.dbType,c.wireSchema,c.unit]),[['conditional_count','BIGINT',{type:'string','x-wire':'int64'},unit]]);return t;}
export async function close(connection,out,label=connection.label){const receipt=await connection.service.close();save(out,label+'-close',receipt);save(out,label+'-transport',{exit:connection.transport.exit,closed:connection.transport.closed,ready:connection.transport.ready,providerAdmitted:connection.transport.providerAdmitted,logs:connection.transport.logs});assert.equal(receipt.closed,true);assert.equal(receipt.host.code,0);assert.equal(receipt.host.signal,null);assert(receipt.receipts.every(x=>x.closed));assert.equal(connection.consumer.active.size,0);assert.equal(connection.service.activeActions.size,0);return receipt;}
