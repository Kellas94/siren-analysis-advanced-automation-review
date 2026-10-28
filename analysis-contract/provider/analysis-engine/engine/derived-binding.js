import {compileDerivedColumns} from './derived-columns.js';
export function compileDerivedBinding(data){
  const compiled=compileDerivedColumns(data.derivedColumns,data.derivedSchema);
  return {projection:compiled.selectExpressions.join(', '),schema:data.derivedSchema.map(({name,type})=>({name,type}))};
}
export function assertDerivedSchema(expected,actual){
  if(!Array.isArray(expected)||!Array.isArray(actual)||expected.length!==actual.length||expected.some((c,i)=>typeof c?.name!=='string'||typeof c?.type!=='string'||c.name!==actual[i]?.name||c.type!==actual[i]?.type))throw Error('DERIVED_SCHEMA_CHANGED: The input columns changed. Run New columns input and review the definitions.');
  return true;
}
