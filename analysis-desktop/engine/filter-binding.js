import {compileCriteria} from './filter-criteria.js';
export function compileFilterBinding(data){
  if(data.criteria===undefined)return {condition:data.condition||'TRUE'};
  const compiled=compileCriteria(data.criteria,data.criteriaSchema);
  return {condition:compiled.condition,columns:data.criteriaSchema.filter(c=>compiled.columnsUsed.includes(c.name)).map(({name,type})=>({name,type}))};
}
export function assertFilterSchema(expected,actual){
  if(!Array.isArray(expected)||!Array.isArray(actual))throw Error('FILTER_SCHEMA_CHANGED: Missing input schema.');
  const keys=new Set();
  for(const c of actual){
    if(typeof c?.name!=='string'||typeof c?.type!=='string')throw Error('FILTER_SCHEMA_CHANGED: Invalid input schema.');
    const key=c.name.replace(/[A-Z]/g,x=>x.toLowerCase());
    if(keys.has(key))throw Error('FILTER_SCHEMA_CHANGED: Ambiguous input schema.');
    keys.add(key);
  }
  for(const c of expected){
    if(typeof c?.name!=='string'||typeof c?.type!=='string'||!actual.some(a=>a.name===c.name&&a.type===c.type))throw Error('FILTER_SCHEMA_CHANGED: A referenced column changed. Run Filter input and review the rules.');
  }
  return true;
}
