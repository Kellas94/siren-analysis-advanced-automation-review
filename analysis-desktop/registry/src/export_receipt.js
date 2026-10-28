import path from 'node:path';
import {computeFileSha256,freeze,exportStepMatches} from './result_envelope.js';
import {validateProducedExport,snapshotExportFile} from '../../engine/export_identity.js';
// A late observer can verify the worker's existing identity, never establish a new producer identity.
export function captureExportReceipt(job,nodeId,exportNodeId,resolvedFilePath=null) {
  const def=job.pipelineDef?.nodes?.find(n=>n.id===exportNodeId),out=job.nodeOutputs?.[exportNodeId],source=job.nodeOutputs?.[nodeId];
  if(job.status!=='completed'||source?.isOutdated!==false||def?.type!=='export'||out?.nodeType!=='export'||out.isOutdated!==false||!job.pipelineDef.edges.some(e=>e.source===nodeId&&e.target===exportNodeId)||!job.generatedSQL?.some(s=>s.nodeId===exportNodeId&&/^COPY\b/i.test(s.sql.trim())))throw Error('EXPORT_JOB_BINDING');
  if(!path.isAbsolute(def.data?.path||'')&&!resolvedFilePath)throw Error('EXPORT_ABSOLUTE_PATH_REQUIRED');
  const filePath=path.resolve(resolvedFilePath||def.data.path);if(!exportStepMatches(job,exportNodeId,filePath,nodeId)||(path.isAbsolute(def.data.path)&&filePath!==path.resolve(def.data.path)))throw Error('EXPORT_SQL_BINDING');
  const step=job.generatedSQL.find(s=>s.nodeId===exportNodeId&&s.nodeType==='export');
  const producerExport=validateProducedExport(out.producerExport,{jobId:job.jobId,nodeId,exportNodeId,rowCount:source.rowCount,viewName:source.viewName,step,filePath});
  const observed=snapshotExportFile(filePath);if(observed.fileSha256!==producerExport.fileSha256||observed.fileSizeBytes!==producerExport.fileSizeBytes)throw Error('EXPORT_CONTENT_MISMATCH');
  return freeze({schemaVersion:'siren.analysis-export-receipt/1',jobId:job.jobId,nodeId,exportNodeId,filePath,fileSha256:producerExport.fileSha256,fileSizeBytes:producerExport.fileSizeBytes,resultRowCount:source.rowCount,producerExport,verifiedAt:new Date().toISOString()});
}
