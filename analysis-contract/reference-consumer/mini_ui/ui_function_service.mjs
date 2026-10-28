import {randomUUID} from 'node:crypto';
import {prepareUiAction,projectUiOutputs} from './ui_function_binding.js';
import {UiFunctionRunner} from './ui_function_runner.mjs';
export class UiFunctionService {
 constructor(options={}){this.runner=options.runner||new UiFunctionRunner(options);this.analysisConsumer=options.analysisConsumer||null;this.activeActions=new Map();}
 async triggerButton(form,values={},options={}){
  const jobId=options.jobId||'ui_'+randomUUID().replaceAll('-','');let prepared,ownsAction=false;
  try{
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(jobId))throw Object.assign(new Error('INVALID_UI_JOB_ID'),{code:'INVALID_UI_JOB_ID'});
   if(this.activeActions.has(jobId))throw Object.assign(new Error('UI_JOB_ALREADY_RUNNING'),{code:'UI_JOB_ALREADY_RUNNING'});
   prepared=prepareUiAction(form,options.buttonId,values);
   const identity={jobId,formId:prepared.formId,buttonId:prepared.buttonId,executionRevision:prepared.executionRevision,valuesRevision:prepared.valuesRevision};
   if(prepared.function.kind==='analysis-workflow'){
    if(!this.analysisConsumer) return {...identity,status:'FAILED',code:'ANALYSIS_PROVIDER_UNAVAILABLE',error:'Analysis execution contract/provider is not connected. No local analytical fallback is used.',outputs:{}};
    this.activeActions.set(jobId,'analysis');ownsAction=true;return await this.analysisConsumer.executeAction(prepared,{jobId});
   }
   this.activeActions.set(jobId,'ui');ownsAction=true;
   const execution=await this.runner.run(prepared.function,prepared.parameterValues,{jobId});
   if(execution.status!=='COMPLETED')return {...identity,status:execution.status,error:execution.error,code:execution.code,outputs:{},execution};
   const outputs=projectUiOutputs(execution.result,prepared);return {...identity,status:'COMPLETED',outputs,execution};
  }catch(e){return {status:'FAILED',jobId,formId:prepared?.formId||form?.formId,buttonId:options.buttonId,executionRevision:prepared?.executionRevision,valuesRevision:prepared?.valuesRevision,outputs:{},code:e.code||'UI_ACTION_REFUSED',error:e.message};}
  finally{if(ownsAction&&!this.analysisConsumer?.active?.has(jobId))this.activeActions.delete(jobId);}
 }
 async cancelJob(jobId){if(this.activeActions.get(jobId)==='analysis'){const result=await this.analysisConsumer.cancelJob(jobId);if(result.stopped)this.activeActions.delete(jobId);return result;}return this.runner.cancelJob(jobId);}
 async close(){for(const id of this.runner.activeJobs.keys()){const cancelled=await this.runner.cancelJob(id);if(!cancelled.stopped)throw new Error('UI_WORKER_STOP_UNCONFIRMED');}return await this.analysisConsumer?.close();}
}
