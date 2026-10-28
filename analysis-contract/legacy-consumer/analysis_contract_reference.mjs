// Shared, browser-safe contract logic. No engine, SQL, process or file APIs here.
export const CONTRACT = 'siren.analysis-execution/1.0.0';
export const CATALOG = 'siren.analysis-catalog/1.0.0';
export class ContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
export function fail(code, message, details) { throw new ContractError(code, message, details); }
export const canonical = v => v === null ? 'null' : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
export function validate(schema, value, at = '$') {
  const bad = message => fail('INVALID_PARAMETERS', at + ': ' + message);
  if (value === null && schema.nullable === true) { if(Object.hasOwn(schema,'const')&&schema.const!==null)bad('does not match const');if(schema.enum&&!schema.enum.includes(null))bad('outside allowed values');return value; }
  const types = { string: v => typeof v === 'string', boolean: v => typeof v === 'boolean', number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isSafeInteger(v), array: Array.isArray, object: v => v !== null && typeof v === 'object' && !Array.isArray(v) };
  if (!types[schema.type]?.(value)) bad('expected ' + schema.type);
  if (Object.hasOwn(schema,'const') && canonical(schema.const)!==canonical(value)) bad('does not match const');
  if (schema.enum && !schema.enum.some(v => canonical(v) === canonical(value))) bad('outside allowed values');
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) bad('too short');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) bad('too long');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) bad('invalid format');
    if (schema['x-wire'] === 'int64') {
      if (!/^-?(0|[1-9]\d*)$/.test(value)) bad('int64 requires canonical integer text');
      const n = BigInt(value); if (n < -9223372036854775808n || n > 9223372036854775807n) bad('int64 overflow');
    }
    if (schema['x-wire'] === 'decimal') {
      if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) bad('decimal requires exact decimal text');
      const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
      if (fraction.length > schema.scale || (whole === '0' ? 0 : whole.length) > schema.precision - schema.scale) bad('decimal precision/scale exceeded');
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) bad('below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) bad('above maximum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) bad('too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) bad('too many items');
    for (const [i, v] of value.entries()) validate(schema.items, v, at + '[' + i + ']');
  }
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) bad('missing ' + key);
    for (const [key, v] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) {
        if (schema.additionalProperties !== true) bad('unknown property ' + key);
      } else validate(schema.properties[key], v, at + '.' + key);
    }
  }
  return value;
}
export function validateParameterSchema(schema, depth=0) {
  if(!schema||typeof schema!=='object'||Array.isArray(schema)||depth>8)fail('INVALID_PUBLICATION','Invalid parameter schema');
  const allowed=new Set(['type','nullable','default','enum','const','description','unit','x-wire','precision','scale','minLength','maxLength','pattern','minimum','maximum','minItems','maxItems','items','properties','required','additionalProperties']);
  for(const key of Object.keys(schema))if(!allowed.has(key))fail('INVALID_PUBLICATION','Unsupported parameter-schema keyword '+key);
  if(!['string','boolean','number','integer','array','object'].includes(schema.type))fail('INVALID_PUBLICATION','Unsupported parameter schema type');
  if(schema.nullable!==undefined&&typeof schema.nullable!=='boolean')fail('INVALID_PUBLICATION','nullable must be boolean');
  if(schema['x-wire']!==undefined&&(!['decimal','int64'].includes(schema['x-wire'])||schema.type!=='string'))fail('INVALID_PUBLICATION','Unsupported wire encoding');
  if(schema['x-wire']==='decimal'&&(!Number.isInteger(schema.precision)||schema.precision<1||schema.precision>38||!Number.isInteger(schema.scale)||schema.scale<0||schema.scale>schema.precision))fail('INVALID_PUBLICATION','Invalid decimal precision/scale');
  for(const key of ['minLength','maxLength','minItems','maxItems'])if(schema[key]!==undefined&&(!Number.isSafeInteger(schema[key])||schema[key]<0))fail('INVALID_PUBLICATION','Invalid '+key);
  for(const key of ['minimum','maximum'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))fail('INVALID_PUBLICATION','Invalid '+key);
  if(schema.pattern!==undefined){if(typeof schema.pattern!=='string'||schema.pattern.length>512)fail('INVALID_PUBLICATION','Invalid pattern');try{new RegExp(schema.pattern);}catch{fail('INVALID_PUBLICATION','Invalid regex pattern');}}
  for(const [lo,hi] of [['minimum','maximum'],['minLength','maxLength'],['minItems','maxItems']])if(schema[lo]!==undefined&&schema[hi]!==undefined&&schema[lo]>schema[hi])fail('INVALID_PUBLICATION','Inverted schema bounds');
  const apply={minLength:'string',maxLength:'string',pattern:'string',minItems:'array',maxItems:'array',items:'array',properties:'object',required:'object',additionalProperties:'object'};
  for(const [key,type] of Object.entries(apply))if(Object.hasOwn(schema,key)&&schema.type!==type)fail('INVALID_PUBLICATION',key+' does not apply to '+schema.type);
  if((Object.hasOwn(schema,'minimum')||Object.hasOwn(schema,'maximum'))&&!['integer','number'].includes(schema.type))fail('INVALID_PUBLICATION','Numeric bounds need a numeric schema');
  if((Object.hasOwn(schema,'precision')||Object.hasOwn(schema,'scale'))&&schema['x-wire']!=='decimal')fail('INVALID_PUBLICATION','Precision/scale require decimal wire encoding');
  if(schema.type==='array')validateParameterSchema(schema.items,depth+1);
  if(schema.type==='object'){
    if(!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties)||schema.additionalProperties!==false||!Array.isArray(schema.required||[]))fail('INVALID_PUBLICATION','Closed object schema required');
    if((schema.required||[]).some(k=>typeof k!=='string'||!Object.hasOwn(schema.properties,k))||new Set(schema.required||[]).size!==(schema.required||[]).length)fail('INVALID_PUBLICATION','Invalid required fields');
    for(const [name,value] of Object.entries(schema.properties)){if(['__proto__','prototype','constructor'].includes(name))fail('INVALID_PUBLICATION','Unsupported parameter name');validateParameterSchema(value,depth+1);}
  }
  if(schema.enum!==undefined&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>256))fail('INVALID_PUBLICATION','Invalid enum');
  try{
    if(Object.hasOwn(schema,'const'))validate({...schema,enum:undefined},schema.const);
    if(schema.enum)for(const v of schema.enum)validate({...schema,enum:undefined},v);
    if(Object.hasOwn(schema,'default'))validate(schema,schema.default);
  }catch(e){fail('INVALID_PUBLICATION','Invalid advertised default/enum/const: '+e.message);}
  return schema;
}
export function wireSchema(dbType){
 if(dbType==='VARCHAR')return {type:'string'};
 if(dbType==='BOOLEAN')return {type:'boolean'};
 if(['TINYINT','SMALLINT','INTEGER','UTINYINT','USMALLINT','UINTEGER'].includes(dbType))return {type:'integer'};
 if(dbType==='BIGINT')return {type:'string','x-wire':'int64'};
 if(['FLOAT','DOUBLE','REAL'].includes(dbType))return {type:'number'};
 const m=/^DECIMAL\((\d+),\s*(\d+)\)$/.exec(dbType);
 if(m){const value={type:'string','x-wire':'decimal',precision:Number(m[1]),scale:Number(m[2])};validateParameterSchema(value);return value;}
 fail('UNSUPPORTED_RESULT_TYPE','Common adapter does not publish this type yet: '+dbType);
}
export function parameters(descriptor, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('INVALID_PARAMETERS', 'parameters must be an object');
  const result = structuredClone(values);
  for (const [name, schema] of Object.entries(descriptor.properties || {})) if (!Object.hasOwn(result, name) && Object.hasOwn(schema, 'default')) result[name] = structuredClone(schema.default);
  validate(descriptor, result); return result;
}
export function checkReference(catalog, binding) {
  if (!binding || binding.catalogId !== catalog.catalogId) fail('INCOMPATIBLE_CATALOG', 'Saved catalog identity unavailable');
  if (binding.contractVersion !== catalog.contractVersion) fail('INCOMPATIBLE_CONTRACT', 'Saved contract version unavailable', { expected: binding.contractVersion, available: catalog.contractVersion });
  const entry = catalog.capabilities.find(c => c.id === binding.capabilityId && c.version === binding.capabilityVersion);
  if (!entry) fail('CAPABILITY_VERSION_UNAVAILABLE', 'Saved capability version unavailable');
  if (binding.descriptorSha256 !== entry.descriptorSha256) fail('INCOMPATIBLE_CAPABILITY', 'Published descriptor changed at the same version');
  if (entry.availability.contract !== 'IMPLEMENTED' || entry.invocation.kind !== 'registered-workflow') fail('NOT_EXECUTABLE', 'Capability has no execution adapter in this contract');
  if (canonical(entry.workflowRef) !== canonical(binding.workflowRef)) fail('WORKFLOW_VERSION_MISMATCH', 'Saved workflow identity differs');
  return entry;
}
export function createBinding(catalog, entry) { return { catalogId:catalog.catalogId,catalogVersion:catalog.catalogVersion,catalogSha256:catalog.catalogSha256,contractVersion:catalog.contractVersion,capabilityId:entry.id,capabilityVersion:entry.version,descriptorSha256:entry.descriptorSha256,workflowRef:structuredClone(entry.workflowRef),workflowId:entry.workflowRef.workflowId,workflowVersion:entry.workflowRef.workflowVersion }; }
export function validateResult(result) {
  if (!Array.isArray(result.schema) || !result.schema.length || !Array.isArray(result.rows)) fail('INVALID_RESULT', 'Missing schema/rows');
  const names = result.schema.map(c => c.name);
  if (new Set(names).size !== names.length) fail('INVALID_RESULT', 'Duplicate columns');
  for (const c of result.schema) {
    if (!c.name || typeof c.dbType !== 'string' || !c.wireSchema || typeof c.nullable !== 'boolean') fail('INVALID_RESULT', 'Incomplete typed column');
    try{if(canonical(wireSchema(c.dbType))!==canonical(c.wireSchema))fail('INVALID_RESULT','dbType/wire schema mismatch');}catch(e){fail('INVALID_RESULT',e.message);}
  }
  for (const row of result.rows) {
    if (canonical(Object.keys(row).sort()) !== canonical([...names].sort())) fail('INVALID_RESULT', 'Row/schema mismatch');
    for (const c of result.schema) { try { validate({ ...c.wireSchema, nullable: c.nullable }, row[c.name], c.name); } catch (e) { fail('INVALID_RESULT', e.message); } }
  }
  const c = result.coverage;
  for (const n of [c?.resultRows, c?.transferredRows]) if (!Number.isSafeInteger(n) || n < 0) fail('INVALID_RESULT', 'Invalid counts');
  if (c.sourceRows !== null && (!Number.isSafeInteger(c.sourceRows) || c.sourceRows < 0)) fail('INVALID_RESULT', 'Invalid source count');
  if (c.transferredRows !== result.rows.length || c.transferredRows > c.resultRows) fail('INVALID_RESULT', 'Contradictory counts');
  if (!['COMPLETE', 'SAMPLED', 'TRUNCATED'].includes(c.status)) fail('INVALID_RESULT', 'Unknown coverage');
  if ((c.status === 'COMPLETE') !== (c.resultRows === c.transferredRows)) fail('INVALID_RESULT', 'Contradictory coverage');
  if (c.status !== 'COMPLETE' && !c.reason) fail('INVALID_RESULT', 'Missing coverage reason');
  if (!result.provenance?.jobId || !result.provenance?.workflowRef || !result.resultId || !result.resultVersion) fail('INVALID_RESULT', 'Missing lineage');
  return result;
}
export async function verifyResult(result){
 validateResult(result);const {integritySha256,...body}=result;
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body))),actual=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 if(integritySha256!==actual)fail('RESULT_INTEGRITY_MISMATCH','Result bytes differ from saved digest');return result;
}
