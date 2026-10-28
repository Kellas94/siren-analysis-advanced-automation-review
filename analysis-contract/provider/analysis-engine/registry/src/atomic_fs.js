import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Publish once. No replacement, unlink-old fallback or mutable shared index.
// A completed hard-link publish can be discovered after a lost acknowledgement.
export function writeJsonAtomic(filePath, data, options = {}) {
  const dir=path.dirname(filePath);fs.mkdirSync(dir,{recursive:true});
  const text=JSON.stringify(data,null,options.indent??2);
  const pending=path.join(dir,`.pending-${crypto.randomUUID()}.json`);
  let fd;
  try {
    fd=fs.openSync(pending,'wx');fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.linkSync(pending,filePath); // EEXIST refuses to overwrite another published record.
  } finally {
    if(fd!==undefined)fs.closeSync(fd);
    // Only this invocation's private staging name is removed, never a destination.
    try{fs.unlinkSync(pending)}catch(e){if(e.code!=='ENOENT')throw e}
  }
}
export function readJsonSafe(filePath,expectedSchemaVersion=null,maxBytes=5*1024*1024) {
  const stat=fs.statSync(filePath);if(!stat.isFile()||stat.size>maxBytes)throw Error('REGISTRY_FILE_SIZE: expected bounded regular file');
  let value;try{value=JSON.parse(fs.readFileSync(filePath,'utf8'))}catch(e){throw Error(`CORRUPTED_REGISTRY_FILE: ${e.message}`)}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CORRUPTED_REGISTRY_FILE: expected object');
  if(expectedSchemaVersion&&value.schemaVersion!==expectedSchemaVersion)throw Error('UNSUPPORTED_SCHEMA_VERSION: explicit migration required');
  return value;
}
