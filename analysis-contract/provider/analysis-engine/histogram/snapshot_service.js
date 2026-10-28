import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {WorkflowHistogramService} from './workflow_service.js';
import {RunnerService} from '../server/runner_service.js';
import {PipelineCompiler} from '../engine/pipeline_compiler.js';
import {SnapshotManager} from '../input_snapshots/snapshot_manager.js';
import {prepareWorkflowSelection} from './selection.js';
import {buildHistogramAggregationExprs,validateBinEdges,validateMeasureColumnSchema,sealHistogramJob,createHistogramDefinition,sha} from './workflow_producer.js';
import {writeJsonAtomic} from '../registry/src/atomic_fs.js';
import {capturedReaderOptions} from './captured_reader_options.js';
const C=createRequire(import.meta.url)('../chart-core.cjs');
export class SnapshotWorkflowHistogramService extends WorkflowHistogramService {
 cancel(id){
  const a=this.active;if(a?.kind!=='snapshot-workflow')return super.cancel(id);
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('HISTOGRAM_OPERATION_ID');
  if(a.id===id&&a.published)return {requested:false,status:'saved'};
  this.cancelled.add(id);if(a.id!==id)return {requested:true};a.cancelled=true;a.controller.abort();
  if(a.job)a.runner?.cancelJob(a.job.jobId);a.runner?.destroy();return {requested:true};
 }
 async destroy(){this.stopping=true;const a=this.active;if(a?.kind==='snapshot-workflow'){this.cancel(a.id);await a.done;}else await super.destroy();}
 async startSnapshotWorkflow(rawRequest){
  if(this.stopping)throw Error('HISTOGRAM_STOPPING');if(this.active)throw Error('HISTOGRAM_BUSY');
  const request=JSON.parse(JSON.stringify(rawRequest||{})),{operationId:id,jobId,nodeId,expectedSelectionSha256,measure,edges}=request;
  if(this.cancelled.has(id))throw Error('HISTOGRAM_CANCELLED');
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||this.used.has(id))throw Error('HISTOGRAM_OPERATION_ID');
  const selected=JSON.parse(JSON.stringify(prepareWorkflowSelection(this.getJob(jobId),{nodeId,expectedSelectionSha256,measure})));validateBinEdges(edges);this.used.add(id);
  const work=path.join(this.workDir,id);fs.mkdirSync(work,{recursive:true});
  let finish;const a={id,kind:'snapshot-workflow',controller:new AbortController(),done:new Promise(r=>{finish=r;}),runner:null,job:null,children:[],cancelled:false,published:false,keepInputs:false};this.active=a;
  let manager;const copies=[],leased=[];
  const ensure=()=>{if(a.cancelled||this.stopping||a.controller.signal.aborted)throw Error('HISTOGRAM_CANCELLED');};
  const track=child=>{if(child&&!a.children.some(c=>c.child===child)){const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({pid:child.pid,code,signal})));a.children.push({child,closed});}};
  try{
   manager=new SnapshotManager({baseDir:path.join(work,'input-copies')});const def=selected.pipelineDef;
   for(const binding of selected.descriptor.inputBindings){ensure();const copy=await manager.captureSnapshot(binding.executionPath,{nodeId:binding.nodeId,signal:a.controller.signal});copies.push({binding,copy});ensure();const input=def.nodes.find(n=>n.id===binding.nodeId);input.data.path=copy.snapshotPath;input.data.format=binding.format;manager.acquireLease(copy.snapshotId,id);leased.push(copy.snapshotId);}
   for(const {copy} of copies){await manager.verifySnapshotIntegrity(copy.snapshotId);ensure();}
   const histNodeId='siren_copied_hist_'+id.replaceAll('-','_');if(def.nodes.some(n=>n.id.replace(/[^a-zA-Z0-9_]/g,'_')===histNodeId))throw Error('WORKFLOW_HISTOGRAM_NODE_COLLISION');
   def.nodes.push({id:histNodeId,type:'aggregate',data:{groupBy:[],aggregations:buildHistogramAggregationExprs(measure,edges)}});def.edges.push({source:nodeId,target:histNodeId});
   const compiled=new PipelineCompiler(def).compileToSQL();ensure();
   const runner=new RunnerService({dataDir:work,tempDir:path.join(work,'temp'),threads:2,maxMemory:'512MB'});a.runner=runner;
   track(runner.worker);const init=runner.initWorker;runner.initWorker=function(){const v=init.call(this);track(this.worker);return v;};
   a.job=runner.createJob(def);await runner.runJob(a.job.jobId);ensure();
   for(const {copy,binding} of copies){const actual=a.job.generatedSQL.filter(s=>s.nodeId===binding.nodeId&&s.nodeType==='input');if(actual.length!==1||actual[0].sql!==compiled.find(s=>s.nodeId===binding.nodeId).sql)throw Error('SNAPSHOT_INPUT_SQL_BINDING');await manager.verifySnapshotIntegrity(copy.snapshotId);ensure();}
   const actual=validateMeasureColumnSchema(a.job.nodeOutputs[nodeId]?.schema,measure);if(actual.type!==selected.column.type)throw Error('WORKFLOW_SOURCE_SCHEMA_CHANGED');
   const unit=a.job.nodeOutputs[nodeId].schema.find(c=>(c.name??c.columnName)===measure)?.unit??null;
   const sealed=sealHistogramJob({job:a.job,sourceNodeId:nodeId,histNodeId,measureColumn:measure,edges,unit});
   const bindings=copies.map(({binding:b,copy:c})=>{const input=def.nodes.find(n=>n.id===b.nodeId);return {nodeId:b.nodeId,snapshotId:c.snapshotId,selectedOriginalPath:b.originalPath,originalPath:c.originalPath,originalCompiledReaderPath:b.executionPath,snapshotPath:c.snapshotPath,snapshotSha256:c.contentSha256,snapshotByteCount:c.byteCount,capturedAt:c.capturedAt,originalBeforeStat:c.originalBeforeStat,originalAfterStat:c.originalAfterStat,originalModifiedDuringCapture:c.originalModifiedDuringCapture,readerFormat:b.format,readerOptions:capturedReaderOptions(b.format,input.data),sourceRowCount:a.job.nodeOutputs[b.nodeId].rowCount,verifiedBeforeExecution:true,verifiedAfterExecution:true};});
   const resultVersion='captured-engine-job-sha256:'+sha({engineResultVersion:sealed.source.resultVersion,inputSnapshots:bindings});
   const snapshot={...sealed,snapshotId:'hist_captured_'+sha({priorSnapshotId:sealed.snapshotId,resultVersion}),source:{...sealed.source,resultVersion,origin:{...sealed.source.origin,executionMode:'new-execution-on-verified-input-copies',selectedJobId:jobId,selectedCompletedAt:selected.descriptor.completedAt,selectedDefinitionSha256:selected.descriptor.definitionSha256,selectedSelectionSha256:expectedSelectionSha256,selectedPriorRowCount:selected.descriptor.priorRowCount,originalCurrentState:'unknown',datasetIdentity:bindings.map(b=>({nodeId:b.nodeId,path:b.snapshotPath,originalPath:b.originalPath,format:b.readerFormat,status:'CAPTURED_EXECUTION_COPY',exists:true,fileSizeBytes:b.snapshotByteCount,modifiedAt:null,contentSha256:b.snapshotSha256,capturedAt:b.capturedAt})),inputSnapshots:bindings}},coverage:{...sealed.coverage,aggregation:{...sealed.coverage.aggregation,populationBasis:'new-execution-on-captured-input-result-rows',weighting:'none'}}};
   const definition=createHistogramDefinition(snapshot);definition.appearance='light';const file=await C.pack(snapshot,definition);await C.unpack(JSON.stringify(file));ensure();
   fs.mkdirSync(this.exportDir,{recursive:true});const chartFilePath=path.join(this.exportDir,id+'.sirenchart.json'),receiptPath=path.join(this.exportDir,id+'.snapshot-workflow-histogram-receipt.json');
   const receipt={schemaVersion:'siren.snapshot-workflow-histogram/1',operationId:id,selectedJobId:jobId,nodeId,selectionSha256:expectedSelectionSha256,selectedDefinitionSha256:selected.descriptor.definitionSha256,histogramJobId:a.job.jobId,resultVersion,measure,measureType:actual.type,edges,unit,populationBasis:'new-execution-on-captured-input-result-rows',physicalIdentity:'VERIFIED_EXECUTION_COPIES',originalCurrentState:'unknown',inputSnapshots:bindings,snapshotSha256:file.snapshotSha256,integritySha256:file.integritySha256,coverage:snapshot.coverage};
   a.keepInputs=true;writeJsonAtomic(chartFilePath,file);writeJsonAtomic(receiptPath,receipt);a.published=true;
   return {status:'saved',chartFilePath,receiptPath,...receipt,bins:file.snapshot.rows.map(r=>({start:r.values.bin_start,end:r.values.bin_end,count:r.values.count})),nullCount:snapshot.coverage.aggregation.nullCount,observationCount:snapshot.coverage.aggregation.totalCount};
  }catch(e){if(a.cancelled||this.stopping)throw Error('HISTOGRAM_CANCELLED');throw e;}
  finally{try{a.runner?.destroy();await Promise.all(a.children.map(c=>c.closed));for(const snapshotId of leased)manager.releaseLease(snapshotId,id);if(!a.keepInputs)for(const {copy} of copies)manager.pruneSnapshot(copy.snapshotId);a.runner?.jobs.clear();a.job=null;}finally{if(this.active===a)this.active=null;finish();}}
 }
}
