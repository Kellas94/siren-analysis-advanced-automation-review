// Producer-owned COPY publication. File identity is captured before publishing a mutable destination.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export const PRODUCED_EXPORT='siren.analysis-produced-export/1';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const text=v=>typeof v==='string'&&v.length>0&&v.length<=4096;
const count=v=>Number.isSafeInteger(v)&&v>=0;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=['schemaVersion','jobId','nodeId','exportNodeId','filePath','producerFilePath','fileSha256','fileSizeBytes','resultRowCount','format','viewName','querySha256','completedAt'];
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
export function parseCopy(sql){
 const m=typeof sql==='string'&&/^\s*COPY\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+'((?:[^']|'')*)'\s+\(FORMAT\s+(PARQUET|CSV|JSON)\);\s*$/i.exec(sql);
 if(!m)throw Error('EXPORT_COPY_GRAMMAR');const filePath=m[2].replaceAll("''","'");if(!path.isAbsolute(filePath))throw Error('EXPORT_ABSOLUTE_PATH_REQUIRED');return{viewName:m[1],filePath:path.resolve(filePath),format:m[3].toUpperCase()};
}
export function snapshotExportFile(filePath){
 const before=fs.statSync(filePath,{bigint:true});if(!before.isFile()||before.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('EXPORT_FILE');
 const fd=fs.openSync(filePath,'r');let result;
 try{const opened=fs.fstatSync(fd,{bigint:true});if(!same(before,opened))throw Error('EXPORT_CHANGED_DURING_CAPTURE');const h=crypto.createHash('sha256'),b=Buffer.alloc(1024*1024);let total=0;
  while(true){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;total+=n;if(BigInt(total)>opened.size)throw Error('EXPORT_CHANGED_DURING_CAPTURE');h.update(b.subarray(0,n));}
  if(BigInt(total)!==opened.size||!same(opened,fs.fstatSync(fd,{bigint:true}))||!same(opened,fs.statSync(filePath,{bigint:true})))throw Error('EXPORT_CHANGED_DURING_CAPTURE');result={fileSha256:h.digest('hex'),fileSizeBytes:total,identity:opened};
 }finally{fs.closeSync(fd)}return result;
}
export function prepareExport(step,source){
 const parsed=parseCopy(step.sql);if(!source||parsed.viewName!==source.viewName||!count(source.rowCount)||!text(source.nodeId))throw Error('EXPORT_SOURCE_BINDING');
 // Sibling staging keeps publication on the same filesystem. No target is truncated by COPY.
 const directory=fs.mkdtempSync(path.join(path.dirname(parsed.filePath),'.siren-export-'));
 const producerFilePath=path.join(directory,'output.'+parsed.format.toLowerCase()),quoted=producerFilePath.replaceAll('\\','/').replaceAll("'","''");
 const sql=`COPY ${parsed.viewName} TO '${quoted}' (FORMAT ${parsed.format});`;
 return{directory,producerFilePath,filePath:parsed.filePath,format:parsed.format,viewName:parsed.viewName,nodeId:source.nodeId,resultRowCount:source.rowCount,sql};
}
export function publishProducedExport(prepared,{jobId,exportNodeId}){
 if(!text(jobId)||!text(exportNodeId))throw Error('EXPORT_PRODUCER_IDENTITY');
 const observed=snapshotExportFile(prepared.producerFilePath);if(observed.fileSizeBytes===0&&prepared.resultRowCount!==0)throw Error('EXPORT_EMPTY_CONTENT');
 // COPY and hashing use the private target; a concurrent normal export only sees the public destination.
 fs.renameSync(prepared.producerFilePath,prepared.filePath);
 const after=fs.statSync(prepared.filePath,{bigint:true});if(after.dev!==observed.identity.dev||after.ino!==observed.identity.ino||after.size!==observed.identity.size||after.mtimeNs!==observed.identity.mtimeNs)throw Error('EXPORT_PUBLISH_CHANGED');
 try{fs.rmdirSync(prepared.directory)}catch{} // Successful publication is not undone by empty-stage cleanup failure.
 return{schemaVersion:PRODUCED_EXPORT,jobId,nodeId:prepared.nodeId,exportNodeId,filePath:prepared.filePath,producerFilePath:prepared.producerFilePath,fileSha256:observed.fileSha256,fileSizeBytes:observed.fileSizeBytes,resultRowCount:prepared.resultRowCount,format:prepared.format,viewName:prepared.viewName,querySha256:hash(prepared.sql),completedAt:new Date().toISOString()};
}
export function validateProducedExport(value,{jobId,nodeId,exportNodeId,rowCount,viewName,step,filePath}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('EXPORT_PRODUCER_REQUIRED');
 const p=value;if(p.schemaVersion!==PRODUCED_EXPORT||!text(p.jobId)||!text(p.nodeId)||!text(p.exportNodeId)||!text(p.filePath)||!text(p.producerFilePath)||!path.isAbsolute(p.filePath)||!path.isAbsolute(p.producerFilePath)||!digest(p.fileSha256)||!count(p.fileSizeBytes)||!count(p.resultRowCount)||!['PARQUET','CSV','JSON'].includes(p.format)||!text(p.viewName)||!digest(p.querySha256)||!text(p.completedAt)||!Number.isFinite(Date.parse(p.completedAt))||(p.fileSizeBytes===0&&p.resultRowCount!==0))throw Error('EXPORT_PRODUCER_REQUIRED');
 if(jobId!==undefined&&p.jobId!==jobId||nodeId!==undefined&&p.nodeId!==nodeId||exportNodeId!==undefined&&p.exportNodeId!==exportNodeId||rowCount!==undefined&&p.resultRowCount!==rowCount||viewName!==undefined&&p.viewName!==viewName||filePath!==undefined&&path.resolve(p.filePath)!==path.resolve(filePath))throw Error('EXPORT_PRODUCER_BINDING');
 if(step){const actual=parseCopy(step.sql);if(actual.viewName!==p.viewName||actual.format!==p.format||actual.filePath!==path.resolve(p.producerFilePath)||p.querySha256!==hash(step.sql)||path.resolve(step.exportDestination||'')!==path.resolve(p.filePath))throw Error('EXPORT_PRODUCER_SQL_BINDING');}
 return JSON.parse(JSON.stringify(p));
}
