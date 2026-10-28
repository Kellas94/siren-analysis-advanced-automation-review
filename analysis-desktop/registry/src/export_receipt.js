import fs from 'node:fs';import path from 'node:path';
import {computeFileSha256,freeze,exportStepMatches} from './result_envelope.js';
// Capture observer receipt after a completed, directly connected actual COPY step.
// This is not authentication of an arbitrary caller-supplied job.
export function captureExportReceipt(job,nodeId,exportNodeId,resolvedFilePath=null) {
  const def=job.pipelineDef?.nodes?.find(n=>n.id===exportNodeId),out=job.nodeOutputs?.[exportNodeId],source=job.nodeOutputs?.[nodeId];
  if(job.status!=='completed'||source?.isOutdated!==false||def?.type!=='export'||out?.nodeType!=='export'||out.isOutdated!==false||!job.pipelineDef.edges.some(e=>e.source===nodeId&&e.target===exportNodeId)||!job.generatedSQL?.some(s=>s.nodeId===exportNodeId&&/^COPY\b/i.test(s.sql.trim())))throw Error('EXPORT_JOB_BINDING');
  if(!path.isAbsolute(def.data?.path||'')&&!resolvedFilePath)throw Error('EXPORT_ABSOLUTE_PATH_REQUIRED');
  const filePath=path.resolve(resolvedFilePath||def.data.path);if(!exportStepMatches(job,exportNodeId,filePath,nodeId)||(path.isAbsolute(def.data.path)&&filePath!==path.resolve(def.data.path)))throw Error('EXPORT_SQL_BINDING');
  const stat=fs.statSync(filePath);if(!stat.isFile()||!stat.size)throw Error('EXPORT_FILE');
  const fileSha256=computeFileSha256(filePath),after=fs.statSync(filePath);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('EXPORT_CHANGED_DURING_CAPTURE');
  return freeze({schemaVersion:'siren.analysis-export-receipt/1',jobId:job.jobId,nodeId,exportNodeId,filePath,fileSha256,fileSizeBytes:stat.size,resultRowCount:source.rowCount,verifiedAt:new Date().toISOString()});
}
