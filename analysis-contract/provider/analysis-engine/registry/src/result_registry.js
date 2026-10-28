import path from 'node:path';import fs from 'node:fs';
import {snapshotExportFile} from '../../engine/export_identity.js';
import {SCHEMA_VERSION,buildResultEnvelope,validateResultEnvelope,computeFileSha256,semanticIdentity,computeSha256,freeze} from './result_envelope.js';
import {writeJsonAtomic,readJsonSafe} from './atomic_fs.js';
const INDEX='siren.analysis-registry-index/2';
export class ResultRegistry {
  constructor({storageDir=path.resolve('data/registry')}={}) {
    this.storageDir=path.resolve(storageDir);this.resultsDir=path.join(this.storageDir,'results');this.indexFile=path.join(this.storageDir,'registry_index.json');
    fs.mkdirSync(this.resultsDir,{recursive:true});
    if(!fs.existsSync(this.indexFile)){try{writeJsonAtomic(this.indexFile,{schemaVersion:INDEX,mode:'immutable-record-directory',createdAt:new Date().toISOString()})}catch(e){if(e.code!=='EEXIST')throw e}}
    this.readDescriptor();
  }
  readDescriptor(){const d=readJsonSafe(this.indexFile,INDEX);if(d.mode!=='immutable-record-directory'||typeof d.createdAt!=='string'||!Number.isFinite(Date.parse(d.createdAt)))throw Error('REGISTRY_DESCRIPTOR');return d}
  recordPath(id){if(typeof id!=='string'||!/^res_[a-f0-9]{64}$/.test(id))throw Error('RESULT_ID_INVALID');return path.join(this.resultsDir,id+'.json')}
  async registerResult(params) {
    const r=buildResultEnvelope(params);this.readDescriptor();const p=this.recordPath(r.resultId);
    try{writeJsonAtomic(p,r)}catch(e){if(e.code!=='EEXIST')throw e;const prior=this.getResult(r.resultId);if(computeSha256(semanticIdentity(prior))!==computeSha256(semanticIdentity(r)))throw Error('RESULT_ID_COLLISION');return prior}
    return this.getResult(r.resultId);
  }
  getResult(id){this.readDescriptor();const p=this.recordPath(id);if(!fs.existsSync(p))return null;const r=readJsonSafe(p,SCHEMA_VERSION);validateResultEnvelope(r);if(r.resultId!==id)throw Error('RESULT_LOOKUP_MISMATCH');return freeze(r)}
  hasResult(id){return this.getResult(id)!==null}
  listResults(){
    this.readDescriptor();const records=[];
    for(const file of fs.readdirSync(this.resultsDir).sort()){
      if(/^\.pending-[a-f0-9-]+\.json$/.test(file))continue;
      if(!/^res_[a-f0-9]{64}\.json$/.test(file))throw Error('UNEXPECTED_REGISTRY_ENTRY: '+file);
      const r=this.getResult(file.slice(0,-5));records.push({resultId:r.resultId,capturedAt:r.capturedAt,jobId:r.job.jobId,nodeId:r.node.nodeId,nodeType:r.node.nodeType,...r.counts,contentSha256:r.data.contentSha256,integritySha256:r.integritySha256,exportStatus:r.exportReference.available&&!r.exportReference.producerExport?'LEGACY_EXECUTION_UNBOUND':r.exportReference.status,file:'results/'+file});
    }
    return freeze(records);
  }
  pendingWrites(){this.readDescriptor();return fs.readdirSync(this.resultsDir).filter(n=>/^\.pending-[a-f0-9-]+\.json$/.test(n))}
  verifyExportReference(id){
    const r=this.getResult(id);if(!r)throw Error('RESULT_NOT_FOUND');const ref=r.exportReference;
    if(!ref.available)return {verified:false,status:ref.status,details:{filePath:ref.filePath}};
    if(!fs.existsSync(ref.filePath))return {verified:false,status:'FILE_MISSING',details:{filePath:ref.filePath,expectedSha256:ref.fileSha256}};
    let observed;
    try{observed=snapshotExportFile(ref.filePath)}catch(error){return {verified:false,status:error.code==='ENOENT'?'FILE_MISSING':error.message==='EXPORT_CHANGED_DURING_CAPTURE'?'EXPORT_CHANGED_DURING_VERIFICATION':'EXPORT_VERIFICATION_FAILED',details:{filePath:ref.filePath,error:error.message}}}
    const hash=observed.fileSha256,st={size:observed.fileSizeBytes};
    if(st.size!==ref.fileSizeBytes||hash!==ref.fileSha256)return {verified:false,status:'HASH_MISMATCH',details:{expectedSha256:ref.fileSha256,observedSha256:hash}};
    if(!ref.producerExport)return {verified:false,status:'LEGACY_EXECUTION_UNBOUND',contentVerified:true,details:{filePath:ref.filePath,sha256:hash,sizeBytes:st.size}};
    return {verified:true,status:'VERIFIED',details:{filePath:ref.filePath,sha256:hash,sizeBytes:st.size}};
  }
}
