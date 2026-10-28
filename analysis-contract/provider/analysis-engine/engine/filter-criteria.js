// Pure SQL predicate compiler. No data execution, inferred schema/casts or saved-model mutation.
export const CRITERIA_VERSION = 'analysis.criteria/1';
export class CriteriaValidationError extends TypeError {
  constructor(code, path, detail) { super(`${code}: ${path}: ${detail}`); this.name = 'CriteriaValidationError'; this.code = code; this.path = path; }
}
const fail = (code, path, detail) => { throw new CriteriaValidationError(code, path, detail); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const asciiKey = value => value.replace(/[A-Z]/g, char => char.toLowerCase());
const nullOps = ['isNull', 'isNotNull'];
const valueOps = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'notIn'];
const stringOps = ['contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'];
const integers = new Map([
  ['TINYINT', [8, true]], ['SMALLINT', [16, true]], ['INTEGER', [32, true]], ['BIGINT', [64, true]], ['HUGEINT', [128, true]],
  ['UTINYINT', [8, false]], ['USMALLINT', [16, false]], ['UINTEGER', [32, false]], ['UBIGINT', [64, false]], ['UHUGEINT', [128, false]]
]);
function typeInfo(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0')) return { kind: 'unsupported' };
  const type = raw.trim().toUpperCase();
  if (type === 'VARCHAR') return { kind: 'string', sql: type };
  if (type === 'BOOLEAN') return { kind: 'boolean', sql: type };
  if (integers.has(type)) return { kind: 'integer', sql: type, bits: integers.get(type)[0], signed: integers.get(type)[1] };
  if (type === 'FLOAT' || type === 'DOUBLE') return { kind: 'float', sql: type };
  const m = /^DECIMAL\((\d{1,2}),\s*(\d{1,2})\)$/.exec(type);
  if (m) { const precision = Number(m[1]), scale = Number(m[2]); if (precision >= 1 && precision <= 38 && scale <= precision) return { kind: 'decimal', sql: `DECIMAL(${precision},${scale})`, precision, scale }; }
  return { kind: 'unsupported' };
}
export function operatorsForType(type) {
  const info = typeInfo(type);
  if (info.kind === 'unsupported') return [...nullOps];
  if (info.kind === 'boolean') return ['eq', 'ne', 'in', 'notIn', ...nullOps];
  return [...valueOps, ...(info.kind === 'string' ? stringOps : []), ...nullOps];
}
function keys(value, expected, where, code) {
  if (!plain(value) || Object.keys(value).some(key => !expected.includes(key))) fail(code, where, 'Unexpected object/field');
}
function text(value, where) {
  if (typeof value !== 'string') fail('VALUE_TYPE', where, 'Expected string');
  if (value.includes('\0')) fail('VALUE_NUL', where, 'SQL text cannot contain NUL');
  return "'" + value.replaceAll("'", "''") + "'";
}
function literal(value, info, where) {
  if (value === null || value === undefined) fail('VALUE_NULL', where, 'Use explicit NULL operators/policy');
  if (info.kind === 'string') return text(value, where);
  if (info.kind === 'boolean') {
    if (typeof value !== 'boolean') fail('VALUE_TYPE', where, 'BOOLEAN requires true or false');
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value !== 'string') fail('VALUE_TYPE', where, 'Numeric values require serialized text');
  if (info.kind === 'integer') {
    if (!/^[+-]?\d+$/.test(value)) fail('INTEGER_SYNTAX', where, 'Expected integer text without whitespace/exponent');
    const n = BigInt(value), bits = BigInt(info.bits), min = info.signed ? -(1n << (bits - 1n)) : 0n, max = (1n << (info.signed ? bits - 1n : bits)) - 1n;
    if (n < min || n > max) fail('INTEGER_RANGE', where, 'Outside actual integer type');
  } else if (info.kind === 'decimal') {
    const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!m) fail('DECIMAL_SYNTAX', where, 'Expected exact fixed-point text');
    const fraction = m[3] || '';
    if (fraction.length > info.scale) fail('DECIMAL_SCALE', where, 'Excess fractional digits; no rounding');
    const magnitude = BigInt(m[2] + fraction.padEnd(info.scale, '0'));
    if (magnitude >= 10n ** BigInt(info.precision)) fail('DECIMAL_RANGE', where, 'Outside actual precision/scale');
  } else if (info.kind === 'float') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) fail('FLOAT_SYNTAX', where, 'Expected finite decimal/exponent text');
    const n = Number(value), nonzero = /[1-9]/.test(value.split(/[eE]/)[0]);
    if (!Number.isFinite(n) || info.sql === 'FLOAT' && !Number.isFinite(Math.fround(n))) fail('FLOAT_RANGE', where, 'Nonfinite or outside actual floating type');
    if (nonzero && (n === 0 || info.sql === 'FLOAT' && Math.fround(n) === 0)) fail('FLOAT_UNDERFLOW', where, 'Nonzero input would underflow to zero');
  } else fail('SCHEMA_TYPE_UNSUPPORTED', where, 'No v1 value policy for this type');
  return `CAST(${text(value, where)} AS ${info.sql})`;
}
export function compileCriteria(model, schema) {
  keys(model, ['version', 'op', 'rules'], 'model', 'CRITERIA_SHAPE');
  if (model.version !== CRITERIA_VERSION) fail('CRITERIA_VERSION', 'model.version', 'Unsupported version');
  if (!['and', 'or'].includes(model.op)) fail('CRITERIA_GROUP', 'model.op', 'Expected and/or');
  if (!Array.isArray(model.rules) || model.rules.length < 1 || model.rules.length > 20) fail('CRITERIA_RULE_LIMIT', 'model.rules', 'Expected 1..20 rules');
  if (!Array.isArray(schema) || !schema.length) fail('SCHEMA_SHAPE', 'schema', 'Actual schema array required');
  const byName = new Map(), identities = new Set();
  for (const [index, column] of schema.entries()) {
    if (!plain(column) || typeof column.name !== 'string' || !column.name || column.name.includes('\0') || typeof column.type !== 'string' || !column.type.trim() || column.type.includes('\0')) fail('SCHEMA_SHAPE', `schema[${index}]`, 'Exact name/type required');
    const identity = asciiKey(column.name);
    if (identities.has(identity)) fail('SCHEMA_AMBIGUOUS', `schema[${index}].name`, 'Duplicate ASCII-case column identity');
    identities.add(identity); byName.set(column.name, column.type);
  }
  const columnsUsed = [];
  for(let i=0;i<model.rules.length;i++)if(!own(model.rules,i))fail('RULE_SHAPE', `model.rules[${i}]`, 'Sparse rule groups are invalid');
  const conditions = model.rules.map((rule, index) => {
    const where = `model.rules[${index}]`;
    keys(rule, ['column', 'operator', 'value', 'values', 'nulls'], where, 'RULE_SHAPE');
    if (typeof rule.column !== 'string' || !byName.has(rule.column)) fail('SCHEMA_COLUMN_UNKNOWN', where + '.column', 'Use exact actual column name, never an expression');
    const info = typeInfo(byName.get(rule.column)), operator = rule.operator;
    if (!operatorsForType(byName.get(rule.column)).includes(operator)) fail(info.kind === 'unsupported' ? 'SCHEMA_TYPE_UNSUPPORTED' : 'RULE_OPERATOR', where + '.operator', 'Operator unsupported for actual column type');
    if (!columnsUsed.includes(rule.column)) columnsUsed.push(rule.column);
    const identifier = '"' + rule.column.replaceAll('"', '""') + '"';
    if (nullOps.includes(operator)) {
      if (own(rule, 'value') || own(rule, 'values') || own(rule, 'nulls')) fail('RULE_FIELDS', where, 'NULL operators accept no value/list/nulls');
      return `(${identifier} IS ${operator === 'isNotNull' ? 'NOT ' : ''}NULL)`;
    }
    if (!own(rule, 'nulls') || !['include', 'exclude'].includes(rule.nulls)) fail('RULE_NULLS', where + '.nulls', 'Explicit include/exclude required');
    let predicate;
    if (operator === 'isEmpty' || operator === 'isNotEmpty') {
      if (own(rule, 'value') || own(rule, 'values')) fail('RULE_FIELDS', where, 'Empty operators accept no value/list');
      predicate = `${identifier} ${operator === 'isEmpty' ? '=' : '<>'} ''`;
    } else if (operator === 'in' || operator === 'notIn') {
      if (own(rule, 'value') || !own(rule, 'values') || !Array.isArray(rule.values) || rule.values.length < 1 || rule.values.length > 100) fail('RULE_LIST_LIMIT', where + '.values', 'Expected 1..100 list values and no scalar');
      const values = Array.from({ length: rule.values.length }, (_, i) => {
        if (!own(rule.values, i)) fail('VALUE_NULL', where + `.values[${i}]`, 'Sparse lists are invalid');
        return literal(rule.values[i], info, where + `.values[${i}]`);
      });
      predicate = `${identifier} ${operator === 'notIn' ? 'NOT ' : ''}IN (${values.join(', ')})`;
    } else {
      if (!own(rule, 'value') || own(rule, 'values')) fail('RULE_FIELDS', where, 'Expected scalar value and no list');
      const value = literal(rule.value, info, where + '.value');
      if (['contains', 'startsWith', 'endsWith'].includes(operator)) predicate = `${({ contains: 'contains', startsWith: 'starts_with', endsWith: 'ends_with' })[operator]}(${identifier}, ${value})`;
      else predicate = `${identifier} ${({ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' })[operator]} ${value}`;
    }
    return rule.nulls === 'include' ? `(${identifier} IS NULL OR (${predicate}))` : `(${identifier} IS NOT NULL AND (${predicate}))`;
  });
  return { version: CRITERIA_VERSION, condition: '(' + conditions.join(model.op === 'and' ? ' AND ' : ' OR ') + ')', columnsUsed };
}
