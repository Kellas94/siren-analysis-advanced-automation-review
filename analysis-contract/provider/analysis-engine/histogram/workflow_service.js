import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {HistogramService} from './service.js';
import {RunnerService} from '../server/runner_service.js';
import {describeWorkflowSelection,prepareWorkflowSelection} from './selection.js';
import {buildHistogramAggregationExprs,validateBinEdges,validateMeasureColumnSchema,sealHistogramJob,createHistogramDefinition} from './workflow_producer.js';
import {writeJsonAtomic} from '../registry/src/atomic_fs.js';
const C=createRequire(import.meta.url)('../chart-core.cjs');
export class WorkflowHistogramService extends HistogramService {
 constructor(options){super(options);this.getJob=options.getJob;}
 describe({jobId,nodeId}){return describeWorkflowSelection(this.getJob(jobId),nodeId);}
 async startWorkflow(request){
  if(this.stopping)throw Error('HISTOGRAM_STOPPING');if(this.active)throw Error('HISTOGRAM_BUSY');
  const {operationId:id,jobId,nodeId,expectedSelectionSha256,measure,edges}=request||{};
  if(this.cancelled.has(id))throw Error('HISTOGRAM_CANCELLED');
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||this.used.has(id))throw Error('HISTOGRAM_OPERATION_ID');
  const selected=prepareWorkflowSelection(this.getJob(jobId),{nodeId,expectedSelectionSha256,measure});validateBinEdges(edges);this.used.add(id);
  const def=selected.pipelineDef;let histNodeId='siren_hist_'+id.replaceAll('-','_');
  if(def.nodes.some(n=>n.id.replace(/[^a-zA-Z0-9_]/g,'_')===histNodeId))throw Error('WORKFLOW_HISTOGRAM_NODE_COLLISION');
  def.nodes.push({id:histNodeId,type:'aggregate',data:{groupBy:[],aggregations:buildHistogramAggregationExprs(measure,edges)}});def.edges.push({source:nodeId,target:histNodeId});
  const work=path.join(this.workDir,id);fs.mkdirSync(work,{recursive:true});
  const runner=new RunnerService({dataDir:work,tempDir:path.join(work,'temp'),threads:2,maxMemory:'512MB'});
  const a={id,runner,cancelled:false,published:false,children:[],job:null};this.active=a;
  const track=child=>{if(child&&!a.children.some(c=>c.child===child)){const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal})));a.children.push({child,closed})}};
  track(runner.worker);const init=runner.initWorker;runner.initWorker=function(){const v=init.call(this);track(this.worker);return v};
  const ensure=()=>{if(a.cancelled||this.stopping)throw Error('HISTOGRAM_CANCELLED')};
  try{
   a.job=runner.createJob(def);await runner.runJob(a.job.jobId);ensure();
   const actual=validateMeasureColumnSchema(a.job.nodeOutputs[nodeId]?.schema,measure);
   if(actual.type!==selected.column.type)throw Error('WORKFLOW_SOURCE_SCHEMA_CHANGED: rulează fluxul din nou și selectează schema actuală.');
   const unit=a.job.nodeOutputs[nodeId].schema.find(c=>(c.name??c.columnName)===measure)?.unit??null;
   const sealed=sealHistogramJob({job:a.job,sourceNodeId:nodeId,histNodeId,measureColumn:measure,edges,unit});
   const snapshot={...sealed,source:{...sealed.source,origin:{...sealed.source.origin,executionMode:'new-execution-of-selected-completed-definition',selectedJobId:jobId,selectedCompletedAt:selected.descriptor.completedAt,selectedDefinitionSha256:selected.descriptor.definitionSha256,selectedSelectionSha256:expectedSelectionSha256,selectedPriorRowCount:selected.descriptor.priorRowCount,inputExecutionBindings:selected.descriptor.inputBindings}},coverage:{...sealed.coverage,aggregation:{...sealed.coverage.aggregation,populationBasis:'new-execution-selected-result-rows',weighting:'none'}}};
   const definition=createHistogramDefinition(snapshot);definition.appearance='light';const file=await C.pack(snapshot,definition);await C.unpack(JSON.stringify(file));ensure();
   fs.mkdirSync(this.exportDir,{recursive:true});const chartFilePath=path.join(this.exportDir,id+'.sirenchart.json'),receiptPath=path.join(this.exportDir,id+'.workflow-histogram-receipt.json');
   const receipt={schemaVersion:'siren.workflow-histogram/1',operationId:id,selectedJobId:jobId,nodeId,selectionSha256:expectedSelectionSha256,selectedDefinitionSha256:selected.descriptor.definitionSha256,histogramJobId:a.job.jobId,resultVersion:snapshot.source.resultVersion,measure,measureType:actual.type,edges,unit,populationBasis:'new-execution-selected-result-rows',physicalIdentity:'NOT_CAPTURED_AT_EXECUTION',snapshotSha256:file.snapshotSha256,integritySha256:file.integritySha256,coverage:snapshot.coverage};
   writeJsonAtomic(chartFilePath,file);writeJsonAtomic(receiptPath,receipt);a.published=true;
   return {status:'saved',chartFilePath,receiptPath,...receipt,bins:file.snapshot.rows.map(r=>({start:r.values.bin_start,end:r.values.bin_end,count:r.values.count})),nullCount:snapshot.coverage.aggregation.nullCount,observationCount:snapshot.coverage.aggregation.totalCount};
  }catch(e){if(a.cancelled||this.stopping)throw Error('HISTOGRAM_CANCELLED');throw e;}
  finally{runner.destroy();await Promise.all(a.children.map(c=>c.closed));runner.jobs.clear();a.job=null;if(this.active===a)this.active=null;}
 }
}
