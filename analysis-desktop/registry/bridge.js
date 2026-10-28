import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {ResultRegistry} from './src/result_registry.js';import {computeSha256,canonicalJson} from './src/result_envelope.js';import {writeJsonAtomic} from './src/atomic_fs.js';import {captureExportReceipt} from './src/export_receipt.js';
import {AnalysisToChartsAdapter} from '../adapter/src/analysis_to_charts_adapter.js';
const require=createRequire(import.meta.url),corePath=fileURLToPath(new URL('../chart-core.cjs',import.meta.url)),C=require(corePath);
export function definitionIdentity(def){
  if(!def||!Array.isArray(def.nodes)||!Array.isArray(def.edges))throw Error('WORKFLOW_DEFINITION_REQUIRED');
  const transient=new Set(['status','preview','rowCount','isOutdated','label']);
  // Compiler scheduling and legacy input-port fallback depend on array order.
  // Preserve both arrays; only editor-only presentation/state fields are omitted.
  const nodes=def.nodes.map(n=>({id:n.id,type:n.type,data:Object.fromEntries(Object.entries(n.data||{}).filter(([k])=>!transient.has(k)))}));
  const edges=def.edges.map(e=>({source:e.source,target:e.target,targetHandle:e.targetHandle??null}));
  return computeSha256(JSON.parse(JSON.stringify({nodes,edges})));
}
export function createRegistryBridge({storageDir,exportDir}){
  const registry=new ResultRegistry({storageDir});
  return {
    registry,
    async capture(job,nodeId,currentDefinition,dataDir){
      if(definitionIdentity(job?.pipelineDef)!==definitionIdentity(currentDefinition))throw Error('WORKFLOW_CHANGED: rulează explicit definiția actuală înainte de păstrare.');
      // Same JSON boundary used by existing job-status IPC; optional DSL fields are absent,
      // while native worker cell representations are already JSON primitives/strings.
      job=JSON.parse(JSON.stringify(job));
      const exportNode=job.pipelineDef.nodes.find(n=>n.type==='export'&&job.pipelineDef.edges.some(e=>e.source===nodeId&&e.target===n.id));
      let exportReceipt=null;if(exportNode){const raw=exportNode.data?.path;const resolved=path.isAbsolute(raw||'')?raw:path.resolve(dataDir,path.basename(raw));exportReceipt=captureExportReceipt(job,nodeId,exportNode.id,resolved)}
      return registry.registerResult({job,nodeId,...(exportReceipt?{exportReceipt,exportFilePath:exportReceipt.filePath}:{})});
    },
    list(){return registry.listResults()},
    open(resultId,expectedIntegrity){const r=registry.getResult(resultId);if(!r)throw Error('RESULT_NOT_FOUND');if(expectedIntegrity&&r.integritySha256!==expectedIntegrity)throw Error('RESULT_REVISION_MISMATCH');return r},
    async chart({resultId,expectedIntegrity,dimension,measure}){
      const r=this.open(resultId,expectedIntegrity);if(r.counts.transferStatus==='TRUNCATED')throw Error('TRUNCATION_REFUSED: cere un rezultat agregat complet sau un eșantion explicit.');
      if(r.counts.sourceRowCount===null)throw Error('SOURCE_COUNT_UNKNOWN: nu inventăm numărul rândurilor sursei.');
      if(dimension===measure)throw Error('CHART_COLUMNS: alege două coloane distincte');
      const x=r.schema.find(c=>c.name===dimension),y=r.schema.find(c=>c.name===measure);if(!x||!y)throw Error('CHART_COLUMNS: coloană absentă în versiunea păstrată');
      const integerText=/INT/.test(x.type.toUpperCase())&&r.data.rows.every(v=>v[dimension]===null||typeof v[dimension]==='string');
      const input={schema:[{...x,name:'dimension',columnName:'dimension',label:x.name},{...y,name:'measure',columnName:'measure',label:y.name}],rows:r.data.rows.map(row=>({dimension:row[dimension],measure:row[measure]})),source:{sourceId:'registry:'+r.resultId,jobId:r.job.jobId,resultVersion:'registry-integrity-sha256:'+r.integritySha256,capturedAt:r.capturedAt,state:'unknown'},coverage:{kind:r.counts.transferStatus==='SAMPLED'?'sampled':r.node.nodeType==='aggregate'?'aggregate':'complete',sourceRowCount:r.counts.sourceRowCount,resultRowCount:r.counts.resultRowCount,transferredRows:r.counts.capturedRows,...(r.counts.selection?{selection:r.counts.selection}:{}),...(r.node.nodeType==='aggregate'?{aggregation:{description:'Analysis '+canonicalJson(r.lineage.pipelineDef.nodes.find(n=>n.id===r.node.nodeId)?.data||{}),type:'SQL'}}:{})},columnHints:{dimension:{role:'dimension',unit:x.unit??null,...(integerText?{type:'string'}:{})},measure:{role:'measure',unit:y.unit??null}}};
      const snapshot=AnalysisToChartsAdapter.transform(input,{chartsCorePath:corePath}),definition=C.defaultDefinition(snapshot);definition.x='dimension';definition.y=['measure'];definition.title='Rezultat păstrat · '+r.node.nodeId;definition.xLabel=x.name;definition.yLabel=y.name;definition.appearance='light';C.project(snapshot,definition);
      const file=await C.pack(snapshot,definition);await C.unpack(JSON.stringify(file));fs.mkdirSync(exportDir,{recursive:true});
      const chartFilePath=path.join(exportDir,file.snapshotSha256+'.sirenchart.json'),receiptPath=path.join(exportDir,file.snapshotSha256+'.registry-receipt.json');
      const receipt={schemaVersion:'siren.registry-chart-export/1',resultId:r.resultId,registryIntegritySha256:r.integritySha256,jobId:r.job.jobId,nodeId:r.node.nodeId,sourceSchema:r.schema,mapping:{dimension:x.name,measure:y.name},snapshotSha256:file.snapshotSha256,chartIntegritySha256:file.integritySha256,coverage:snapshot.coverage};
      writeJsonAtomic(chartFilePath,file);writeJsonAtomic(receiptPath,receipt);
      return {chartFilePath,receiptPath,resultId:r.resultId,snapshotSha256:file.snapshotSha256,registryIntegritySha256:r.integritySha256};
    }
  };
}
