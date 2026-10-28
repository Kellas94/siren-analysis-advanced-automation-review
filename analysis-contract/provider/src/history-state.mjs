// Pure semantic validation of persisted Analysis metadata; never opens input data.
import crypto from 'node:crypto';
import path from 'node:path';
import {CONTRACT,CATALOG,canonical,fail} from './contract.mjs';
const clone=value=>structuredClone(value);
const sha=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function requireState(value,message){if(!value)fail('HISTORY_INVALID_STATE',message);}
export function historyCatalog(base,definitions,revision){
 const entries=[...base.capabilities.map(d=>{const v=clone(d);v.descriptorSha256=sha(v);return v;}),...Array.from(definitions.values(),r=>clone(r.descriptor))];
 requireState(new Set(entries.map(e=>e.id+'@'+e.version)).size===entries.length,'Duplicate catalogue identity');
 const catalog={...clone(base),catalogId:'siren.analysis',schemaVersion:CATALOG,contractVersion:CONTRACT,catalogVersion:'2.0.'+revision,capabilities:entries};catalog.catalogSha256=sha(catalog);return catalog;
}
export function historyState(base,definitions,catalogs){
 return{format:'siren.analysis-state/1',base:clone(base),revision:definitions.size,definitions:Array.from(definitions.values(),r=>clone(r.history)),catalogs:clone(catalogs)};
}
function projection(value,grantRoot){
 const {id,version,title,description,parameterSchema,definition,bindings,outputNodeId,units={}}=value;
 const result=clone({id,version,title,description,parameterSchema,definition,bindings,outputNodeId,units});
 requireState(typeof grantRoot==='string'&&path.isAbsolute(grantRoot),'Trusted source grant is required');
 for(const node of result.definition.nodes)if(node.type==='input'){requireState(typeof node.data.path==='string'&&!node.data.path.includes('\0'),'Source path must be text');node.data.path=path.resolve(grantRoot,node.data.path);}
 return result;
}
export function validateHistoryState(state,{base,prepare,grantRoot,previous=null,allowAdvance=false}){
 requireState(exact(state,['format','base','revision','definitions','catalogs'])&&state.format==='siren.analysis-state/1','Unsupported state format/fields');
 requireState(canonical(state.base)===canonical(base),'Base catalog differs from approved base');
 requireState(Number.isSafeInteger(state.revision)&&state.revision>=0&&Array.isArray(state.definitions)&&state.definitions.length===state.revision,'Publication revision/records differ');
 requireState(Array.isArray(state.catalogs)&&state.catalogs.length===state.revision+1,'Exact catalog history is missing');
 if(previous){
  requireState(state.revision>=previous.revision&&(allowAdvance||state.revision===previous.revision+1),'Non-additive metadata transition');
  requireState(canonical(state.base)===canonical(previous.base)&&canonical(state.definitions.slice(0,previous.definitions.length))===canonical(previous.definitions)&&canonical(state.catalogs.slice(0,previous.catalogs.length))===canonical(previous.catalogs),'Acknowledged history was rewritten');
 }else requireState(state.revision>=0,'Invalid initial state');
 const definitions=new Map(),catalogs=new Map();
 const verifyCatalog=revision=>{
  const observed=state.catalogs[revision],expected=historyCatalog(base,definitions,revision);
  requireState(canonical(observed)===canonical(expected),'Stored catalog body/digest/version mismatch at '+revision);
  requireState(!catalogs.has(observed.catalogSha256),'Repeated catalog digest');catalogs.set(observed.catalogSha256,clone(observed));
 };
 verifyCatalog(0);
 for(const [index,row]of state.definitions.entries()){
  requireState(exact(row,['submitted','fingerprint','publication','descriptor'])&&typeof row.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(row.fingerprint),'Invalid publication record');
  requireState(sha(row.submitted)===row.fingerprint,'Submitted publication fingerprint mismatch');
  requireState(exact(row.publication,['id','version','title','description','parameterSchema','definition','bindings','outputNodeId','units']),'Invalid normalized publication fields');
  let admitted;try{admitted=prepare(clone(row.publication),{recovery:true,definitions});}catch(error){fail('HISTORY_INVALID_STATE','Stored definition/default/binding failed current admission: '+error.message);}
  requireState(canonical(admitted.publication)===canonical(row.publication),'Normalized publication changed during recovery');
  requireState(canonical(admitted.descriptor)===canonical(row.descriptor),'Descriptor/definition/publication digest mismatch');
  requireState(canonical(projection(row.submitted,grantRoot))===canonical(projection(row.publication,grantRoot)),'Submitted and normalized publication/source mapping disagree');
  const key=row.descriptor.id+'@'+row.descriptor.version;requireState(!definitions.has(key),'Duplicate immutable version');admitted.history=clone(row);definitions.set(key,admitted);verifyCatalog(index+1);
 }
 return{definitions,catalogs,revision:state.revision};
}
