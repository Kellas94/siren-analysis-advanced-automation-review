import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HISTORY_PROTOCOL='siren.publication-history/1';
export const HISTORY_LIMITS=Object.freeze({recordBytes:16*1024*1024,totalBytes:128*1024*1024,commits:256});
export class HistoryError extends Error {
  constructor(code,message,cause){super(message,cause===undefined?undefined:{cause});this.name='HistoryError';this.code=code;}
}
const fail=(code,message,cause)=>{throw new HistoryError(code,message,cause);};
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null?'null':Array.isArray(value)?'['+value.map(canonical).join(',')+']':typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digestText=value=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value);
const filename=sequence=>String(sequence).padStart(6,'0')+'.json';
const recordKeys=['protocol','sequence','parentSha256','authority','authoritySha256','state','digest'];

export function strictHistoryJson(value){
  const active=new Set();
  function inspect(item,at){
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'){
      if(!Number.isFinite(item))fail('HISTORY_JSON',at+': nonfinite number');
      if(Object.is(item,-0))fail('HISTORY_JSON',at+': negative zero would change during JSON serialization');
      if(Number.isInteger(item)&&!Number.isSafeInteger(item))fail('HISTORY_JSON',at+': unsafe integral Number; use an exact string');
      return;
    }
    if(typeof item!=='object')fail('HISTORY_JSON',at+': strict JSON value required');
    if(active.has(item))fail('HISTORY_JSON',at+': cyclic value');
    if(!Array.isArray(item)&&!plain(item))fail('HISTORY_JSON',at+': plain JSON object required');
    active.add(item);
    const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
    if(Array.isArray(item)){
      if(keys.some(key=>typeof key!=='string'||key!=='length'&&!/^(0|[1-9]\d*)$/.test(key))||keys.length!==item.length+1)fail('HISTORY_JSON',at+': sparse or decorated array');
      for(let index=0;index<item.length;index++){
        const descriptor=descriptors[index];
        if(!descriptor||!own(descriptor,'value')||!descriptor.enumerable)fail('HISTORY_JSON',at+': array accessor or sparse item');
        inspect(descriptor.value,at+'['+index+']');
      }
    }else for(const key of keys){
      if(typeof key!=='string'||key==='__proto__'||key==='constructor')fail('HISTORY_JSON',at+': unsafe JSON key');
      const descriptor=descriptors[key];
      if(!own(descriptor,'value')||!descriptor.enumerable)fail('HISTORY_JSON',at+'.'+key+': accessor/nonenumerable property');
      inspect(descriptor.value,at+'.'+key);
    }
    active.delete(item);
  }
  try{inspect(value,'$');return JSON.parse(canonical(value));}
  catch(error){if(error instanceof HistoryError)throw error;fail('HISTORY_JSON','Strict JSON normalization failed',error);}
}
const jsonClone=strictHistoryJson;
function exactObject(value,keys,code,message){
  if(!plain(value)||Object.keys(value).length!==keys.length||keys.some(key=>!own(value,key)))fail(code,message);
}
function expectedHead(value){
  exactObject(value,['sequence','digest'],'HISTORY_HEAD','Expected exact {sequence,digest} head');
  if(!Number.isSafeInteger(value.sequence)||value.sequence<0||value.sequence>HISTORY_LIMITS.commits||(value.sequence===0?value.digest!==null:!digestText(value.digest)))fail('HISTORY_HEAD','Malformed expected history head');
  return {sequence:value.sequence,digest:value.digest};
}
const sameHead=(a,b)=>a.sequence===b.sequence&&a.digest===b.digest;
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a,b)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

