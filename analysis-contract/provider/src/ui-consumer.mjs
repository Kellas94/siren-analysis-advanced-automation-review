import {checkReference,parameters,verifyResult,canonical,fail} from './contract.mjs';
import {uiParameter} from './consumer-form.mjs';
export class CatalogConsumer {
 constructor(provider){this.provider=provider;this.active=new Map();}
 async executeAction(prepared,{jobId}){
  const fn=prepared.function,entry=checkReference(this.provider.catalog(),fn.reference);
  const expected=Object.entries(entry.parameters.properties).map(([name,s])=>uiParameter(name,s,(entry.parameters.required||[]).includes(name)));
  if(canonical(expected)!==canonical(fn.parameters)||canonical(fn.returns)!==canonical([{name:'result',type:'table',nullable:false}]))fail('BINDING_SIGNATURE_MISMATCH','Form signature differs from pinned capability');
  const values={...prepared.parameterValues};
  for(const [name,schema] of Object.entries(entry.parameters.properties))if(schema.type==='integer'&&!schema['x-wire']&&typeof values[name]==='string'){const n=Number(values[name]);if(!Number.isSafeInteger(n)||BigInt(values[name])!==BigInt(n))fail('INVALID_PARAMETERS','Integer outside safe JSON range');values[name]=n;}
  parameters(entry.parameters,values);
  const receipt=this.provider.execute({requestId:jobId,binding:fn.reference,parameters:values});this.active.set(jobId,receipt.jobId);
  try{
   for(let i=0;i<3000;i++){
    const state=this.provider.status(receipt.jobId);
    if(state.settled){
     const identity={jobId,analysisJobId:receipt.jobId,formId:prepared.formId,buttonId:prepared.buttonId,executionRevision:prepared.executionRevision,valuesRevision:prepared.valuesRevision};
     if(state.status!=='completed')return {...identity,status:state.status==='cancelled'?'CANCELLED':'FAILED',code:state.error?.code,error:state.error?.message,outputs:{},execution:state};
     const result=await verifyResult(state.result),outputs={};
     if(state.jobId!==receipt.jobId||result.provenance.jobId!==receipt.jobId||result.provenance.requestId!==jobId||canonical(result.provenance.workflowRef)!==canonical(entry.workflowRef))fail('RESULT_IDENTITY_MISMATCH','Returned result belongs to another request/workflow/job');
     for(const o of prepared.action.outputs){if(o.mode!=='table'||o.field!=='result')fail('UNSUPPORTED_OUTPUT_BINDING','Analysis table binding required');outputs[o.controlId]={kind:'table',resultId:result.resultId,resultVersion:result.resultVersion,schema:result.schema,rows:result.rows,coverage:result.coverage,provenance:result.provenance,integritySha256:result.integritySha256};}
     return {...identity,status:'COMPLETED',outputs,execution:state};
    }
    await new Promise(r=>setTimeout(r,10));
   }
   fail('STATUS_TIMEOUT','Provider still running; timeout is not execution success');
  }finally{this.active.delete(jobId);}
 }
 async cancelJob(jobId){const id=this.active.get(jobId);if(!id)return {requested:false,confirmed:false,reason:'UI_JOB_NOT_ACTIVE'};return this.provider.cancel(id);}
}
