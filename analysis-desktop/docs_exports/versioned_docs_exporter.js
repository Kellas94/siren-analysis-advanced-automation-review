import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DocsExportError,ErrorCodes} from './errors.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(code,message,detail={})=>{throw new DocsExportError(code,message,detail);};
export function sanitizeSlug(text,defaultSlug='export'){if(typeof text!=='string')return defaultSlug;return text.replace(/[^a-zA-Z0-9_-]/g,'_').replace(/_+/g,'_').slice(0,24)||defaultSlug;}
export function computeEnvelopeSha256(envelope){return hash(Buffer.from(JSON.stringify(envelope,null,2),'utf8'));}
function fileName(name){
 if(typeof name!=='string'||name.length>180||!name.endsWith('.sirendoc.json')||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)||name.includes('..')||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))fail(ErrorCodes.INVALID_PATH_SEGMENT,'Portable regular .sirendoc.json filename required');
 return name;
}
function identity(p){const s=fs.lstatSync(p,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.ino===0n)fail(ErrorCodes.WRITE_FAILED,'Identifiable regular file required');return {dev:s.dev,ino:s.ino};}
function same(p,id){try{const s=identity(p);return s.dev===id.dev&&s.ino===id.ino;}catch{return false;}}
function removeOwned(p,id){if(!id||!same(p,id))return false;fs.unlinkSync(p);return true;}
export class VersionedDocsExporter{
 constructor({exportDir,_injectedHooks={}}={}){
  if(typeof exportDir!=='string'||!exportDir||!path.isAbsolute(exportDir))fail(ErrorCodes.INVALID_OUTPUT_DIR,'Explicit absolute exportDir required');
  this.exportDir=path.resolve(exportDir);this._hooks=_injectedHooks||{};
  try{fs.mkdirSync(this.exportDir,{recursive:true});const s=fs.lstatSync(this.exportDir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Regular private directory required');}catch(e){fail(ErrorCodes.INVALID_OUTPUT_DIR,e.message);}
 }
 generateUniqueFileName(e,nonce=null){return 'analysis_export_'+sanitizeSlug(e?.metadata?.jobId,'job')+'_'+sanitizeSlug(e?.metadata?.sourcePipelineNode,'node')+'_'+new Date().toISOString().replace(/[-:.]/g,'')+'_'+(nonce||crypto.randomBytes(8).toString('hex'))+'.sirendoc.json';}
 validateEnvelope(e){for(const k of ['metadata','document','workbooks'])if(!e||typeof e!=='object'||Array.isArray(e)||!e[k]||typeof e[k]!=='object'||Array.isArray(e[k]))fail(ErrorCodes.INVALID_DOCS_ENVELOPE,'Envelope requires object '+k);if(typeof e.schemaVersion!=='string'||!e.schemaVersion)fail(ErrorCodes.INVALID_DOCS_ENVELOPE,'String schemaVersion required');}
 async exportEnvelope(envelope,options={}){
  this.validateEnvelope(envelope);
  const policy=options.collisionPolicy??'avoid';if(!['avoid','reject'].includes(policy))fail(ErrorCodes.FILE_COLLISION,'Invalid collisionPolicy');
  let targetFileName=fileName(options.suggestedFileName??this.generateUniqueFileName(envelope)),targetFilePath=path.join(this.exportDir,targetFileName),fd=null,id=null,published=false;
  const staging=path.join(this.exportDir,'.siren-docs-'+crypto.randomUUID()+'.tmp');let bytes;
  try{bytes=Buffer.from(JSON.stringify(envelope,null,2),'utf8');}catch(e){fail(ErrorCodes.INVALID_DOCS_ENVELOPE,e.message);}
  const digest=hash(bytes),verify=buffer=>{
   if(buffer.length!==bytes.length)fail(ErrorCodes.READBACK_BYTE_COUNT_MISMATCH,'Readback byte count mismatch');
   if(hash(buffer)!==digest||!buffer.equals(bytes))fail(ErrorCodes.READBACK_HASH_MISMATCH,'Readback exact bytes mismatch');
   try{JSON.parse(buffer.toString('utf8'));}catch(e){fail(ErrorCodes.READBACK_PARSE_ERROR,e.message);}
  },context=()=>({fd,targetFilePath:staging,finalFilePath:targetFilePath});
  try{
   if(this._hooks.beforeOpen)await this._hooks.beforeOpen({...context(),attempts:1});
   fd=fs.openSync(staging,'wx');const st=fs.fstatSync(fd,{bigint:true});id={dev:st.dev,ino:st.ino};
   if(!st.isFile()||id.ino===0n)fail(ErrorCodes.WRITE_FAILED,'Identifiable staging file required');
   if(this._hooks.beforeWrite)await this._hooks.beforeWrite(context());
   if(!same(staging,id))fail(ErrorCodes.WRITE_FAILED,'Staging path ownership changed');
   const count=fs.writeSync(fd,bytes,0,bytes.length);if(count!==bytes.length)fail(ErrorCodes.WRITE_FAILED,'Partial write detected');
   if(this._hooks.afterWrite)await this._hooks.afterWrite(context());
   try{fs.fsyncSync(fd);}catch(e){fail(ErrorCodes.FSYNC_FAILED,e.message);}
   if(this._hooks.beforeClose)await this._hooks.beforeClose(context());
   fs.closeSync(fd);fd=null;
   if(this._hooks.afterClose)await this._hooks.afterClose(context());
   if(!same(staging,id))fail(ErrorCodes.WRITE_FAILED,'Staging path ownership changed');
   let readback;try{readback=fs.readFileSync(staging);}catch(e){fail(ErrorCodes.READBACK_FAILED,e.message);}verify(readback);
   if(this._hooks.mockReadBackBuffer)verify(this._hooks.mockReadBackBuffer({...context(),originalBuffer:bytes}));
   if(computeEnvelopeSha256(envelope)!==digest)fail(ErrorCodes.ENVELOPE_IDENTITY_CHANGED,'Input envelope changed during export');
   const originalName=targetFileName;
   for(let attempt=0;attempt<50;attempt++){
    if(this._hooks.beforePublish)await this._hooks.beforePublish({...context(),attempts:attempt+1});
    if(!same(staging,id))fail(ErrorCodes.WRITE_FAILED,'Staging ownership changed before publication');
    verify(fs.readFileSync(staging));
    if(computeEnvelopeSha256(envelope)!==digest)fail(ErrorCodes.ENVELOPE_IDENTITY_CHANGED,'Input changed before publication');
    // Publish already complete verified bytes exclusively. No replacing rename
    // or non-atomic copy fallback on a filesystem without hard-link support.
    try{fs.linkSync(staging,targetFilePath);published=true;break;}catch(e){
     if(e.code!=='EEXIST')throw e;if(policy==='reject')fail(ErrorCodes.FILE_COLLISION,'Destination already exists');
     targetFileName=fileName(originalName.slice(0,-'.sirendoc.json'.length)+'_coll_'+(attempt+1)+'_'+crypto.randomBytes(8).toString('hex')+'.sirendoc.json');targetFilePath=path.join(this.exportDir,targetFileName);
    }
   }
   if(!published)fail(ErrorCodes.FILE_COLLISION,'No unused destination after50 attempts');
   if(this._hooks.afterPublish)await this._hooks.afterPublish({targetFilePath,stagingPath:staging});
   if(!same(targetFilePath,id)||!same(staging,id))fail(ErrorCodes.WRITE_FAILED,'Published path ownership changed');
   if(computeEnvelopeSha256(envelope)!==digest)fail(ErrorCodes.ENVELOPE_IDENTITY_CHANGED,'Input changed after publication');
   verify(fs.readFileSync(targetFilePath));removeOwned(staging,id);
   return {success:true,absoluteFilePath:targetFilePath,fileName:targetFileName,byteCount:bytes.length,sha256:digest,schemaVersion:envelope.schemaVersion,jobId:envelope.metadata.jobId??null,nodeId:envelope.metadata.sourcePipelineNode??null,transferStatus:envelope.metadata.transferStatus??null,transferredRows:envelope.metadata.transferredRows??null,totalResultRows:envelope.metadata.totalResultRows??null,exportedAt:new Date().toISOString()};
  }catch(e){
   if(fd!==null){try{fs.closeSync(fd);}catch{}}
   const cleanup=[];for(const p of [...(published?[targetFilePath]:[]),staging])try{if(fs.existsSync(p)&&!removeOwned(p,id))cleanup.push({path:p,status:'PRESERVED_CHANGED_OWNER'});}catch(ex){cleanup.push({path:p,status:'CLEANUP_FAILED',error:ex.message});}
   if(e instanceof DocsExportError){e.detail={...e.detail,cleanup};throw e;}fail(ErrorCodes.WRITE_FAILED,e.message,{cleanup});
  }
 }
}
