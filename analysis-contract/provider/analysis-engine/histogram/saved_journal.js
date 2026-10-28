import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PipelineCompiler} from '../engine/pipeline_compiler.js';
import {sha,validateBinEdges,quoteIdentifier,normalizeEngineBins,createHistogramDefinition} from '../recovery/assets/histogram.js';
import {ReceiptVerifier} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/receipt_verifier.js';
import {compileSingleInputQuery,normalizeReaderOptions} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/query_compiler.js';

const C=createRequire(import.meta.url)('../chart-core.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/,SUFFIX='.recoverable-histogram-receipt.json',PAGE=20;
const bytesSha=b=>crypto.createHash('sha256').update(b).digest('hex');
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const exact=(a,b)=>sha(a)===sha(b);
const numeric=t=>/^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|DECIMAL\(\d+,\s*\d+\))$/.test(t||'');

// Exact expression contract of the approved bridge84eaf, for read-only proof.
function histogramExpression(measure,edges){
 const c=quoteIdentifier(measure);return [['COUNT(*)','total_count'],[`COUNT(${c})`,'non_null_count'],[`COUNT(*)-COUNT(${c})`,'null_count'],[`COUNT(CASE WHEN ${c}<${edges[0]} OR ${c}>${edges.at(-1)} THEN 1 END)`,'out_of_range_count'],[`CAST(MIN(${c}) AS VARCHAR)`,'min_observed'],[`CAST(MAX(${c}) AS VARCHAR)`,'max_observed'],...edges.slice(1).map((v,i)=>[`COUNT(CASE WHEN ${c}>=${edges[i]} AND ${c}${i===edges.length-2?'<=':'<'}${v} THEN 1 END)`,'bin_'+i])].map(([expr,alias])=>expr+' AS '+quoteIdentifier(alias)).join(', ');
}

