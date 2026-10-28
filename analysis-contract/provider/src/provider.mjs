import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DirectoryHistory,strictHistoryJson } from './publication-store.mjs';
import {historyCatalog,historyState,validateHistoryState} from './history-state.mjs';
import { RunnerService } from '../analysis-engine/server/runner_service.js';
import { PipelineCompiler } from '../analysis-engine/engine/pipeline_compiler.js';
import { CONTRACT, CATALOG, canonical, parameters, validateParameterSchema, wireSchema, validateResult, verifyResult, checkReference, fail } from './contract.mjs';
export const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const clone = value => structuredClone(value);
function definitionIdentity(def) {
  const transient = new Set(['status','preview','rowCount','isOutdated','label']);
  return sha({ nodes: def.nodes.map(n => ({ id:n.id, type:n.type, data:Object.fromEntries(Object.entries(n.data || {}).filter(([k]) => !transient.has(k))) })), edges: def.edges.map(e => ({ source:e.source, target:e.target, targetHandle:e.targetHandle ?? null })) });
}
function fileHash(filename){const hash=crypto.createHash('sha256'),fd=fs.openSync(filename,'r'),buffer=Buffer.allocUnsafe(65536);try{let read;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));}finally{fs.closeSync(fd);}return hash.digest('hex');}
const terminal = new Set(['completed','failed','cancelled']);
const scalarLiteral = (value, schema) => {
  if (value === null) return 'NULL';
  if (schema.type === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (schema['x-wire'] === 'decimal') return `CAST('${value}' AS DECIMAL(${schema.precision},${schema.scale}))`;
  if (['int64','int128','uint64','uint128'].includes(schema['x-wire'])) return `CAST('${value}' AS ${{int64:'BIGINT',int128:'HUGEINT',uint64:'UBIGINT',uint128:'UHUGEINT'}[schema['x-wire']]})`;
  if (['number','integer'].includes(schema.type)) return String(value);
  return "'" + value.replaceAll("'", "''") + "'";
};
function compileDefinition(definition, code) {
  try { return new PipelineCompiler(definition).compileToSQL(); }
  catch(error) { fail(code, error.message); }
}
function criterionSlot(node, binding) {
  const countif=node?.type==='conditional_count'&&node.data?.countModel?.operation==='countif';
  const group=node?.type==='filter'?node.data?.criteria:node?.type==='conditional_sum'?node.data?.sumModel?.criteria:countif?node.data?.countModel?.criteria:null;
  const schema=node?.type==='filter'?node.data?.criteriaSchema:node?.type==='conditional_sum'?node.data?.sumSchema:countif?node.data?.countSchema:null;
  const index=binding.ruleIndex;
  if(!Number.isSafeInteger(index)||index<0||!Array.isArray(group?.rules)||!Array.isArray(schema))fail('INVALID_PUBLICATION','Typed criterion slot required');
  const rule=group.rules[index];
  if(!rule||!['eq','ne','lt','lte','gt','gte','contains','startsWith','endsWith'].includes(rule.operator)||!Object.hasOwn(rule,'value')||Object.hasOwn(rule,'values'))fail('INVALID_PUBLICATION','Binding requires an existing scalar criterion');
  const column=schema.find(c=>c.name===rule.column);
  if(!column)fail('INVALID_PUBLICATION','Criterion column is absent from captured schema');
  return {rule,column};
}
function applyBindings(pipeline, bindings, values, schemas) {
  for(const binding of bindings) {
    if(!Object.hasOwn(values,binding.parameter))continue;
    const node=pipeline.nodes.find(n=>n.id===binding.nodeId),value=values[binding.parameter],schema=schemas[binding.parameter];
    if(binding.kind==='filter-comparison')node.data.condition='"'+binding.column.replaceAll('"','""')+'" '+binding.operator+' '+scalarLiteral(value,schema);
    else if(binding.kind==='criterion-value')criterionSlot(node,binding).rule.value=['number','integer'].includes(schema.type)?String(value):value;
    else node.data[binding.property]=value;
  }
}
export class AnalysisProvider {
  #definitions = new Map(); #requests = new Map(); #jobs = new Map(); #children = []; #catalogs = new Map();
  #history=null; #historyHead={sequence:0,digest:null}; #historyState=null; #metadataBusy=false; #closed=false;
  constructor({workDir, baseCatalog, history=null}) {
    this.workDir = fs.realpathSync(workDir); this.base = clone(baseCatalog); this.revision = 0;
    if(history){
      if(!history.authority||history.authority.grantRoot!==this.workDir||history.authority.baseCatalogSha256!==sha(this.base)||history.authority.contractVersion!==CONTRACT)fail('HISTORY_AUTHORITY_MISMATCH','Trusted history authority differs from provider');
      if(history.create!==true&&(!fs.existsSync(history.directory)||!fs.existsSync(path.join(history.directory,'commits'))))fail('HISTORY_MISSING','Committed history directory is unavailable; no implicit initialization');
      this.#history=new DirectoryHistory({directory:history.directory,authority:history.authority,validateState:(state,previous)=>validateHistoryState(state,{base:this.base,grantRoot:this.workDir,prepare:(p,o)=>this.#preparePublication(p,o),previous}),onPhase:history.onPhase});
      const recovered=this.#history.read();
      if(recovered.state)this.#applyHistory(recovered);
      else{
        if(history.create!==true)fail('HISTORY_MISSING','Committed publication history is unavailable; explicit owner creation/import required');
        const initial=historyState(this.base,new Map(),[historyCatalog(this.base,new Map(),0)]);
        this.#applyHistory(this.#history.commit(initial,recovered.head));
      }
    }
    const tempDir = path.join(this.workDir, 'temp'); fs.mkdirSync(tempDir, {recursive:true});
    this.runner = new RunnerService({dataDir:this.workDir,tempDir,maxMemory:'512MB',threads:2});
    const track = () => { const child = this.runner.worker; if (child && !this.#children.some(c=>c.child === child)) { const row={child,pid:child.pid,closed:false,code:null,signal:null}; row.done=new Promise(resolve=>child.once('close',(code,signal)=>{Object.assign(row,{closed:true,code,signal});resolve();}));this.#children.push(row); } };
    track(); const init = this.runner.initWorker.bind(this.runner); this.runner.initWorker = () => { init(); track(); };
    const receive=this.runner.handleWorkerMessage.bind(this.runner);
    this.runner.handleWorkerMessage=msg=>{const job=this.runner.getJob(msg?.jobId);if(msg?.jobId!==this.runner.activeJobId||job?.status!=='running')return;receive(msg);};
  }
  #owned(filename) {
    let resolved;try{resolved=fs.realpathSync(filename);}catch(error){fail('SOURCE_UNAVAILABLE','Authorized source is currently unavailable: '+error.code);}
    if (!resolved.startsWith(this.workDir + path.sep)) fail('SOURCE_OUTSIDE_GRANT', 'Workflow source outside owned data grant');
    return resolved;
  }
  #guard(){if(this.#closed)fail('PROVIDER_CLOSED','Provider is closed');if(this.#metadataBusy)fail('HISTORY_BUSY','Metadata commit is in progress');}
  #historicalPath(filename){
    if(typeof filename!=='string'||filename.includes('\0')||!path.isAbsolute(filename)||path.resolve(filename)!==filename||!filename.startsWith(this.workDir+path.sep))fail('HISTORY_AUTHORITY_MISMATCH','Recovered source path is outside the trusted grant');
    return filename;
  }
  #applyHistory(recovered){
    if(!recovered.state||recovered.head.sequence!==recovered.state.revision+1)fail('HISTORY_INVALID_STATE','Commit sequence differs from publication revision');
    const checked=validateHistoryState(recovered.state,{base:this.base,grantRoot:this.workDir,prepare:(p,o)=>this.#preparePublication(p,o),previous:this.#historyState,allowAdvance:true});
    this.#definitions=checked.definitions;this.#catalogs=checked.catalogs;this.revision=checked.revision;this.#historyState=clone(recovered.state);this.#historyHead=clone(recovered.head);
  }
  #refreshHistory(){
    if(!this.#history)return;
    const recovered=this.#history.read();
    if(!recovered.state||recovered.head.sequence<this.#historyHead.sequence||recovered.head.sequence===this.#historyHead.sequence&&recovered.head.digest!==this.#historyHead.digest)fail('HISTORY_REGRESSION','Committed history disappeared or changed since admission');
    if(recovered.head.digest!==this.#historyHead.digest)this.#applyHistory(recovered);
    return recovered;
  }
  historyStatus(){this.#guard();this.#metadataBusy=true;try{const read=this.#refreshHistory();if(!this.#history)return{durable:false};return{durable:true,head:clone(this.#historyHead),pendingStages:read.pendingStages,revision:this.revision};}finally{this.#metadataBusy=false;}}
  publish(submitted){
    this.#guard();this.#metadataBusy=true;try{this.#refreshHistory();submitted=this.#history?strictHistoryJson(submitted):clone(submitted);
    const key=submitted.id+'@'+submitted.version,fingerprint=sha(submitted),existing=this.#definitions.get(key);
    if(this.#history&&existing&&existing.history.fingerprint===fingerprint)return clone(existing.descriptor);
    const admitted=this.#preparePublication(submitted);admitted.history={submitted:clone(submitted),fingerprint,publication:clone(admitted.publication),descriptor:clone(admitted.descriptor)};
    if(this.#history){
      const next=new Map(this.#definitions);next.set(key,admitted);const catalogs=[...this.#catalogs.values(),historyCatalog(this.base,next,next.size)],state=historyState(this.base,next,catalogs);
      this.#applyHistory(this.#history.commit(state,this.#historyHead));
    }else{this.#definitions.set(key,admitted);this.revision++;}
    return clone(admitted.descriptor);
    }finally{this.#metadataBusy=false;}
  }
  #preparePublication(submitted,{recovery=false,definitions=this.#definitions}={}) {
    let {id,version,title,description,parameterSchema,definition,bindings,outputNodeId,units={}}=submitted;
    if (!/^[a-z][a-z0-9.-]{2,100}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) fail('INVALID_PUBLICATION','Invalid capability ID/version');
    if (parameterSchema.type !== 'object' || parameterSchema.additionalProperties !== false) fail('INVALID_PUBLICATION','Closed typed parameter schema required');
    validateParameterSchema(parameterSchema);
    const key = id + '@' + version; if (definitions.has(key)||this.base.capabilities.some(c=>c.id===id&&c.version===version)) fail('IMMUTABLE_VERSION','Publish a new version instead of replacing an existing catalog entry');
    definition = clone(definition); bindings = clone(bindings);
    if(!Array.isArray(bindings))fail('INVALID_PUBLICATION','Explicit binding array required');
    if (!Array.isArray(definition.nodes) || !definition.nodes.length || !Array.isArray(definition.edges)) fail('INVALID_PUBLICATION','Workflow graph required');
    const nodeIds = definition.nodes.map(n=>n.id);
    if (nodeIds.some(id=>typeof id!=='string'||!id||id.length>128)||new Set(nodeIds).size !== nodeIds.length || !nodeIds.includes(outputNodeId)) fail('INVALID_PUBLICATION','Invalid node identity/output');
    if(new Set(nodeIds.map(id=>id.replace(/[^a-zA-Z0-9_]/g,'_').replace(/[A-Z]/g,c=>c.toLowerCase()))).size!==nodeIds.length)fail('INVALID_PUBLICATION','Node identifiers collide after SQL view normalization');
    if(definition.edges.some(e=>!nodeIds.includes(e.source)||!nodeIds.includes(e.target)))fail('INVALID_PUBLICATION','Unknown edge endpoint');
    try{new PipelineCompiler(definition).validateDAG();}catch(e){fail('INVALID_PUBLICATION',e.message);}
    for(const n of definition.nodes){
      const incoming=definition.edges.filter(e=>e.target===n.id),expected=n.type==='input'?0:['join','lookup'].includes(n.type)?2:1;
      if(incoming.length!==expected)fail('INVALID_PUBLICATION','Invalid incoming-edge cardinality for '+n.type+': '+n.id);
      if(n.type==='lookup'&&!(incoming.filter(e=>e.targetHandle==='left').length===1&&incoming.filter(e=>e.targetHandle==='right').length===1))fail('INVALID_PUBLICATION','Lookup requires exactly one explicit left and right port');
      if(n.type==='join'){
        const ids=incoming.map(e=>e.source);if(ids[0]===ids[1])fail('INVALID_PUBLICATION','Join requires distinct explicit source nodes');
        const handles=incoming.some(e=>e.targetHandle!=null);
        if(handles&&!(incoming.filter(e=>e.targetHandle==='left').length===1&&incoming.filter(e=>e.targetHandle==='right').length===1))fail('INVALID_PUBLICATION','Join requires one left and one right port');
        const hasLeft=n.data?.leftSourceNodeId!==undefined,hasRight=n.data?.rightSourceNodeId!==undefined;
        if(hasLeft!==hasRight)fail('INVALID_PUBLICATION','Partial explicit join source mapping');
        if(hasLeft){
          const left=n.data.leftSourceNodeId,right=n.data.rightSourceNodeId;
          if(left===right||!ids.includes(left)||!ids.includes(right))fail('INVALID_PUBLICATION','Join sources differ from declared edges');
          if(handles&&(incoming.find(e=>e.targetHandle==='left').source!==left||incoming.find(e=>e.targetHandle==='right').source!==right))fail('INVALID_PUBLICATION','Join source mapping contradicts ports');
        }
        if(!['INNER','LEFT','RIGHT','FULL'].includes((n.data?.joinType||'INNER').toUpperCase()))fail('INVALID_PUBLICATION','Unsupported common-adapter join type');
      }
    }
    const ancestors=new Set([outputNodeId]);let changed=true;while(changed){changed=false;for(const e of definition.edges)if(ancestors.has(e.target)&&!ancestors.has(e.source)){ancestors.add(e.source);changed=true;}}
    // This adapter deliberately excludes export writers. The existing prototype export is catalogued separately.
    for (const n of definition.nodes) {
      if (!['input','select','filter','join','aggregate','pivot','unpivot','derive','conditional_sum','conditional_count','lookup'].includes(n.type)) fail('UNSUPPORTED_WORKFLOW','Unsupported common-adapter node: '+n.type);
      if (n.type === 'input') {
        if(n.data.retainedResult)fail('UNSUPPORTED_WORKFLOW','Use dedicated retained-result adapter');
        const durable=this.#history!==null||recovery;
        if(durable&&(typeof n.data.path!=='string'||n.data.path.includes('\0')))fail('HISTORY_SOURCE_PATH','A canonical granted source path is required');
        const requested=durable?path.resolve(this.workDir,n.data.path):n.data.path;
        const admitted=recovery?this.#historicalPath(requested):this.#owned(requested);
        if(durable&&admitted!==requested)fail('HISTORY_SOURCE_PATH','Publish the canonical granted path; historical aliases are not inferred');
        n.data.path=admitted;
      }
    }
    compileDefinition(definition,'INVALID_PUBLICATION');
    const bound = new Set(),slots=new Set();
    for (const b of bindings) {
      const n=definition.nodes.find(n=>n.id===b.nodeId),schema=parameterSchema.properties[b.parameter];
      if (!n || !schema) fail('INVALID_PUBLICATION','Unknown binding node/parameter');
      if(!ancestors.has(n.id))fail('INVALID_PUBLICATION','Parameter binding cannot influence the selected output');
      const allowed=b.kind==='criterion-value'?['kind','nodeId','parameter','ruleIndex']:b.kind==='filter-comparison'?['kind','nodeId','parameter','operator','column']:['kind','nodeId','parameter','property'];
      if(Object.keys(b).some(k=>!allowed.includes(k)))fail('INVALID_PUBLICATION','Unsupported binding field');
      if (b.kind === 'filter-comparison') {
        if(Object.hasOwn(n.data||{},'criteria'))fail('INVALID_PUBLICATION','Legacy filter binding cannot target a structured-criteria Filter');
        if (n.type !== 'filter' || !['=','<>','>=','>','<=','<'].includes(b.operator) || typeof b.column!=='string' || !b.column || b.column.includes('\0') || !['string','number','integer','boolean'].includes(schema.type)) fail('INVALID_PUBLICATION','Invalid filter binding');
      } else if (b.kind==='criterion-value') {
        const {column}=criterionSlot(n,b);
        let expected;try{expected=wireSchema(column.type);}catch(error){fail('INVALID_PUBLICATION',error.message);}
        if(schema.nullable||schema.type!==expected.type||schema['x-wire']!==expected['x-wire']||expected['x-wire']==='decimal'&&(schema.precision!==expected.precision||schema.scale!==expected.scale))fail('INVALID_PUBLICATION','Criterion parameter type/encoding differs from actual column');
      } else if (b.kind === 'reader-option') {
        const expected = {header:'boolean',allVarchar:'boolean',delimiter:'string',nullStr:'string'};
        if (n.type!=='input' || expected[b.property]!==schema.type || schema.nullable) fail('INVALID_PUBLICATION','Invalid reader binding');
      } else fail('INVALID_PUBLICATION','Unsupported binding kind');
      const slot=b.nodeId+':'+(b.kind==='reader-option'?'reader:'+b.property:b.kind==='criterion-value'?'criterion:'+b.ruleIndex:'legacy-condition');
      if(slots.has(slot)||bindings.some(other=>other!==b&&other.nodeId===b.nodeId&&(b.kind==='filter-comparison'||other.kind==='filter-comparison')))fail('INVALID_PUBLICATION','Conflicting node bindings');
      slots.add(slot);
      bound.add(b.parameter);
    }
    if (Object.keys(parameterSchema.properties).some(p=>!bound.has(p))) fail('INVALID_PUBLICATION','Every parameter must be applied by the workflow');
    const defaults=Object.fromEntries(Object.entries(parameterSchema.properties).filter(([,v])=>Object.hasOwn(v,'default')).map(([k,v])=>[k,clone(v.default)]));
    const defaultDefinition=clone(definition);applyBindings(defaultDefinition,bindings,defaults,parameterSchema.properties);compileDefinition(defaultDefinition,'INVALID_PUBLICATION');
    const workflowRef={workflowId:id,workflowVersion:version,definitionSha256:definitionIdentity(definition)};
    const descriptor={id,version,title,description,kind:'workflow',parameters:clone(parameterSchema),workflowRef,publicationSha256:sha({workflowRef,parameterSchema,bindings,outputNodeId,units}),result:{kind:'table',schema:{resolution:'actual DuckDB DESCRIBE at completion',expectedNodeId:outputNodeId},wirePolicy:'Exact int64/int128/uint64/uint128/DECIMAL strings; finite numeric values; unsupported types refuse',coverage:'COMPLETE or explicit first-N SAMPLED'},availability:{prototype:'IMPLEMENTED',contract:'IMPLEMENTED',evidence:'Registered source-backed workflow; qualification recorded separately'},invocation:{kind:'registered-workflow',endpoint:'execute'},execution:{mode:'async-job',status:'status(jobId)',cancel:'cancel(jobId); termination receipt distinct from request'},limits:['Preview <=50 rows; no guarantee that prior full results survive worker reuse','Input files restricted to provider grant','No arbitrary SQL/code/path execution from consumer parameters','This adapter supports input/select/filter/join/aggregate/pivot/unpivot/derive/conditional_sum/conditional_count/lookup; COUNTIF scalar bindings use the existing typed criterion policy; export writers use separate legacy route','Result wire adapter supports VARCHAR/BOOLEAN/32-bit integers/BIGINT/HUGEINT/UBIGINT/UHUGEINT/finite floats/DECIMAL; other types refuse'],sourceEvidence:['registered immutable definition '+workflowRef.definitionSha256]};
    descriptor.descriptorSha256=sha(descriptor);
    return{descriptor,definition,bindings,outputNodeId,units:clone(units),publication:clone({id,version,title,description,parameterSchema,definition,bindings,outputNodeId,units})};
  }
  catalog(){this.#guard();this.#metadataBusy=true;try{this.#refreshHistory();return this.#currentCatalog();}finally{this.#metadataBusy=false;}}
  #currentCatalog() {
    if(this.#history)return clone(Array.from(this.#catalogs.values()).at(-1));
    const entries=[...this.base.capabilities.map(d=>{const v=clone(d);v.descriptorSha256=sha(v);return v;}),...Array.from(this.#definitions.values(),v=>clone(v.descriptor))];
    if (new Set(entries.map(e=>e.id+'@'+e.version)).size!==entries.length) fail('INVALID_CATALOG','Duplicate ID/version');
    const result={...clone(this.base),catalogId:'siren.analysis',schemaVersion:CATALOG,contractVersion:CONTRACT,catalogVersion:'2.0.'+this.revision,capabilities:entries}; result.catalogSha256=sha(result);this.#catalogs.set(result.catalogSha256,clone(result));return result;
  }
  execute(request) {
    this.#guard();this.#metadataBusy=true;try{this.#refreshHistory();
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['requestId','binding','parameters'].includes(k)))fail('INVALID_REQUEST','Expected requestId, binding and parameters');
    try{request=clone(request);}catch{fail('INVALID_REQUEST','Execution request must contain cloneable JSON data');}
    const fingerprint=sha(request);
    if (typeof request.requestId!=='string'||!request.requestId||request.requestId.length>128) fail('INVALID_REQUEST','requestId required');
    if (this.#requests.has(request.requestId)) { const previous=this.#requests.get(request.requestId);if(previous.fingerprint!==fingerprint)fail('REQUEST_ID_CONFLICT','requestId already used for a different request');return clone(previous.receipt); }
    const current=this.#currentCatalog(),saved=this.#catalogs.get(request.binding?.catalogSha256);
    if(!saved||saved.catalogVersion!==request.binding.catalogVersion)fail('CATALOG_VERSION_UNAVAILABLE','Exact saved catalog pin not present in this provider session; explicit republish/import required');
    checkReference(saved,request.binding);
    const entry=checkReference(current,request.binding),registered=this.#definitions.get(entry.id+'@'+entry.version),values=parameters(entry.parameters,request.parameters);
    const pipeline=clone(registered.definition);applyBindings(pipeline,registered.bindings,values,entry.parameters.properties);compileDefinition(pipeline,'INVALID_PARAMETERS');
    const sources=[],inputDir=path.join(this.workDir,'captured-inputs',crypto.randomUUID());fs.mkdirSync(inputDir,{recursive:true});
    for(const [index,n] of pipeline.nodes.entries())if(n.type==='input'){
      const file=this.#owned(n.data.path),stat=fs.statSync(file);if(!stat.isFile())fail('INVALID_SOURCE','Source must be a file');
      const before=fileHash(file),snapshot=path.join(inputDir,String(index)+path.extname(file));fs.copyFileSync(file,snapshot,fs.constants.COPYFILE_EXCL);const captured=fileHash(snapshot),after=fileHash(file);
      if(before!==captured||captured!==after||fs.statSync(snapshot).size!==stat.size)fail('SOURCE_CHANGED_DURING_CAPTURE','Source changed while capturing input');
      sources.push({nodeId:n.id,sourceId:sha(file),sha256:captured,bytes:stat.size,format:n.data.format||'csv',snapshotPath:snapshot,observation:'VERIFIED_EXECUTION_COPY',originalCurrentAvailability:'UNKNOWN'});n.data.path=snapshot;
    }
    compileDefinition(pipeline,'INVALID_PARAMETERS');
    const job=this.runner.createJob(pipeline),receipt={contractVersion:CONTRACT,requestId:request.requestId,jobId:job.jobId,workflowRef:clone(entry.workflowRef),status:'queued'};
    const own={receipt,registered,values,sources,executedDefinitionSha256:definitionIdentity(pipeline),result:null,error:null,settled:false};this.#jobs.set(job.jobId,own);this.#requests.set(request.requestId,{fingerprint,receipt});
    own.done=this.runner.runJob(job.jobId).then(async j=>{try { const out=j.nodeOutputs[registered.outputNodeId];if(!out||out.isOutdated)fail('RESULT_UNAVAILABLE','Output unavailable');
      for(const s of sources)if(fileHash(s.snapshotPath)!==s.sha256)fail('CAPTURED_INPUT_CHANGED','Execution copy changed before result publication');
      const schema=out.schema.map(c=>({name:c.name,dbType:c.type,nullable:c.nullable,unit:registered.units[c.name]??null,wireSchema:wireSchema(c.type)}));
      const result={resultId:job.jobId+':'+registered.outputNodeId,resultVersion:'job:'+job.jobId,schema,rows:clone(out.preview),coverage:{status:out.preview.length===out.rowCount?'COMPLETE':'SAMPLED',sourceRows:j.telemetry.totalSourceRows??null,resultRows:out.rowCount,transferredRows:out.preview.length,reason:out.preview.length===out.rowCount?null:'FIRST_N_PREVIEW_NOT_STATISTICAL_SAMPLE'},provenance:{jobId:job.jobId,requestId:request.requestId,workflowRef:clone(entry.workflowRef),executedDefinitionSha256:own.executedDefinitionSha256,parameterSha256:sha(values),sources:clone(sources),sourceCurrentAvailability:'UNKNOWN',fullResultRetention:'NOT_GUARANTEED'}};
      validateResult(result);result.integritySha256=sha(result);await verifyResult(result);own.result=clone(result);
    } catch(e){own.error={code:e.code||'INVALID_RESULT',message:e.message,retryable:false};} },e=>{if(this.runner.getJob(job.jobId)?.status!=='cancelled')own.error={code:'EXECUTION_FAILED',message:e.message,retryable:true};}).finally(()=>{own.settled=true;});
    return clone(receipt);
    }finally{this.#metadataBusy=false;}
  }
  status(jobId) { const own=this.#jobs.get(jobId),job=this.runner.getJob(jobId);if(!own||!job)fail('JOB_NOT_FOUND','Unknown job');return {...clone(own.receipt),status:own.error?'failed':job.status,settled:own.settled,error:clone(own.error),result:clone(own.result)}; }
  async cancel(jobId) {
    const own=this.#jobs.get(jobId),job=this.runner.getJob(jobId);if(!own||!job)fail('JOB_NOT_FOUND','Unknown job');
    if(terminal.has(job.status)){await own.done;const actual=this.status(jobId).status;return {jobId,requested:false,confirmed:actual==='cancelled',status:actual,reason:'ALREADY_TERMINAL'};}
    const running=job.status==='running',old=this.runner.worker,tracked=this.#children.find(c=>c.child===old);this.runner.cancelJob(jobId);
    let exited=!running;
    if(running&&tracked)exited=await Promise.race([tracked.done.then(()=>true),new Promise(resolve=>{const t=setTimeout(()=>resolve(false),2000);t.unref();})]);
    await own.done;return {jobId,requested:true,confirmed:exited,status:exited?'cancelled':'cancellation-pending',workerExited:running?exited:null};
  }
  async close(){if(this.#metadataBusy)fail('HISTORY_BUSY','Finish metadata operation before close');this.#closed=true;this.runner.destroy();await Promise.all(this.#children.map(c=>c.done));return this.#children.map(({pid,closed,code,signal})=>({pid,closed,code,signal}));}
}
