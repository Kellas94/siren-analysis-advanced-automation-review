import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION='siren.analysis-result/2';
export const MAX_ROWS=5000,MAX_BYTES=5*1024*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const str=v=>typeof v==='string'&&v.length>0&&v.length<=4096;
const count=v=>Number.isSafeInteger(v)&&v>=0;
const date=v=>str(v)&&Number.isFinite(Date.parse(v));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function canonicalJson(v) {
  if(v===null)return 'null';
  if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';
  if(plain(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(v[k])).join(',')+'}';
  if(typeof v==='string'||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))return JSON.stringify(v);
  throw Error('NON_JSON_VALUE: undefined/nonfinite/non-JSON object is not SQL NULL');
}
export const computeSha256=v=>crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');
const clone=v=>JSON.parse(canonicalJson(v));
export function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
export function computeFileSha256(filePath) {
  const fd=fs.openSync(filePath,'r'),h=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);
  try {let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex')}finally{fs.closeSync(fd)}
}
export function exportStepMatches(job,exportNodeId,filePath,nodeId) {
  const step=job.generatedSQL?.find(s=>s.nodeId===exportNodeId&&s.nodeType==='export');
  // This is the complete statement grammar emitted by this candidate's compiler.
  // It deliberately refuses comments, other views, extra options and statements.
  const m=typeof step?.sql==='string'&&/^\s*COPY\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+'((?:[^']|'')*)'\s+\(FORMAT\s+(PARQUET|CSV|JSON)\);\s*$/i.exec(step.sql);
  const def=job.pipelineDef?.nodes?.find(n=>n.id===exportNodeId),source=job.nodeOutputs?.[nodeId];
  return !!m&&m[1]===source?.viewName&&path.resolve(m[2].replaceAll("''","'"))===path.resolve(filePath)&&m[3].toUpperCase()===(def?.data?.format||'PARQUET').toUpperCase();
}
function schemaChecked(schema) {
  if(!Array.isArray(schema)||!schema.length||schema.length>32)throw Error('SCHEMA_REQUIRED: 1..32 exact DuckDB columns required');
  const names=new Set();return schema.map(c=>{
    if(!plain(c))throw Error('SCHEMA_COLUMN');const name=c.name??c.columnName,type=c.type??c.columnType;
    if(!str(name)||name.length>128||['__proto__','prototype','constructor'].includes(name)||names.has(name))throw Error('SCHEMA_COLUMN_NAME');names.add(name);
    if(!str(type)||typeof c.nullable!=='boolean'||(c.name&&c.columnName&&c.name!==c.columnName)||(c.type&&c.columnType&&c.type!==c.columnType))throw Error('SCHEMA_TYPE_REQUIRED');
    const t=type.toUpperCase();if(!/^(?:VARCHAR|TEXT|CHAR|STRING|BOOLEAN|BOOL|(?:U?BIGINT|U?HUGEINT|U?INTEGER|U?SMALLINT|U?TINYINT|INT[1248]?|UINT[1248])|DOUBLE|FLOAT|REAL|DATE|(?:DECIMAL|NUMERIC)\(\d+,\s*\d+\))$/.test(t))throw Error('SQL_TYPE_UNSUPPORTED: '+type);
    if(/^(DECIMAL|NUMERIC)/.test(t)){const [,p,s]=t.match(/\((\d+),\s*(\d+)\)/);if(+p<1||+p>38||+s>+p)throw Error('DECIMAL_BOUNDS')}
    return {...clone(c),name,type,columnName:name,columnType:type,nullable:c.nullable};
  });
}
export function sanitizeCellValue(v,c) {
  if(v===undefined)throw Error('UNDEFINED_VALUE');if(v===null){if(!c.nullable)throw Error('NULL_VIOLATION');return null}
  const t=c.type.toUpperCase();
  if(/^(VARCHAR|TEXT|CHAR|STRING)$/.test(t)){if(typeof v!=='string')throw Error('VARCHAR_REPRESENTATION');return v}
  if(/^(BOOLEAN|BOOL)$/.test(t)){if(typeof v!=='boolean')throw Error('BOOLEAN_REPRESENTATION');return v}
  if(t==='DATE'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('DATE_REPRESENTATION');return v}
  if(/^(DECIMAL|NUMERIC)/.test(t)){
    if(typeof v!=='string'||! /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v))throw Error('DECIMAL_REPRESENTATION');
    const [,p,s]=t.match(/\((\d+),\s*(\d+)\)/),parts=v.replace('-','').split('.');
    if(+p<1||+p>38||+s>+p||(parts[1]?.length||0)>+s||parts[0].replace(/^0+/,'').length>+p-+s)throw Error('DECIMAL_BOUNDS');return v;
  }
  if(/INT/.test(t)){
    if(typeof v==='bigint')v=v.toString();
    const numeric=typeof v==='number';if(numeric&&!Number.isSafeInteger(v))throw Error('INTEGER_PRECISION');
    const original=v;if(numeric)v=String(v);
    if(typeof v!=='string'||! /^-?(?:0|[1-9]\d*)$/.test(v))throw Error('INTEGER_REPRESENTATION');
    const n=BigInt(v),bits=t.includes('HUGE')?128:t.includes('BIG')||t==='INT8'||t==='UINT8'?64:t.includes('SMALL')||t==='INT2'||t==='UINT2'?16:t.includes('TINY')||t==='INT1'||t==='UINT1'?8:32;
    const unsigned=t.startsWith('U'),min=unsigned?0n:-(1n<<BigInt(bits-1)),max=unsigned?(1n<<BigInt(bits))-1n:(1n<<BigInt(bits-1))-1n;
    if(n<min||n>max)throw Error('INTEGER_BOUNDS');return original;
  }
  if(typeof v!=='number'||!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))throw Error('FLOAT_REPRESENTATION');return v;
}
function rowsChecked(rows,schema){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw Error('ROW_LIMIT');const names=schema.map(c=>c.name);
  return rows.map(row=>{if(!plain(row)||Object.keys(row).length!==names.length||Object.keys(row).some(k=>!names.includes(k)))throw Error('ROW_SCHEMA_MISMATCH');const values={};for(const c of schema){if(!Object.hasOwn(row,c.name))throw Error('MISSING_COLUMN');values[c.name]=sanitizeCellValue(row[c.name],c)}return values});
}
export function semanticIdentity(record) {
  const {resultId,capturedAt,integritySha256,...payload}=record;
  const ref={...payload.exportReference};delete ref.verifiedAt;return {...payload,exportReference:ref};
}
export function validateResultEnvelope(r) {
  if(!plain(r)||r.schemaVersion!==SCHEMA_VERSION)throw Error('UNSUPPORTED_SCHEMA_VERSION: expected sealed result/2');
  if(!/^res_[a-f0-9]{64}$/.test(r.resultId||'')||!date(r.capturedAt)||!plain(r.job)||!str(r.job.jobId)||r.job.status!=='completed'||!date(r.job.createdAt)||!date(r.job.completedAt)||!plain(r.node)||!str(r.node.nodeId))throw Error('RESULT_IDENTITY');
  const schema=schemaChecked(r.schema),rows=rowsChecked(r.data?.rows,schema),c=r.counts;
  if(!plain(c)||!(c.sourceRowCount===null||count(c.sourceRowCount))||!count(c.resultRowCount)||c.capturedRows!==rows.length||c.resultRowCount<c.capturedRows||!['COMPLETE','SAMPLED','TRUNCATED'].includes(c.transferStatus))throw Error('RESULT_COUNTS');
  if((c.transferStatus==='COMPLETE')!==(c.resultRowCount===rows.length))throw Error('RESULT_COVERAGE');
  if(c.transferStatus==='SAMPLED'&&(!str(c.selection?.method)||!str(c.selection?.description)))throw Error('SELECTION_REQUIRED');
  if(r.data.mode!==(c.transferStatus==='COMPLETE'?'complete':'bounded_preview')||r.data.contentSha256!==computeSha256({schema,rows}))throw Error('RESULT_CONTENT_HASH');
  if(!plain(r.lineage)||!Array.isArray(r.lineage.sources)||!Array.isArray(r.lineage.pipelineNodes)||!plain(r.exportReference))throw Error('RESULT_LINEAGE');
  if(r.resultId!=='res_'+computeSha256(semanticIdentity(r))||!digest(r.integritySha256)){throw Error('RESULT_SEMANTIC_ID')}
  const {integritySha256,...payload}=r;if(integritySha256!==computeSha256(payload))throw Error('RESULT_INTEGRITY_HASH');
  if(Buffer.byteLength(JSON.stringify(r,null,2))>MAX_BYTES)throw Error('RESULT_BYTE_LIMIT');return r;
}
export function buildResultEnvelope(params) {
  const {job,nodeId,sourceNodes,maxPreviewRows=MAX_ROWS,exportFilePath=null,exportReceipt=null,selection=null}=params||{};
  if(!plain(job)||job.status!=='completed')throw Error('INVALID_JOB_STATE');
  if(!str(job.jobId)||!date(job.createdAt)||!date(job.completedAt)||!str(nodeId))throw Error('JOB_IDENTITY');
  const n=job.nodeOutputs?.[nodeId];if(!n)throw Error('NODE_OUTPUT_MISSING');if(n.isOutdated!==false)throw Error('OUTDATED_RESULT_REJECTED');
  if(n.nodeId!==undefined&&n.nodeId!==nodeId)throw Error('NODE_ID_MISMATCH');if(!count(n.rowCount)||!count(maxPreviewRows)||maxPreviewRows>MAX_ROWS)throw Error('RESULT_ROW_COUNT_REQUIRED');
  const schema=schemaChecked(n.schema),rawRows=rowsChecked(n.preview,schema);if(rawRows.length>n.rowCount)throw Error('RESULT_COUNTS');const rows=rawRows.slice(0,maxPreviewRows);
  const resultRowCount=n.rowCount,capturedRows=rows.length,transferStatus=capturedRows===resultRowCount?'COMPLETE':selection?'SAMPLED':'TRUNCATED';
  let sourceRowCount=job.telemetry?.totalSourceRows;if(sourceRowCount!==undefined&&sourceRowCount!==null&&!count(sourceRowCount))throw Error('SOURCE_ROW_COUNT');if(sourceRowCount==null)sourceRowCount=n.nodeType==='input'?n.rowCount:null;
  const nodes=job.pipelineDef?.nodes||[],derivedSources=nodes.filter(x=>x.type==='input').map(x=>({sourceId:x.id,path:x.data?.path??null}));
  const sources=sourceNodes===undefined?derivedSources:clone(sourceNodes);if(!Array.isArray(sources))throw Error('SOURCE_LINEAGE');
  const ref={available:false,filePath:exportFilePath?path.resolve(exportFilePath):null,fileSha256:null,fileSizeBytes:null,verifiedAt:null,status:exportFilePath?'UNBOUND':'NONE'};
  if(exportReceipt){
    const e=exportReceipt;
    if(e.schemaVersion!=='siren.analysis-export-receipt/1'||e.jobId!==job.jobId||e.nodeId!==nodeId||!str(e.filePath)||!digest(e.fileSha256)||!count(e.fileSizeBytes)||!e.fileSizeBytes||e.resultRowCount!==resultRowCount||!date(e.verifiedAt)||!str(e.exportNodeId))throw Error('EXPORT_RECEIPT_BINDING');
    const def=nodes.find(x=>x.id===e.exportNodeId),out=job.nodeOutputs?.[e.exportNodeId],edge=job.pipelineDef?.edges?.some(x=>x.source===nodeId&&x.target===e.exportNodeId);
    if(def?.type!=='export'||out?.nodeType!=='export'||out.isOutdated!==false||!edge||!exportStepMatches(job,e.exportNodeId,e.filePath,nodeId)||(path.isAbsolute(def.data?.path||'')&&path.resolve(def.data.path)!==path.resolve(e.filePath))||(exportFilePath&&path.resolve(exportFilePath)!==path.resolve(e.filePath)))throw Error('EXPORT_JOB_BINDING');
    const st=fs.statSync(e.filePath);if(!st.isFile()||st.size!==e.fileSizeBytes||computeFileSha256(e.filePath)!==e.fileSha256)throw Error('EXPORT_CONTENT_MISMATCH');
    Object.assign(ref,{available:true,filePath:path.resolve(e.filePath),fileSha256:e.fileSha256,fileSizeBytes:e.fileSizeBytes,verifiedAt:e.verifiedAt,status:'VERIFIED'});
  }
  const r={schemaVersion:SCHEMA_VERSION,capturedAt:new Date().toISOString(),job:{jobId:job.jobId,status:'completed',createdAt:job.createdAt,completedAt:job.completedAt,durationMs:job.telemetry?.durationMs??0},node:{nodeId,nodeType:n.nodeType||'view',viewName:n.viewName??null},lineage:{sources,pipelineNodes:nodes.map(x=>x.id),pipelineDef:clone(job.pipelineDef||{nodes:[],edges:[]}),generatedSQL:clone(job.generatedSQL||[])},counts:{sourceRowCount,resultRowCount,capturedRows,transferStatus,...(selection?{selection:clone(selection)}:{})},schema,data:{mode:transferStatus==='COMPLETE'?'complete':'bounded_preview',rows,contentSha256:computeSha256({schema,rows})},exportReference:ref};
  r.resultId='res_'+computeSha256(semanticIdentity(r));r.integritySha256=computeSha256(r);validateResultEnvelope(r);return freeze(r);
}
