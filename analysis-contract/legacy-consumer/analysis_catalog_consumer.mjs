import {CONTRACT,CATALOG,checkReference,createBinding,parameters,validateResult,canonical,fail} from './analysis_contract_reference.mjs';
import {createHash} from 'node:crypto';
const clone=structuredClone;
function parameterView(name,schema,required){
 const type=schema['x-wire']==='decimal'?'decimal':schema['x-wire']==='int64'?'integer':schema.type;
 if(!['string','number','integer','decimal','boolean'].includes(type)||schema.nullable)fail('UNSUPPORTED_BINDING_TYPE','No supported widget for parameter '+name+' yet; no coercion or fallback.');
 return {name,type,required,...(Object.hasOwn(schema,'default')?{default:clone(schema.default)}:{})};
}
function signature(entry){return Object.entries(entry.parameters?.properties||{}).map(([name,s])=>parameterView(name,s,(entry.parameters.required||[]).includes(name)));}
function pinFields(list){return list.map(p=>({name:p.name,type:p.type,required:p.required,...(Object.hasOwn(p,'default')?{default:p.default}:{})}));}
function canonicalDecimal(text){const negative=text.startsWith('-');text=text.replace(/^[+-]/,'');const [whole,fraction]=text.split('.');return (negative?'-':'')+BigInt(whole||'0').toString()+(fraction?'.'+fraction:'');}
function same(a,b){return canonical(a)===canonical(b);}
export class AnalysisCatalogConsumer {
 constructor(provider){this.provider=provider;this.active=new Map();this.completed=new Map();}
 async getCatalog(){
  try{
   const catalog=await this.provider.catalog();
   if(catalog.contractVersion!==CONTRACT)fail('INCOMPATIBLE_CONTRACT','Unsupported Analysis execution contract: '+catalog.contractVersion);
   if(catalog.schemaVersion!==CATALOG||catalog.catalogId!=='siren.analysis'||typeof catalog.catalogVersion!=='string'||!Array.isArray(catalog.capabilities))fail('INVALID_CATALOG','Analysis catalog identity/schema is invalid.');
   const ids=new Set();
   const capabilities=catalog.capabilities.map(entry=>{
    const key=entry.id+'@'+entry.version;if(ids.has(key))fail('INVALID_CATALOG','Duplicate capability identity/version.');ids.add(key);
    let fields=[],reference=null,reason=null,supported=true;
    const implemented=entry.availability?.contract==='IMPLEMENTED'&&entry.invocation?.kind==='registered-workflow';
    if(implemented){try{fields=signature(entry);reference=createBinding(catalog,entry);checkReference(catalog,reference);}catch(e){supported=false;reason=e.message;}}
    else reason=entry.availability?.contract==='PROPOSED'?'Proposed capability; no executable contract adapter.':'No executable common-contract adapter; prototype status is shown separately.';
    return {id:entry.id,version:entry.version,name:entry.title,description:entry.description,status:entry.availability?.contract||'UNKNOWN',availability:clone(entry.availability||{}),executable:implemented&&supported,bindingSupported:supported,parameters:fields,parameterSchema:clone(entry.parameters),returns:[{name:'result',type:'table',nullable:false}],result:clone(entry.result),limits:clone(entry.limits||[]),execution:clone(entry.execution||{}),reference,reason};
   });
   return {status:'CONNECTED',catalogId:catalog.catalogId,catalogVersion:catalog.catalogVersion,catalogSha256:catalog.catalogSha256,contractVersion:catalog.contractVersion,capabilities};
  }catch(e){return {status:e.code==='INCOMPATIBLE_CONTRACT'?'INCOMPATIBLE':'UNAVAILABLE',code:e.code||'ANALYSIS_DISCOVERY_FAILED',error:e.message,capabilities:[]};}
 }
 async executeAction(prepared,{jobId}){
  if(this.active.has(jobId))fail('UI_JOB_ALREADY_RUNNING','This consumer request is already active.');
  const state={cancelRequested:false,analysisJobId:null,finished:null,dispatchStarted:false};let finish;state.finished=new Promise(r=>finish=r);this.active.set(jobId,state);
  const identity={jobId,formId:prepared.formId,buttonId:prepared.buttonId,executionRevision:prepared.executionRevision,valuesRevision:prepared.valuesRevision};let outcome;
  try{
   const catalog=await this.provider.catalog();
   if(catalog.contractVersion!==CONTRACT)fail('INCOMPATIBLE_CONTRACT','Analysis contract changed; review the saved reference explicitly.');
   const entry=checkReference(catalog,prepared.function.reference),expected=signature(entry);
   if(!same(pinFields(expected),pinFields(prepared.function.parameters))||!same(prepared.function.returns,[{name:'result',type:'table',nullable:false}]))fail('BINDING_SIGNATURE_MISMATCH','Saved form signature differs from the pinned capability.');
   const values=clone(prepared.parameterValues);
   for(const [name,schema] of Object.entries(entry.parameters.properties)){
    if(!Object.hasOwn(values,name))continue;
    if(schema.type==='integer'&&!schema['x-wire']&&typeof values[name]==='string'){const n=Number(values[name]);if(!Number.isSafeInteger(n)||BigInt(values[name])!==BigInt(n))fail('INVALID_PARAMETERS','Integer is outside safe JSON range.');values[name]=n;}
    if(schema['x-wire']==='decimal'&&typeof values[name]==='string')values[name]=canonicalDecimal(values[name]);
   }
   parameters(entry.parameters,values);
   if(state.cancelRequested)return outcome={...identity,status:'CANCELLED',outputs:{},execution:{stopped:true,reason:'CANCELLED_BEFORE_ANALYSIS_ADMISSION'}};
   state.dispatchStarted=true;
   const receipt=await this.provider.execute({requestId:jobId,binding:clone(prepared.function.reference),parameters:values});
   if(receipt.contractVersion!==CONTRACT||receipt.requestId!==jobId||typeof receipt.jobId!=='string'||!receipt.jobId||!same(receipt.workflowRef,prepared.function.reference.workflowRef))fail('ANALYSIS_RECEIPT_IDENTITY_MISMATCH','Analysis admission returned a different request/workflow identity.');
   state.analysisJobId=receipt.jobId;
   if(state.cancelRequested)await this.provider.cancel(receipt.jobId);
   for(;;){
    const status=await this.provider.status(receipt.jobId);
    if(status.jobId!==receipt.jobId||status.requestId!==jobId||status.contractVersion!==CONTRACT||!same(status.workflowRef,receipt.workflowRef))fail('ANALYSIS_RECEIPT_IDENTITY_MISMATCH','Analysis status identity differs from the admitted request.');
    if(status.settled){
     if(status.status!=='completed')return outcome={...identity,analysisJobId:receipt.jobId,status:status.status==='cancelled'?'CANCELLED':'FAILED',code:status.error?.code,error:status.error?.message||status.status,outputs:{},execution:status};
     const result=validateResult(status.result);
     if(result.provenance.jobId!==receipt.jobId||result.provenance.requestId!==jobId||!same(result.provenance.workflowRef,receipt.workflowRef))fail('ANALYSIS_RESULT_IDENTITY_MISMATCH','Result provenance differs from the admitted request.');
     const {integritySha256,...body}=result,hash=createHash('sha256').update(canonical(body)).digest('hex');if(integritySha256!==hash)fail('ANALYSIS_RESULT_INTEGRITY_MISMATCH','Result integrity digest differs.');
     if(result.rows.length>50)fail('ANALYSIS_PREVIEW_LIMIT_EXCEEDED','The current owner contract permits at most 50 transferred preview rows.');
     const outputs=Object.fromEntries(prepared.action.outputs.map(o=>{if(o.mode!=='table'||o.field!=='result')fail('UNSUPPORTED_OUTPUT_BINDING','Select the Analysis result table.');return [o.controlId,{kind:'table',...clone(result),rowCount:result.coverage.resultRows,returnedRows:result.coverage.transferredRows}];}));
     return outcome={...identity,analysisJobId:receipt.jobId,status:'COMPLETED',outputs,execution:status};
    }
    await new Promise(r=>setTimeout(r,25));
   }
  }catch(e){
   let stopped=!state.dispatchStarted,details;
   if(state.analysisJobId)try{details=await this.provider.cancel(state.analysisJobId);stopped=details.confirmed||['completed','failed','cancelled'].includes(details.status);}catch{}
   if(!stopped&&this.provider.ownedSession===true)try{const closed=await this.provider.close();stopped=closed?.closed===true;details={...details,ownedSessionClose:closed};}catch{}
   return outcome={...identity,analysisJobId:state.analysisJobId,status:'FAILED',code:e.code||'ANALYSIS_EXECUTION_FAILED',error:e.message,outputs:{},execution:{stopped,cancellation:details}};
  }finally{
   const stopped=outcome?.execution?.stopped!==false;
   state.outcome=outcome;
   if(stopped){this.active.delete(jobId);this.completed.set(jobId,{status:outcome?.status,stopped:true});if(this.completed.size>1000)this.completed.delete(this.completed.keys().next().value);}
   finish(outcome);
  }
 }
 async cancelJob(jobId){
  const state=this.active.get(jobId);if(!state)return {success:false,stopped:!!this.completed.get(jobId),reason:'NOT_ACTIVE',...this.completed.get(jobId)};
  state.cancelRequested=true;
  if(!state.analysisJobId){const result=await state.finished;return {success:result?.status==='CANCELLED',stopped:result?.execution?.stopped!==false,status:result?.status,jobId};}
  const receipt=await this.provider.cancel(state.analysisJobId),stopped=receipt.confirmed||['completed','failed','cancelled'].includes(receipt.status);
  if(stopped){this.active.delete(jobId);this.completed.set(jobId,{status:receipt.status==='cancelled'?'CANCELLED':receipt.status.toUpperCase(),stopped:true});}
  return {success:receipt.confirmed&&receipt.status==='cancelled',stopped,jobId,analysisJobId:state.analysisJobId,details:receipt};
 }
 async close(){return this.provider.close?.();}
}
