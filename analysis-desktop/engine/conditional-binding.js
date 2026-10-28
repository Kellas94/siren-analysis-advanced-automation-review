import {compileConditionalSum,compileExactLookup} from './conditional-functions.js';
import {compileConditionalCount} from './conditional-count.js';
import {assertDerivedSchema} from './derived-binding.js';
import {assertFilterSchema} from './filter-binding.js';
const columns=values=>values.map(({name,type})=>({name,type}));
export function compileCountBinding(data){
  const compiled=compileConditionalCount(data.countModel,data.countSchema);
  return {sql:compiled.sql,columns:columns(data.countSchema.filter(c=>compiled.columnsUsed.includes(c.name)))};
}
export function compileSumBinding(data){
  const compiled=compileConditionalSum(data.sumModel,data.sumSchema);
  return {sql:compiled.sql,columns:columns(data.sumSchema.filter(c=>compiled.columnsUsed.includes(c.name)))};
}
export function compileLookupBinding(data){
  const compiled=compileExactLookup(data.lookupModel,data.lookupSchemas?.left,data.lookupSchemas?.right);
  return {sql:compiled.sql,left:columns(data.lookupSchemas.left),right:columns(data.lookupSchemas.right.filter(c=>compiled.columnsUsed.right.includes(c.name)))};
}
export function assertFunctionSchema(check,actual){
  try{if(check.full)assertDerivedSchema(check.columns,actual);else assertFilterSchema(check.columns,actual);}
  catch{throw Error('FUNCTION_INPUT_SCHEMA_CHANGED: The '+check.scope+' input columns changed. Run its inputs and review the definition.');}
  return true;
}
