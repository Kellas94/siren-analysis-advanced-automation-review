import { compileCriteria, CriteriaValidationError } from './filter-criteria.js';
export const CONDITIONAL_SUM_VERSION = 'analysis.conditional-sum/1';
export const EXACT_LOOKUP_VERSION = 'analysis.lookup/1';
export class ConditionalFunctionsValidationError extends TypeError {
  constructor(code, path, detail) { super(`${code}: ${path}: ${detail}`); this.name = 'ConditionalFunctionsValidationError'; this.code = code; this.path = path; }
}
const fail = (code, path, detail) => { throw new ConditionalFunctionsValidationError(code, path, detail); };
const own = (obj, key) => Object.hasOwn(obj, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const asciiKey = value => value.replace(/[A-Z]/g, c => c.toLowerCase());
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const integerTypes = new Set(['TINYINT','SMALLINT','INTEGER','BIGINT','HUGEINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT','UHUGEINT']);
function shape(value, allowed, required, where) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !own(value,k))) fail('FUNCTION_SHAPE', where, 'Unexpected or missing field');
}
function identifier(value, where) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('FUNCTION_IDENTIFIER', where, 'Exact nonempty identifier without NUL required');
  return value;
}
function schemaMap(schema, where) {
  if (!Array.isArray(schema) || !schema.length) fail('FUNCTION_SCHEMA', where, 'Actual nonempty schema required');
  const names = new Map(), identities = new Set();
  for (const [i,c] of schema.entries()) {
    if (!plain(c) || !own(c,'name') || !own(c,'type') || typeof c.type !== 'string' || !c.type.trim() || c.type.includes('\0')) fail('FUNCTION_SCHEMA', `${where}[${i}]`, 'Actual name/type required');
    identifier(c.name, `${where}[${i}].name`);
    const identity = asciiKey(c.name);
    if (identities.has(identity)) fail('FUNCTION_SCHEMA_AMBIGUOUS', `${where}[${i}].name`, 'Duplicate ASCII-case identity');
    identities.add(identity); names.set(c.name,c);
  }
  return names;
}
function typeInfo(raw) {
  const type = raw.trim().toUpperCase();
  if (integerTypes.has(type)) return { kind:'integer', sql:type };
  if (type === 'VARCHAR' || type === 'BOOLEAN') return { kind:type === 'VARCHAR'?'string':'boolean', sql:type };
  const d = /^DECIMAL\((\d{1,2}),\s*(\d{1,2})\)$/.exec(type);
  if (d) { const p=Number(d[1]),s=Number(d[2]);if(p>=1&&p<=38&&s<=p)return {kind:'decimal',sql:`DECIMAL(${p},${s})`}; }
  return null;
}
function column(names, name, where) {
  identifier(name,where);
  if (!names.has(name)) fail('FUNCTION_COLUMN_UNKNOWN', where, 'Use exact actual column name, not an expression');
  return names.get(name);
}
export function compileConditionalSum(model, schema) {
  shape(model,['version','operation','measure','criteria'],['version','operation','measure','criteria'],'model');
  if (model.version !== CONDITIONAL_SUM_VERSION) fail('SUM_VERSION','model.version','Unsupported version');
  if (!['sumif','sumifs'].includes(model.operation)) fail('SUM_OPERATION','model.operation','Only sumif/sumifs');
  const names=schemaMap(schema,'schema'),measure=column(names,model.measure,'model.measure'),type=typeInfo(measure.type);
  // Actual v2 native SUM(UHUGEINT) resolves DOUBLE; refuse its hidden precision loss.
  if (!type || !['integer','decimal'].includes(type.kind) || type.sql==='UHUGEINT') fail('SUM_MEASURE_TYPE','model.measure','Exact native SUM requires signed integers, unsigned<=64, or DECIMAL; no FLOAT/DOUBLE/UHUGEINT');
  if (!plain(model.criteria) || !Array.isArray(model.criteria.rules)) fail('SUM_CRITERIA','model.criteria','Versioned criteria group required');
  if (model.operation==='sumif' && model.criteria.rules.length!==1) fail('SUMIF_RULE_COUNT','model.criteria.rules','SUMIF requires exactly one rule');
  if (model.operation==='sumifs' && model.criteria.op!=='and') fail('SUMIFS_GROUP','model.criteria.op','SUMIFS requires AND');
  let compiled;
  try { compiled=compileCriteria(model.criteria,schema); }
  catch(error) { if(error instanceof CriteriaValidationError)fail('SUM_'+error.code,'model.criteria',error.message);throw error; }
  const expression=`SUM(${qi(model.measure)}) AS "conditional_sum"`;
  return { version:CONDITIONAL_SUM_VERSION, operation:model.operation, relation:'input_data', selectExpressions:[expression], condition:compiled.condition, sql:`SELECT ${expression} FROM "input_data" WHERE ${compiled.condition}`, columnsUsed:[...new Set([model.measure,...compiled.columnsUsed])], measureType:type.sql, result:{alias:'conditional_sum',cardinality:'one-row',typeResolution:'DESCRIBE actual DuckDB execution',nullPolicy:'native-sum: NULL for no non-NULL measure values; never invented zero'} };
}
export function compileExactLookup(model,leftSchema,rightSchema) {
  shape(model,['version','leftKey','rightKey','valueColumn','alias','duplicates','unmatched','textMatch'],['version','leftKey','rightKey','valueColumn','alias','duplicates','unmatched'],'model');
  if(model.version!==EXACT_LOOKUP_VERSION)fail('LOOKUP_VERSION','model.version','Unsupported version');
  if(model.duplicates!=='error'||model.unmatched!=='null')fail('LOOKUP_POLICY','model','Explicit duplicate error and unmatched null policies required');
  const left=schemaMap(leftSchema,'leftSchema'),right=schemaMap(rightSchema,'rightSchema'),lk=column(left,model.leftKey,'model.leftKey'),rk=column(right,model.rightKey,'model.rightKey'),value=column(right,model.valueColumn,'model.valueColumn');
  const lt=typeInfo(lk.type),rt=typeInfo(rk.type),vt=typeInfo(value.type);
  if(!lt||!rt)fail('LOOKUP_KEY_TYPE','model','Only VARCHAR/integers/DECIMAL/BOOLEAN keys are supported');
  if(lt.sql!==rt.sql)fail('LOOKUP_KEY_TYPE_MISMATCH','model','Exact actual key types, including DECIMAL width/scale, must match');
  if(!vt)fail('LOOKUP_VALUE_TYPE','model.valueColumn','v1 returns VARCHAR/integers/DECIMAL/BOOLEAN values only');
  if(lt.kind==='string'){if(model.textMatch!=='binary')fail('LOOKUP_TEXT_POLICY','model.textMatch','Explicit binary UTF8 byte equality required');}
  else if(own(model,'textMatch'))fail('LOOKUP_TEXT_POLICY','model.textMatch','textMatch applies only to VARCHAR keys');
  identifier(model.alias,'model.alias');
  if([...left.keys()].some(name=>asciiKey(name)===asciiKey(model.alias)))fail('LOOKUP_ALIAS_CONFLICT','model.alias','Alias conflicts with a preserved left column');
  const key=(table,name)=>lt.kind==='string'?`encode(${qi(table)}.${qi(name)})`:`${qi(table)}.${qi(name)}`;
  const projected=leftSchema.map(c=>`"__left".${qi(c.name)} AS ${qi(c.name)}`);
  projected.push(`CASE WHEN "__counts"."__matches" IS NULL THEN CAST(NULL AS ${vt.sql}) ELSE "__right".${qi(model.valueColumn)} END AS ${qi(model.alias)}`);
  const sql=`WITH "__lookup_counts" AS (
  SELECT ${key('__count_source',model.rightKey)} AS "__key", COUNT(*) AS "__matches"
  FROM "right_input" AS "__count_source"
  WHERE "__count_source".${qi(model.rightKey)} IS NOT NULL
  GROUP BY ${key('__count_source',model.rightKey)}
)
SELECT ${projected.join(',\n       ')}
FROM "left_input" AS "__left"
LEFT JOIN "__lookup_counts" AS "__counts" ON ${key('__left',model.leftKey)} = "__counts"."__key"
LEFT JOIN "right_input" AS "__right" ON ${key('__left',model.leftKey)} = ${key('__right',model.rightKey)} AND "__counts"."__matches" = 1
WHERE (SELECT CASE WHEN EXISTS (
  SELECT 1 FROM "left_input" AS "__guard_left"
  JOIN "__lookup_counts" AS "__guard_counts" ON ${key('__guard_left',model.leftKey)} = "__guard_counts"."__key"
  WHERE "__guard_counts"."__matches" > 1
) THEN error('LOOKUP_DUPLICATE_KEY') ELSE TRUE END)`;
  const output={name:model.alias,type:vt.sql,nullable:true};if(own(value,'unit'))output.unit=value.unit;
  return {version:EXACT_LOOKUP_VERSION,relations:{left:'left_input',right:'right_input'},sql,selectExpressions:projected,schema:[...leftSchema.map(c=>({...c})),output],schemaResolution:'Expected names/types; actual DuckDB DESCRIBE required',columnsUsed:{left:leftSchema.map(c=>c.name),right:[...new Set([model.rightKey,model.valueColumn])]},keyType:lt.sql,textMatch:lt.kind==='string'?'binary':null,duplicateScope:'non-NULL right keys matched by at least one left key',rowPolicy:'preserve left rows; order unspecified; no first/last selection'};
}
