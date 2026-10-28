import {compileCriteria,CriteriaValidationError} from './filter-criteria.js';

export const CONDITIONAL_COUNT_VERSION='analysis.conditional-count/1';
export class ConditionalCountValidationError extends TypeError {
  constructor(code,path,detail){super(`${code}: ${path}: ${detail}`);this.name='ConditionalCountValidationError';this.code=code;this.path=path;}
}
const fail=(code,path,detail)=>{throw new ConditionalCountValidationError(code,path,detail);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.hasOwn(value,key);
const qi=value=>'"'+value.replaceAll('"','""')+'"';
const integers=new Set(['TINYINT','SMALLINT','INTEGER','BIGINT','HUGEINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT','UHUGEINT']);

export function isCountNumericType(rawType){
  if(typeof rawType!=='string'||!rawType.trim()||rawType.includes('\0'))return false;
  const type=rawType.trim().toUpperCase();
  if(integers.has(type)||type==='FLOAT'||type==='DOUBLE')return true;
  const decimal=/^DECIMAL\((\d{1,2}),\s*(\d{1,2})\)$/.exec(type);
  if(!decimal)return false;
  const precision=Number(decimal[1]),scale=Number(decimal[2]);
  return precision>=1&&precision<=38&&scale<=precision;
}

export function isCountColumnType(rawType){
  if(isCountNumericType(rawType))return true;
  if(typeof rawType!=='string'||!rawType.trim()||rawType.includes('\0'))return false;
  return ['VARCHAR','BOOLEAN'].includes(rawType.trim().toUpperCase());
}

function shape(value,allowed,required,path){
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!own(value,key)))fail('COUNT_MODEL_SHAPE',path,'Unexpected or missing field');
}
function schemaColumns(schema){
  if(!Array.isArray(schema)||!schema.length)fail('COUNT_SCHEMA','schema','Actual nonempty schema required');
  const columns=new Map(),identities=new Set();
  for(const [index,column]of schema.entries()){
    if(!plain(column)||!own(column,'name')||!own(column,'type')||typeof column.name!=='string'||!column.name||column.name.includes('\0')||typeof column.type!=='string'||!column.type.trim()||column.type.includes('\0'))fail('COUNT_SCHEMA',`schema[${index}]`,'Actual exact name/type required');
    const identity=column.name.replace(/[A-Z]/g,c=>c.toLowerCase());
    if(identities.has(identity))fail('COUNT_SCHEMA_AMBIGUOUS',`schema[${index}].name`,'Duplicate ASCII-case column identity');
    identities.add(identity);columns.set(column.name,column);
  }
  return columns;
}

export function compileConditionalCount(model,schema){
  shape(model,['version','operation','column','criteria'],['version','operation'],'model');
  if(model.version!==CONDITIONAL_COUNT_VERSION)fail('COUNT_VERSION','model.version','Unsupported version');
  if(!['count','countif'].includes(model.operation))fail('COUNT_OPERATION','model.operation','Only count/countif');
  shape(model,model.operation==='count'?['version','operation','column']:['version','operation','criteria'],model.operation==='count'?['version','operation','column']:['version','operation','criteria'],'model');
  const columns=schemaColumns(schema);
  let expression,condition,columnsUsed;
  if(model.operation==='count'){
    if(typeof model.column!=='string'||!columns.has(model.column))fail('COUNT_COLUMN_UNKNOWN','model.column','Choose an exact actual column name, not an expression');
    if(!isCountColumnType(columns.get(model.column).type))fail('COUNT_COLUMN_TYPE','model.column','COUNT requires an actual numeric, VARCHAR or BOOLEAN column; no implicit cast');
    expression=`COUNT(${qi(model.column)}) AS "conditional_count"`;
    columnsUsed=[model.column];
  }else{
    if(!plain(model.criteria)||!Array.isArray(model.criteria.rules)||model.criteria.rules.length!==1)fail('COUNTIF_RULE_COUNT','model.criteria.rules','COUNTIF requires exactly one typed rule');
    let compiled;
    try{compiled=compileCriteria(model.criteria,schema);}
    catch(error){if(error instanceof CriteriaValidationError)fail('COUNTIF_'+error.code,'model.criteria',error.message);throw error;}
    condition=compiled.condition;columnsUsed=compiled.columnsUsed;
    expression='COUNT(*) AS "conditional_count"';
  }
  return {version:CONDITIONAL_COUNT_VERSION,operation:model.operation,relation:'input_data',selectExpressions:[expression],...(condition===undefined?{}:{condition}),sql:`SELECT ${expression} FROM "input_data"${condition===undefined?'':' WHERE '+condition}`,columnsUsed,result:{alias:'conditional_count',type:'BIGINT',cardinality:'one-row',typeResolution:'DESCRIBE actual DuckDB execution',nullPolicy:'COUNT returns zero for empty input or no matches; result is never NULL',countPolicy:model.operation==='count'?'Non-NULL scalar-column values; empty text, zero and false are included':'Rows whose single typed criterion is TRUE'}};
}