export class SavedJournalStore{
 constructor({profileDir}){
  demand(typeof profileDir==='string'&&path.isAbsolute(profileDir),'JOURNAL_PROFILE_REQUIRED');
  this.profileDir=path.resolve(profileDir);this.exportDir=path.join(this.profileDir,'histogram-snapshots');this.workDir=path.join(this.profileDir,'histogram-work','recoverable-direct');
  // Read-only: no mkdir, engine, catalog instance, recovery, lock or lease.
 }
 owned(file,base){
  demand(typeof file==='string'&&path.isAbsolute(file),'JOURNAL_OWNED_PATH_REQUIRED');const p=path.resolve(file),b=path.resolve(base),rel=path.relative(b,p);
  demand(rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep),'JOURNAL_OWNED_PATH_REQUIRED');
  const fromRoot=path.relative(this.profileDir,p);demand(!path.isAbsolute(fromRoot)&&fromRoot!=='..'&&!fromRoot.startsWith('..'+path.sep),'JOURNAL_PROFILE_PATH_REQUIRED');
  let current=this.profileDir;for(const piece of fromRoot.split(path.sep)){current=path.join(current,piece);demand(!fs.lstatSync(current).isSymbolicLink(),'JOURNAL_LINK_REFUSED');}
  const realBase=fs.realpathSync(b),realFile=fs.realpathSync(p),realRel=path.relative(realBase,realFile);demand(realRel&&!path.isAbsolute(realRel)&&realRel!=='..'&&!realRel.startsWith('..'+path.sep),'JOURNAL_REAL_PATH_REQUIRED');return p;
 }
 read(file,base,max){const p=this.owned(file,base),st=fs.statSync(p);demand(st.isFile()&&st.size<=max,'JOURNAL_FILE_SIZE');const bytes=fs.readFileSync(p);demand(bytes.length<=max,'JOURNAL_FILE_SIZE');return {bytes,digest:bytesSha(bytes),value:JSON.parse(bytes.toString('utf8'))};}
 sidecar(entryId){
  demand(typeof entryId==='string'&&UUID.test(entryId),'JOURNAL_ENTRY_ID');const result=this.read(path.join(this.exportDir,entryId+SUFFIX),this.exportDir,1024*1024),r=result.value;
  demand(r?.schemaVersion==='siren.recoverable-direct-histogram/1'&&r.operationId===entryId,'JOURNAL_SIDECAR_IDENTITY');
  demand(typeof r.selectedJobId==='string'&&r.selectedJobId.length<=256&&typeof r.nodeId==='string'&&r.nodeId.length<=256&&typeof r.measure==='string'&&r.measure.length<=256&&numeric(r.measureType),'JOURNAL_SIDECAR_SCHEMA');
  demand([r.selectionSha256,r.selectedDefinitionSha256,r.receiptDigest,r.snapshotSha256,r.integritySha256].every(v=>typeof v==='string'&&HASH.test(v))&&r.resultVersion==='receipt-sha256:'+r.receiptDigest,'JOURNAL_SIDECAR_VERSION');
  demand(r.originalCurrentState==='unknown'&&r.physicalIdentity==='VERIFIED_EXECUTION_COPIES'&&r.executionJournal==='VERIFIED_CATALOG_RECEIPT_2','JOURNAL_SIDECAR_POLICY');
  validateBinEdges(r.edges);demand(r.edges.length<=21&&Array.isArray(r.inputSnapshots)&&r.inputSnapshots.length===1&&r.coverage?.kind==='aggregate','JOURNAL_SIDECAR_COUNTS');
  const input=r.inputSnapshots[0];demand(input.nodeId===r.nodeId&&['csv','parquet'].includes(input.format)&&/^[A-Za-z0-9_-]{1,128}$/.test(input.snapshotId||'')&&HASH.test(input.snapshotSha256||'')&&typeof input.sourceRowCount==='string'&&/^(?:0|[1-9]\d*)$/.test(input.sourceRowCount)&&Number.isSafeInteger(input.snapshotByteCount)&&input.snapshotByteCount>=0,'JOURNAL_SIDECAR_INPUT');
  const base=path.join(this.workDir,entryId),sealed=path.join(base,'storage','sealed');demand(typeof input.snapshotPath==='string'&&path.isAbsolute(input.snapshotPath)&&path.dirname(path.resolve(input.snapshotPath))===sealed&&path.parse(input.snapshotPath).name===input.snapshotId&&path.extname(input.snapshotPath).toLowerCase()==='.'+input.format,'JOURNAL_SNAPSHOT_PATH');
  demand(typeof r.catalogPath==='string'&&path.isAbsolute(r.catalogPath)&&path.resolve(r.catalogPath)===path.join(base,'catalog','catalog.json'),'JOURNAL_CATALOG_PATH');
  demand(Number.isSafeInteger(r.coverage.sourceRowCount)&&String(r.coverage.sourceRowCount)===input.sourceRowCount&&r.coverage.aggregation?.totalCount===r.coverage.sourceRowCount,'JOURNAL_SOURCE_POPULATION');
  demand(typeof r.chartFilePath==='string'&&path.dirname(path.resolve(r.chartFilePath))===this.exportDir,'JOURNAL_CHART_PATH');
  const jobId='hist_'+entryId.replaceAll('-','_');demand(path.basename(r.chartFilePath)===sha({jobId,version:r.resultVersion})+'.sirenchart.json','JOURNAL_CHART_PATH');
  let readerMode='LEGACY_PARQUET_RECEIPT_ONLY',readerPolicy=null;
  if(r.readerBinding!==undefined||r.readerBindingSha256!==undefined){
   const reader=r.readerBinding;demand(reader&&typeof reader==='object'&&!Array.isArray(reader),'JOURNAL_READER_BINDING');const {readerBindingSha256,...body}=reader;
   demand(HASH.test(readerBindingSha256||'')&&readerBindingSha256===r.readerBindingSha256&&sha(body)===readerBindingSha256,'JOURNAL_READER_DIGEST');
   const legacy=reader.schemaVersion==='siren.completed-direct-reader/1';
   demand((legacy||reader.schemaVersion==='siren.completed-direct-reader/2')&&reader.selectedJobId===r.selectedJobId&&reader.nodeId===r.nodeId&&reader.selectionSha256===r.selectionSha256&&reader.definitionSha256===r.selectedDefinitionSha256&&reader.format===input.format&&typeof reader.executionPath==='string'&&path.isAbsolute(reader.executionPath)&&path.resolve(reader.executionPath)===path.resolve(input.originalPath),'JOURNAL_READER_IDENTITY');
   const options=normalizeReaderOptions(reader.options);demand(exact(options,reader.options)&&exact(options,input.options),'JOURNAL_READER_OPTIONS');
   const kind=legacy?(input.format==='csv'?'legacy-absent':'native-parquet'):reader.nullPolicyKind;
   if(input.format==='csv'){
    demand(Object.keys(options).length===4&&typeof options.header==='boolean'&&typeof options.allVarchar==='boolean'&&typeof options.delimiter==='string'&&reader.allowQuotedNulls===false,'JOURNAL_READER_POLICY');
    demand((kind==='legacy-absent'&&options.nullStr===''&&reader.nullPolicy==='unquoted-empty-matches-null; quoted-values-are-not-null-tokens')||(kind==='explicit-string'&&typeof options.nullStr==='string'&&reader.nullPolicy==='unquoted-nullstr-matches-null; quoted-values-are-not-null-tokens'),'JOURNAL_READER_POLICY');
   }else demand(kind==='native-parquet'&&Object.keys(options).length===0&&reader.allowQuotedNulls===null&&reader.nullPolicy==='native-parquet-types','JOURNAL_READER_POLICY');
   const data={path:reader.executionPath,format:reader.format,...options};
   // Old descriptors store canonical empty nullStr, although the old compiler
   // emitted no nullstr parameter. Reproduce that exact SQL without migration.
   if(kind==='legacy-absent')delete data.nullStr;
   const def={nodes:[{id:r.nodeId,type:'input',data}],edges:[]};demand(new PipelineCompiler(def).compileToSQL()[0].sql===reader.inputSql,'JOURNAL_READER_SQL');
   if(!legacy)demand(HASH.test(reader.inputSqlDigest||'')&&reader.inputSqlDigest===bytesSha(Buffer.from(reader.inputSql,'utf8')),'JOURNAL_READER_SQL_DIGEST');
   readerMode='BOUND_READER';readerPolicy={kind,token:input.format==='csv'?options.nullStr:null,descriptorVersion:reader.schemaVersion};
  }else demand(input.format==='parquet'&&exact(input.options,{}),'JOURNAL_READER_BINDING_REQUIRED');
  return {...result,record:r,jobId,base,readerMode,readerPolicy};
 }
 async list({offset=0,expectedListingRevision}={}){
  demand(Number.isSafeInteger(offset)&&offset>=0,'JOURNAL_PAGE');let files=[];
  try{demand(!fs.lstatSync(this.exportDir).isSymbolicLink(),'JOURNAL_LINK_REFUSED');files=fs.readdirSync(this.exportDir).filter(n=>n.endsWith(SUFFIX)&&UUID.test(n.slice(0,-SUFFIX.length))).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
  const listingRevision=sha(files);if(expectedListingRevision!==undefined)demand(expectedListingRevision===listingRevision,'JOURNAL_LIST_CHANGED');const entries=[];
  for(const name of files.slice(offset,offset+PAGE)){const entryId=name.slice(0,-SUFFIX.length);try{const v=this.sidecar(entryId),r=v.record;entries.push({entryId,entrySha256:v.digest,status:'SAVED_NOT_RECHECKED',integritySha256:r.integritySha256,resultVersion:r.resultVersion,selectedJobId:r.selectedJobId,nodeId:r.nodeId,measure:r.measure,measureType:r.measureType,unit:r.unit,sourceRowCount:r.coverage.sourceRowCount,readerMode:v.readerMode});}catch(e){entries.push({entryId,status:'INVALID_METADATA',error:e.message});}}
  return {schemaVersion:'siren.saved-journal-list/1',listingRevision,offset,total:files.length,nextOffset:offset+PAGE<files.length?offset+PAGE:null,entries};
 }
 async open({entryId,expectedEntrySha256}={}){
  demand(typeof expectedEntrySha256==='string'&&HASH.test(expectedEntrySha256),'JOURNAL_ENTRY_REVISION_REQUIRED');const entry=this.sidecar(entryId);demand(entry.digest===expectedEntrySha256,'JOURNAL_ENTRY_CHANGED');const r=entry.record,chart=this.read(r.chartFilePath,this.exportDir,C.LIMITS.bytes),file=await C.unpack(chart.bytes.toString('utf8')),s=file.snapshot,o=s.source.origin;
  demand(file.snapshotSha256===r.snapshotSha256&&file.integritySha256===r.integritySha256&&s.source.resultVersion===r.resultVersion&&s.source.jobId===entry.jobId&&s.source.sourceId===r.nodeId,'JOURNAL_CHART_IDENTITY');
  demand(o?.receiptDigest===r.receiptDigest&&o.measureType===r.measureType&&o.originalCurrentState==='unknown'&&s.source.state==='unknown'&&exact(o.inputSnapshots,r.inputSnapshots)&&exact(s.coverage,r.coverage)&&r.measure===s.coverage.aggregation.measureColumn&&r.unit===s.coverage.aggregation.unit&&exact(file.definition.histogramEdges,r.edges),'JOURNAL_CHART_SIDECAR_CONFLICT');
  let journal;try{journal=await this.verifyJournal(entry,file);}catch(e){if(['JOURNAL_CHART_RECEIPT_CONFLICT','JOURNAL_SCHEMA_INPUT','JOURNAL_DIRECT_QUERY','JOURNAL_POPULATION_TYPE','JOURNAL_CHART_PROOF_IDENTITY'].includes(e.message))throw e;journal={status:'UNAVAILABLE',error:e.message};}
  demand(this.sidecar(entryId).digest===entry.digest,'JOURNAL_ENTRY_CHANGED');const after=this.read(r.chartFilePath,this.exportDir,C.LIMITS.bytes);demand(after.digest===chart.digest,'JOURNAL_CHART_CHANGED');
  return {schemaVersion:'siren.saved-journal-open/1',entryId,entrySha256:entry.digest,chartFilePath:r.chartFilePath,chartFileSha256:chart.digest,file,journal:{...journal,checkedAt:new Date().toISOString()},readerMode:entry.readerMode,readerPolicy:entry.readerPolicy,sourceState:'unknown'};
 }
 async verifyJournal(entry,file){
  const {record:r,base,jobId}=entry,catDir=path.join(base,'catalog');demand(!fs.existsSync(r.catalogPath+'.lock'),'JOURNAL_BUSY');const catalog=this.read(r.catalogPath,catDir,32*1024*1024),{catalogDigest,...body}=catalog.value;
  demand(body.contract==='siren.worker-catalog/2'&&Number.isSafeInteger(body.catalogRevision)&&body.catalogRevision>0&&sha(body)===catalogDigest,'JOURNAL_CATALOG_DIGEST');
  demand(Object.values(body.leases||{}).every(v=>Array.isArray(v)&&v.length===0),'JOURNAL_ACTIVE_LEASE');
  const readJob=async key=>{
   const j=body.jobs?.[key];demand(j?.jobId===key&&j.status==='SUCCESS'&&j.receiptValid===true&&Array.isArray(j.attempts),'JOURNAL_RESULT_NOT_CURRENT');const a=j.attempts.find(v=>v.attemptId===j.currentAttemptId);
   demand(a?.status==='SUCCESS'&&a.sessionToken===j.currentSessionToken&&a.receiptDigest===j.receipt?.receiptDigest,'JOURNAL_ATTEMPT_BINDING');
   const receipt=this.read(j.receiptPath,path.join(catDir,'receipts'),8*1024*1024),rows=this.read(j.rowsPath,path.join(catDir,'rows'),8*1024*1024);
   demand(receipt.digest===j.receiptFileSha256&&rows.digest===j.rowsFileSha256&&exact(receipt.value,j.receipt)&&exact(rows.value,j.capturedRows),'JOURNAL_SAVED_EVIDENCE');
   const q=receipt.value;demand(q.status==='SUCCESS'&&q.jobId===key&&q.compiledExecution.workerId==='worker_pid_'+a.workerPid&&q.lifecycle.retryCount===a.attemptIndex-1&&q.compiledExecution.sqlDigest===a.compiledQuery.sqlDigest&&exact(q.compiledExecution.queryPlan,a.compiledQuery.queryPlan)&&q.inputs.length===1,'JOURNAL_ATTEMPT_REQUEST');
   for(const input of q.inputs){const snapshot=body.snapshots?.[input.snapshotId];demand(snapshot&&snapshot.snapshotId===input.snapshotId&&snapshot.snapshotPath===input.snapshotPath&&snapshot.contentSha256===input.snapshotSha256&&snapshot.byteCount===input.snapshotByteCount,'JOURNAL_SNAPSHOT_BINDING');this.owned(input.snapshotPath,path.join(base,'storage','sealed'));}
   await ReceiptVerifier.verifyReceipt(q,{capturedRows:rows.value,verifyDiskSnapshots:false});return {j,a,q,rows:rows.value};
  };
  const h=await readJob(jobId),schema=await readJob(jobId+'_schema'),q=h.q,schemaQ=schema.q,input=q.inputs[0],o=file.snapshot.source.origin;
  demand(q.receiptDigest===r.receiptDigest&&schemaQ.receiptDigest===o.schemaReceiptDigest,'JOURNAL_SAVED_VERSION_CHANGED');
  demand(schemaQ.compiledExecution.sqlDigest===o.schemaSqlDigest&&h.a.attemptId===o.attemptId&&h.a.sessionToken===o.sessionToken&&q.compiledExecution.workerId===o.workerId&&q.compiledExecution.engineVersion===o.engineVersion,'JOURNAL_CHART_PROOF_IDENTITY');
  demand(exact(q.inputs,r.inputSnapshots)&&exact(schemaQ.inputs,q.inputs)&&schemaQ.metrics.outputRowCount===input.sourceRowCount,'JOURNAL_SCHEMA_INPUT');
  const plain=compileSingleInputQuery(input),hist=compileSingleInputQuery(input,{selectExpr:histogramExpression(r.measure,r.edges)});demand(schemaQ.compiledExecution.sqlDigest===plain.sqlDigest&&exact(schemaQ.compiledExecution.queryPlan,plain.queryPlan)&&q.compiledExecution.sqlDigest===hist.sqlDigest&&exact(q.compiledExecution.queryPlan,hist.queryPlan),'JOURNAL_DIRECT_QUERY');
  demand(q.metrics.transferStatus==='COMPLETE'&&q.metrics.outputRowCount==='1'&&h.rows.length===1&&String(h.rows[0].total_count)===input.sourceRowCount&&schemaQ.schema.find(c=>c.name===r.measure)?.type===r.measureType,'JOURNAL_POPULATION_TYPE');
  await ReceiptVerifier.verifyReceipt(q,{capturedRows:h.rows,verifyDiskSnapshots:true});
  const normalized=normalizeEngineBins({wideRow:h.rows[0],edges:r.edges,measureColumn:r.measure,unit:r.unit,source:{sourceId:input.nodeId||input.snapshotId,jobId,resultVersion:r.resultVersion,state:'unknown',capturedAt:q.executionTiming.completedAt},coverageMeta:{sourceSemantic:'direct-observation-distribution',initialSourceRowCount:input.sourceRowCount}});
  const snapshot={...normalized,source:{...normalized.source,origin:{executionMode:'recovered-catalog-child-execution',receiptDigest:q.receiptDigest,schemaReceiptDigest:schemaQ.receiptDigest,schemaSqlDigest:schemaQ.compiledExecution.sqlDigest,workerId:q.compiledExecution.workerId,engineVersion:q.compiledExecution.engineVersion,attemptId:h.a.attemptId,sessionToken:h.a.sessionToken,inputSnapshots:q.inputs,measureType:r.measureType,unitOrigin:r.unit===null?'none':'explicit-caller-supplied',originalCurrentState:'unknown'}},coverage:{...normalized.coverage,aggregation:{...normalized.coverage.aggregation,populationBasis:'complete-captured-input-rows',weighting:'none'}}};
  const definition=createHistogramDefinition(snapshot);definition.appearance='light';const reproduced=await C.pack(snapshot,definition);demand(reproduced.integritySha256===file.integritySha256,'JOURNAL_CHART_RECEIPT_CONFLICT');
  demand(this.read(r.catalogPath,catDir,32*1024*1024).digest===catalog.digest&&!fs.existsSync(r.catalogPath+'.lock'),'JOURNAL_CHANGED_DURING_READ');return {status:'VERIFIED',catalogRevision:body.catalogRevision,receiptDigest:q.receiptDigest,schemaReceiptDigest:schemaQ.receiptDigest};
 }
}
