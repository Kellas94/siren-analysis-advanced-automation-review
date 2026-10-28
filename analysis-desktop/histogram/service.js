import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {RunnerService} from '../server/runner_service.js';
import {retainedMeasure} from './typed_input.js';
import {buildHistogramAggregationExprs,validateBinEdges,sealHistogramJob,createHistogramDefinition} from './producer.js';
import {writeJsonAtomic} from '../registry/src/atomic_fs.js';
const C=createRequire(import.meta.url)('../chart-core.cjs');
export class HistogramService {
  constructor({bridge,workDir,exportDir}){this.bridge=bridge;this.workDir=workDir;this.exportDir=exportDir;this.active=null;this.used=new Set();this.cancelled=new Set();this.stopping=false}
  cancel(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('HISTOGRAM_OPERATION_ID');const a=this.active;if(a?.id===id&&a.published)return {requested:false,status:'saved'};this.cancelled.add(id);if(!a||a.id!==id)return {requested:true};a.cancelled=true;if(a.job)a.runner.cancelJob(a.job.jobId);a.runner.destroy();return {requested:true}}
  async destroy(){this.stopping=true;const a=this.active;if(a){this.cancel(a.id);a.runner.destroy();await Promise.all(a.children.map(c=>c.closed))}}
  async start(request){
    if(this.stopping)throw Error('HISTOGRAM_STOPPING');if(this.active)throw Error('HISTOGRAM_BUSY: există deja o histogramă în curs.');
    const {operationId:id,resultId,expectedIntegrity,measure,edges}=request||{};
    if(this.cancelled.has(id))throw Error('HISTOGRAM_CANCELLED');
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||this.used.has(id))throw Error('HISTOGRAM_OPERATION_ID');
    if(typeof expectedIntegrity!=='string'||!/^[a-f0-9]{64}$/.test(expectedIntegrity))throw Error('RESULT_REVISION_REQUIRED');
    const record=this.bridge.open(resultId,expectedIntegrity);retainedMeasure(record,measure);validateBinEdges(edges);this.used.add(id);
    const work=path.join(this.workDir,id);fs.mkdirSync(work,{recursive:true});
    const runner=new RunnerService({dataDir:work,tempDir:path.join(work,'temp'),threads:2,maxMemory:'512MB'});
    const a={id,runner,cancelled:false,published:false,children:[],job:null};this.active=a;
    const track=child=>{if(child&&!a.children.some(c=>c.child===child)){const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal})));a.children.push({child,closed})}};
    track(runner.worker);const init=runner.initWorker;runner.initWorker=function(){const v=init.call(this);track(this.worker);return v};
    const ensure=()=>{if(a.cancelled||this.stopping)throw Error('HISTOGRAM_CANCELLED')};
    try{
      const def={nodes:[{id:'retained_input',type:'input',data:{retainedResult:record,retainedMeasure:measure}},{id:'hist_agg',type:'aggregate',data:{groupBy:[],aggregations:buildHistogramAggregationExprs(measure,edges)}}],edges:[{source:'retained_input',target:'hist_agg'}]};
      a.job=runner.createJob(def);await runner.runJob(a.job.jobId);ensure();
      const unit=record.schema.find(c=>c.name===measure)?.unit??null;
      const sealed=sealHistogramJob({job:a.job,sourceNodeId:'retained_input',histNodeId:'hist_agg',measureColumn:measure,edges,unit});
      const boundDefinition={...a.job.pipelineDef,nodes:a.job.pipelineDef.nodes.map(n=>n.id==='retained_input'?{...n,data:{retainedResultId:record.resultId,retainedIntegritySha256:record.integritySha256,retainedMeasure:measure}}:n)};
      const snapshot={...sealed,source:{...sealed.source,sourceId:'registry:'+record.resultId,origin:{...sealed.source.origin,pipelineDef:boundDefinition,retainedResultId:record.resultId,retainedIntegritySha256:record.integritySha256,retainedJobId:record.job.jobId,retainedSourceSchema:record.schema,retainedCounts:record.counts}},coverage:{...sealed.coverage,aggregation:{...sealed.coverage.aggregation,populationBasis:'complete-retained-result-rows',originalSourceRowCount:record.counts.sourceRowCount,weighting:'none'}}};
      const definition=createHistogramDefinition(snapshot);definition.appearance='light';const file=await C.pack(snapshot,definition);await C.unpack(JSON.stringify(file));ensure();
      fs.mkdirSync(this.exportDir,{recursive:true});const chartFilePath=path.join(this.exportDir,id+'.sirenchart.json'),receiptPath=path.join(this.exportDir,id+'.histogram-receipt.json');
      const receipt={schemaVersion:'siren.retained-histogram/1',operationId:id,resultId:record.resultId,registryIntegritySha256:record.integritySha256,originalJobId:record.job.jobId,histogramJobId:a.job.jobId,measure,edges,unit,populationBasis:'complete-retained-result-rows',retainedCounts:record.counts,snapshotSha256:file.snapshotSha256,integritySha256:file.integritySha256};
      writeJsonAtomic(chartFilePath,file);writeJsonAtomic(receiptPath,receipt);a.published=true;return {status:'saved',chartFilePath,receiptPath,...receipt,bins:file.snapshot.rows.map(r=>({start:r.values.bin_start,end:r.values.bin_end,count:r.values.count})),nullCount:file.snapshot.coverage.aggregation.nullCount,observationCount:file.snapshot.coverage.aggregation.totalCount};
    }catch(e){if(a.cancelled||this.stopping)throw Error('HISTOGRAM_CANCELLED');throw e}
    finally{runner.destroy();await Promise.all(a.children.map(c=>c.closed));runner.jobs.clear();a.job=null;if(this.active===a)this.active=null}
  }
}