export class DirectoryHistory {
  #directory;#authority;#authorityText;#authoritySha256;#validateState;#onPhase;#busy=false;#closed=false;
  constructor({directory,authority,validateState,onPhase}={}){
    if(typeof directory!=='string'||!directory||directory.includes('\0')||typeof validateState!=='function'||onPhase!==undefined&&typeof onPhase!=='function')fail('HISTORY_CONFIG','directory, trusted authority and synchronous validateState callback required');
    if(!plain(authority))fail('HISTORY_AUTHORITY','Trusted authority must be a JSON object');
    this.#authority=jsonClone(authority);this.#authorityText=canonical(this.#authority);this.#authoritySha256=hash(this.#authorityText);
    if(Buffer.byteLength(this.#authorityText)>HISTORY_LIMITS.recordBytes)fail('HISTORY_LIMIT','Authority exceeds record bound');
    this.#directory=path.resolve(directory);this.#validateState=validateState;this.#onPhase=onPhase;
    this.#layout(true);
  }
  get directory(){return this.#directory;}
  close(){if(this.#busy)fail('HISTORY_REENTRANT','History operation is already active');this.#closed=true;}
  #operation(run){
    if(this.#closed)fail('HISTORY_CLOSED','History is closed');
    if(this.#busy)fail('HISTORY_REENTRANT','History operation is already active');
    this.#busy=true;try{return run();}finally{this.#busy=false;}
  }
  #io(message,run){try{return run();}catch(error){if(error instanceof HistoryError)throw error;fail('HISTORY_IO',message,error);}}
  #stat(file){return this.#io('Cannot inspect history entry',()=>fs.lstatSync(file,{bigint:true}));}
  #directoryEntry(file,create){
    let stat;
    try{stat=fs.lstatSync(file,{bigint:true});}
    catch(error){
      if(error.code!=='ENOENT'||!create)fail('HISTORY_IO','Required history directory unavailable',error);
      this.#io('Cannot create history directory',()=>fs.mkdirSync(file,{recursive:true}));stat=this.#stat(file);
    }
    if(stat.isSymbolicLink())fail('HISTORY_SYMLINK','Symlink/reparse history directory refused');
    if(!stat.isDirectory())fail('HISTORY_LAYOUT','Expected history directory');
  }
  #layout(create=false){
    this.#directoryEntry(this.#directory,create);
    for(const name of this.#io('Cannot list history root',()=>fs.readdirSync(this.#directory))){
      const stat=this.#stat(path.join(this.#directory,name));
      if(stat.isSymbolicLink())fail('HISTORY_SYMLINK','Symlink/reparse root entry refused');
      if(!['commits','staging'].includes(name))fail('HISTORY_LAYOUT','Unrecognized history root entry');
      if(!stat.isDirectory())fail('HISTORY_LAYOUT','Expected commits/staging directory');
    }
    this.#directoryEntry(path.join(this.#directory,'commits'),create);
    this.#directoryEntry(path.join(this.#directory,'staging'),create);
  }
  #names(directory){return this.#io('Cannot list history directory',()=>fs.readdirSync(directory)).sort();}
  #regular(file){const stat=this.#stat(file);if(stat.isSymbolicLink())fail('HISTORY_SYMLINK','Symlink/reparse file entry refused');if(!stat.isFile())fail('HISTORY_LAYOUT','Only regular metadata files are allowed');return stat;}
  #bytes(file,stat){
    if(stat.size>BigInt(HISTORY_LIMITS.recordBytes))fail('HISTORY_LIMIT','Metadata record exceeds16MiB');
    let fd,primary,bytes;
    try{
      fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd,{bigint:true});
      if(!opened.isFile()||!sameFile(opened,stat))fail('HISTORY_CHANGED','Metadata file changed before read');
      const size=Number(opened.size);bytes=Buffer.alloc(size);let offset=0;
      while(offset<size){const length=fs.readSync(fd,bytes,offset,size-offset,offset);if(length===0)fail('HISTORY_CHANGED','Metadata file truncated during read');offset+=length;}
      if(fs.readSync(fd,Buffer.alloc(1),0,1,size)!==0||!sameFile(opened,fs.fstatSync(fd,{bigint:true})))fail('HISTORY_CHANGED','Metadata file changed during read');
      const after=this.#regular(file);if(!sameFile(opened,after))fail('HISTORY_CHANGED','Metadata path changed during read');
    }catch(error){primary=error instanceof HistoryError?error:new HistoryError('HISTORY_IO','Cannot read metadata file',error);}
    finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(error){primary??=new HistoryError('HISTORY_IO','Cannot close metadata read',error);}}
    if(primary)throw primary;return bytes;
  }
  #validate(state,previousState){
    try{const answer=this.#validateState(jsonClone(state),jsonClone(previousState));if(answer===false||answer&&typeof answer.then==='function')fail('HISTORY_STATE','State validation must complete synchronously and accept');}
    catch(error){if(error instanceof HistoryError)throw error;fail('HISTORY_STATE','History state validation refused',error);}
  }
  #pending(byteHashes){
    const staging=path.join(this.#directory,'staging');let pendingStages=0;
    for(const name of this.#names(staging)){
      const file=path.join(staging,name),stat=this.#regular(file);
      if(stat.size>BigInt(HISTORY_LIMITS.recordBytes)){pendingStages++;continue;}
      try{if(!byteHashes.has(hash(this.#bytes(file,stat))))pendingStages++;}
      catch(error){if(['HISTORY_SYMLINK','HISTORY_LAYOUT'].includes(error.code))throw error;pendingStages++;}
    }
    return pendingStages;
  }
  #read(){
    for(let attempt=0;attempt<8;attempt++){
      this.#layout();const commits=path.join(this.#directory,'commits'),names=this.#names(commits);
      if(names.length>HISTORY_LIMITS.commits)fail('HISTORY_LIMIT','History exceeds256 committed records');
      const records=[],byteHashes=new Set();let previousState=null,head={sequence:0,digest:null},totalBytes=0;
      for(let index=0;index<names.length;index++){
        const name=names[index];if(!/^\d{6}\.json$/.test(name))fail('HISTORY_LAYOUT','Unrecognized committed filename');
        if(name!==filename(index+1))fail('HISTORY_CHAIN','Missing or out-of-order committed sequence');
        const file=path.join(commits,name),stat=this.#regular(file);
        if(stat.size>BigInt(HISTORY_LIMITS.recordBytes))fail('HISTORY_LIMIT','Committed record exceeds16MiB');
        totalBytes+=Number(stat.size);if(totalBytes>HISTORY_LIMITS.totalBytes)fail('HISTORY_LIMIT','Committed history exceeds128MiB');
        const bytes=this.#bytes(file,stat);let parsed;
        try{parsed=JSON.parse(bytes.toString('utf8'));}catch(error){fail('HISTORY_JSON','Malformed/truncated committed JSON',error);}
        const record=jsonClone(parsed);exactObject(record,recordKeys,'HISTORY_RECORD','Unexpected committed record shape');
        if(!bytes.equals(Buffer.from(canonical(record)+'\n')))fail('HISTORY_BYTES','Committed bytes are not exact canonical JSON plus newline');
        if(record.protocol!==HISTORY_PROTOCOL)fail('HISTORY_PROTOCOL','Unsupported history protocol');
        if(record.sequence!==index+1||record.parentSha256!==head.digest)fail('HISTORY_CHAIN','Committed sequence/parent digest mismatch');
        if(record.authoritySha256!==this.#authoritySha256||canonical(record.authority)!==this.#authorityText)fail('HISTORY_AUTHORITY','Committed authority differs from trusted authority');
        const {digest,...body}=record;if(!digestText(digest)||hash(canonical(body))!==digest)fail('HISTORY_DIGEST','Committed record digest mismatch');
        this.#validate(record.state,previousState);previousState=record.state;head={sequence:record.sequence,digest};records.push(record);byteHashes.add(hash(bytes));
      }
      const pendingStages=this.#pending(byteHashes);this.#layout();
      if(canonical(names)!==canonical(this.#names(commits)))continue;
      return {head,state:jsonClone(previousState),pendingStages,totalBytes,records};
    }
    fail('HISTORY_BUSY','History changed repeatedly while reading; refresh and retry');
  }
  #public(read){return {head:{...read.head},state:jsonClone(read.state),pendingStages:read.pendingStages};}
  read(){return this.#operation(()=>this.#public(this.#read()));}
  #phase(phase){const answer=this.#onPhase?.(phase);if(answer&&typeof answer.then==='function')fail('HISTORY_CALLBACK','Phase callbacks must be synchronous');}
  commit(state,head){return this.#operation(()=>{
    const expected=expectedHead(jsonClone(head)),current=this.#read();
    if(!sameHead(expected,current.head))fail('HISTORY_CONFLICT','History head changed; refresh before committing');
    if(current.head.sequence>=HISTORY_LIMITS.commits)fail('HISTORY_LIMIT','History exceeds256 committed records');
    const snapshot=jsonClone(state);this.#validate(snapshot,current.state);
    const body={protocol:HISTORY_PROTOCOL,sequence:current.head.sequence+1,parentSha256:current.head.digest,authority:jsonClone(this.#authority),authoritySha256:this.#authoritySha256,state:snapshot},digest=hash(canonical(body));
    const record={...body,digest},bytes=Buffer.from(canonical(record)+'\n');
    if(bytes.length>HISTORY_LIMITS.recordBytes||current.totalBytes+bytes.length>HISTORY_LIMITS.totalBytes)fail('HISTORY_LIMIT','Committed metadata bound would be exceeded');
    this.#layout();const stage=path.join(this.#directory,'staging','stage-'+crypto.randomUUID()+'.json');let fd,primary;
    try{fd=fs.openSync(stage,'wx',0o600);let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);if(!Number.isSafeInteger(count)||count<=0)fail('HISTORY_IO','Short/zero metadata stage write');offset+=count;}fs.fsyncSync(fd);}
    catch(error){primary=error instanceof HistoryError?error:new HistoryError('HISTORY_IO','Metadata stage write/flush failed',error);}
    finally{if(fd!==undefined)try{fs.closeSync(fd);}catch(error){primary??=new HistoryError('HISTORY_IO','Metadata stage close failed',error);}}
    if(primary)throw primary;
    this.#phase('stage-flushed');this.#phase('before-link');
    const latest=this.#read();if(!sameHead(expected,latest.head))fail('HISTORY_CONFLICT','History head changed before publication; refresh and retry');
    this.#layout();
    if(!this.#bytes(stage,this.#regular(stage)).equals(bytes))fail('HISTORY_CHANGED','Flushed stage bytes changed before publication');
    try{fs.linkSync(stage,path.join(this.#directory,'commits',filename(body.sequence)));}
    catch(error){if(error.code==='EEXIST')fail('HISTORY_CONFLICT','Another writer published this sequence; refresh and retry',error);fail('HISTORY_IO','Exclusive metadata publication failed',error);}
    // An exception here means publication may be committed but ACK was lost.
    // Preserve the exception and every file; recovery must read the chain.
    this.#phase('committed');
    const readback=this.#read(),ownRecord=readback.records[body.sequence-1];
    if(!ownRecord||ownRecord.digest!==digest)fail('HISTORY_DIGEST','Own published record missing from validated readback');
    return {head:{sequence:body.sequence,digest},state:jsonClone(ownRecord.state),pendingStages:readback.pendingStages};
  });}
}
