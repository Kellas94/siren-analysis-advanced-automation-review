// Pure projection compiler; data transformation stays in the existing DuckDB engine.
export const DERIVED_COLUMNS_VERSION = 'analysis.derived-columns/1';
export const MAX_DERIVED_COLUMNS = 20;
export const MAX_CHARACTER_ARGUMENT = '1000000';
export class DerivedColumnsValidationError extends TypeError {
  constructor(code, path, detail) { super(`${code}: ${path}: ${detail}`); this.name = 'DerivedColumnsValidationError'; this.code = code; this.path = path; }
}
const fail = (code, path, detail) => { throw new DerivedColumnsValidationError(code, path, detail); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const own = (obj, key) => Object.hasOwn(obj, key);
const asciiKey = value => value.replace(/[A-Z]/g, c => c.toLowerCase());
function name(value, where) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail('DERIVED_NAME', where, 'Nonempty exact identifier without NUL required');
  return value;
}
const quoteIdentifier = value => '"' + value.replaceAll('"', '""') + '"';
function shape(value, allowed, required, where) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !own(value, k))) fail('DERIVED_SHAPE', where, 'Unexpected/missing object field');
}
function integer(value, where, minimum) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) fail('DERIVED_INTEGER_SYNTAX', where, 'Canonical unsigned decimal integer string required');
  const number = BigInt(value);
  if (number < minimum || number > BigInt(MAX_CHARACTER_ARGUMENT)) fail('DERIVED_INTEGER_RANGE', where, `Expected ${minimum}..${MAX_CHARACTER_ARGUMENT}`);
  return `CAST('${value}' AS INTEGER)`;
}
export function compileDerivedColumns(model, schema) {
  shape(model, ['version', 'columns'], ['version', 'columns'], 'model');
  if (model.version !== DERIVED_COLUMNS_VERSION) fail('DERIVED_VERSION', 'model.version', 'Unsupported version');
  if (!Array.isArray(model.columns) || model.columns.length < 1 || model.columns.length > MAX_DERIVED_COLUMNS) fail('DERIVED_COLUMN_LIMIT', 'model.columns', `Expected 1..${MAX_DERIVED_COLUMNS} added columns`);
  if (!Array.isArray(schema) || !schema.length) fail('DERIVED_SCHEMA', 'schema', 'Actual nonempty schema required');
  const sourceByName = new Map(), identities = new Set();
  for (const [index, column] of schema.entries()) {
    if (!plain(column) || !own(column, 'name') || !own(column, 'type') || typeof column.type !== 'string' || !column.type.trim() || column.type.includes('\0')) fail('DERIVED_SCHEMA', `schema[${index}]`, 'Actual name/type required');
    name(column.name, `schema[${index}].name`);
    const key = asciiKey(column.name);
    if (identities.has(key)) fail('DERIVED_SCHEMA_AMBIGUOUS', `schema[${index}].name`, 'Duplicate ASCII-case identity');
    identities.add(key); sourceByName.set(column.name, column);
  }
  const aliases = new Set();
  for (const [index, column] of model.columns.entries()) {
    if (!plain(column)) fail('DERIVED_SHAPE', `model.columns[${index}]`, 'Column object required');
    name(column.alias, `model.columns[${index}].alias`);
    const key = asciiKey(column.alias);
    if (identities.has(key) || aliases.has(key)) fail('DERIVED_ALIAS_CONFLICT', `model.columns[${index}].alias`, 'Alias conflicts with source or another added column under ASCII-case comparison');
    aliases.add(key);
  }
  const selectExpressions = schema.map(column => `${quoteIdentifier(column.name)} AS ${quoteIdentifier(column.name)}`);
  const outputSchema = schema.map(column => ({ ...column }));
  for (const [index, column] of model.columns.entries()) {
    const where = `model.columns[${index}]`, op = column.operation;
    let expression;
    if (op === 'literal') {
      shape(column, ['alias', 'operation', 'type', 'value'], ['alias', 'operation', 'type', 'value'], where);
      if (column.type !== 'VARCHAR') fail('DERIVED_LITERAL_TYPE', where + '.type', 'v1 literal requires explicit VARCHAR');
      if (column.value === null) expression = 'CAST(NULL AS VARCHAR)';
      else {
        if (typeof column.value !== 'string' || column.value.includes('\0')) fail('DERIVED_LITERAL_VALUE', where + '.value', 'VARCHAR text or explicit NULL required, without NUL');
        expression = `CAST('${column.value.replaceAll("'", "''")}' AS VARCHAR)`;
      }
    } else if (['left', 'right', 'mid'].includes(op)) {
      shape(column, op === 'mid' ? ['alias', 'operation', 'source', 'start', 'count'] : ['alias', 'operation', 'source', 'count'], op === 'mid' ? ['alias', 'operation', 'source', 'start', 'count'] : ['alias', 'operation', 'source', 'count'], where);
      name(column.source, where + '.source');
      if (!sourceByName.has(column.source)) fail(aliases.has(asciiKey(column.source)) ? 'DERIVED_CHAIN_UNSUPPORTED' : 'DERIVED_SOURCE_UNKNOWN', where + '.source', 'Only exact original source columns are allowed; add another node for chaining');
      if (sourceByName.get(column.source).type.trim().toUpperCase() !== 'VARCHAR') fail('DERIVED_SOURCE_TYPE', where + '.source', 'String operations require actual VARCHAR; no implicit cast');
      const source = quoteIdentifier(column.source), count = integer(column.count, where + '.count', 0n);
      expression = op === 'mid' ? `substring(${source}, ${integer(column.start, where + '.start', 1n)}, ${count})` : `${op}(${source}, ${count})`;
    } else fail('DERIVED_OPERATION', where + '.operation', 'Only literal/left/right/mid are implemented in v1');
    selectExpressions.push(`${expression} AS ${quoteIdentifier(column.alias)}`);
    outputSchema.push({ name: column.alias, type: 'VARCHAR' });
  }
  return { version: DERIVED_COLUMNS_VERSION, selectExpressions, schema: outputSchema, columnsUsed: schema.map(column => column.name) };
}
