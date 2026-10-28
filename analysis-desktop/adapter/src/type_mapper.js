/**
 * SIREN Analysis -> Charts Adapter: Type Mapper & Coordinate Safety Guard
 *
 * Enforces strict type mapping between DuckDB catalog types and siren.chart-data/1.
 * Prevents type coercion defects (VARCHAR numeric must stay string, leading zeros preserved).
 * Enforces IEEE-754 coordinate safety rules (refuses decimals with >15 significant digits or unsafe integers).
 */

const SAFE_ID_REGEX = /^\w[\w-]{0,63}$/;
const FORBIDDEN_COLUMN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const DECIMAL_STRING_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validates whether a calendar date is strictly valid (e.g. rejecting 2026-02-30).
 */
export function isValidISODate(v) {
  if (typeof v !== 'string' || !DATE_REGEX.test(v)) return false;
  const year = parseInt(v.slice(0, 4), 10);
  if (year < 1900 || year > 9999) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
}

/**
 * Validates month format YYYY-MM.
 */
export function isValidISOMonth(v) {
  if (typeof v !== 'string' || !MONTH_REGEX.test(v)) return false;
  const year = parseInt(v.slice(0, 4), 10);
  return year >= 1900 && year <= 9999;
}

/**
 * Maps a DuckDB native catalog type to a Charts contract type and default role.
 *
 * @param {string} duckDbType - DuckDB type (e.g. 'VARCHAR', 'DECIMAL(18,2)', 'BIGINT')
 * @param {Object} hints - Optional override hints { role, type, unit, label }
 * @returns {{ type: string, role: string }}
 */
export function mapDuckDBTypeToCharts(duckDbType, hints = {}) {
  const norm = String(duckDbType || '').trim().toUpperCase();
  const supported = /^(?:(?:DECIMAL|NUMERIC)\(\d+,\s*\d+\)|(?:U?BIGINT|U?INTEGER|U?SMALLINT|U?TINYINT|U?HUGEINT|INT|INT[1248]|UINT[1248]|DOUBLE|FLOAT|REAL|BOOLEAN|BOOL|DATE|MONTH|VARCHAR|TEXT|CHAR|BPCHAR|STRING))$/;
  if (!supported.test(norm)) throw new Error(`SCHEMA_TYPE_UNSUPPORTED: ${norm || 'missing SQL type'}`);

  let inferredType = 'string';
  let inferredRole = 'dimension';

  if (norm.startsWith('DECIMAL') || norm.startsWith('NUMERIC')) {
    inferredType = 'decimal';
    inferredRole = 'measure';
  } else if (
    norm.includes('INT') ||
    norm === 'BIGINT' ||
    norm === 'INTEGER' ||
    norm === 'SMALLINT' ||
    norm === 'TINYINT' ||
    norm === 'HUGEINT' ||
    norm === 'DOUBLE' ||
    norm === 'FLOAT' ||
    norm === 'REAL'
  ) {
    inferredType = 'number';
    inferredRole = 'measure';
  } else if (norm === 'BOOLEAN' || norm === 'BOOL') {
    inferredType = 'boolean';
    inferredRole = 'dimension';
  } else if (norm === 'DATE') {
    inferredType = 'date';
    inferredRole = 'dimension';
  } else if (norm === 'MONTH') {
    inferredType = 'month';
    inferredRole = 'dimension';
  } else {
    // VARCHAR, TEXT, CHAR, BPCHAR, STRING or unknown
    inferredType = 'string';
    inferredRole = 'dimension';
  }

  // Apply explicit caller hints if supplied
  const finalType = hints.type || inferredType;
  if (finalType !== inferredType && !(finalType === 'string' && inferredType === 'number' && hints.role === 'dimension')) throw new Error('SCHEMA_TYPE_CONFLICT: Normalize or cast types explicitly in Analysis, not in Charts admission.');
  const finalRole = hints.role || inferredRole;

  // Validation: Charts contract forbids measure roles with non-numeric types
  if (finalRole === 'measure' && !['decimal', 'number'].includes(finalType)) {
    throw new Error(
      `MEASURE_TYPE_INVALID: Column with role 'measure' must have type 'number' or 'decimal', got '${finalType}'.`
    );
  }

  return { type: finalType, role: finalRole };
}

/**
 * Validates coordinate safety for Charts consumption.
 * Refuses coordinates that Charts cannot represent safely (e.g. >15 significant digits or unsafe integers).
 *
 * @param {*} val - Value to check
 * @param {string} colType - 'string' | 'number' | 'decimal' | 'date' | 'month' | 'boolean'
 * @param {string} colRole - 'dimension' | 'measure' | 'series'
 * @param {string} colId - Column identifier
 * @param {string} rowId - Row identifier
 */
export function assertSafeCoordinate(val, colType, colRole, colId, rowId) {
  if (val === null) return; // Null handled separately by nullable checks

  if (colType === 'string') {
    if (typeof val !== 'string') {
      throw new Error(`TYPE_MISMATCH: Row '${rowId}', col '${colId}' expected string, got ${typeof val}.`);
    }
    if (val.length > 1024) {
      throw new Error(`STRING_TOO_LONG: Row '${rowId}', col '${colId}' exceeds 1024 chars.`);
    }
    return;
  }

  if (colType === 'boolean') {
    if (typeof val !== 'boolean') {
      throw new Error(`TYPE_MISMATCH: Row '${rowId}', col '${colId}' expected boolean, got ${typeof val}.`);
    }
    return;
  }

  if (colType === 'date') {
    if (!isValidISODate(val)) {
      throw new Error(`INVALID_DATE: Row '${rowId}', col '${colId}' has invalid ISO date '${val}'.`);
    }
    return;
  }

  if (colType === 'month') {
    if (!isValidISOMonth(val)) {
      throw new Error(`INVALID_MONTH: Row '${rowId}', col '${colId}' has invalid ISO month '${val}'.`);
    }
    return;
  }

  if (colType === 'decimal') {
    if (typeof val !== 'string' || !DECIMAL_STRING_REGEX.test(val)) {
      throw new Error(
        `INVALID_DECIMAL: Row '${rowId}', col '${colId}' must be a decimal string matching ${DECIMAL_STRING_REGEX}, got: ${val}`
      );
    }
    if (val.length > 1024) {
      throw new Error(`DECIMAL_TOO_LONG: Row '${rowId}', col '${colId}' exceeds 1024 chars.`);
    }

    // Coordinate safety check: Charts project() parses decimal strings via numeric()
    // and strictly fails if significant digits > 15!
    const digits = val.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
    if (digits.length > 15) {
      throw new Error(
        `UNSAFE_COORDINATE: Row '${rowId}', col '${colId}' has ${digits.length} significant digits ('${val}'), exceeding the 15-digit limit for safe floating-point representation in Charts. Request an explicitly scaled or aggregated result from Analysis.`
      );
    }

    const n = Number(val);
    if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(val)) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
      throw new Error(
        `UNSAFE_COORDINATE: Decimal value '${val}' cannot be represented safely in IEEE-754 double precision in row '${rowId}', col '${colId}'.`
      );
    }
    return;
  }

  if (colType === 'number') {
    if (typeof val === 'bigint') {
      if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error(
          `UNSAFE_COORDINATE: BigInt value ${val} in row '${rowId}', col '${colId}' exceeds safe integer range [${Number.MIN_SAFE_INTEGER}, ${Number.MAX_SAFE_INTEGER}]. Charts cannot safely represent this coordinate without precision loss. Request explicit scaling or string identifier mapping in Analysis.`
        );
      }
      return;
    }

    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(
        `INVALID_NUMBER: Row '${rowId}', col '${colId}' expected finite number, got ${typeof val} (${val}).`
      );
    }

    if (Number.isInteger(val) && !Number.isSafeInteger(val)) {
      throw new Error(
        `UNSAFE_COORDINATE: Integer value ${val} in row '${rowId}', col '${colId}' exceeds safe integer capacity. Request explicit scaling in Analysis.`
      );
    }
  }
}

/**
 * Formats a raw cell value from DuckDB into the exact representation required by Charts.
 *
 * @param {*} rawVal - Raw value from DuckDB
 * @param {string} colType - Charts column type
 * @returns {*} Transformed cell value
 */
export function formatCellValue(rawVal, colType) {
  if (rawVal === null || rawVal === undefined) {
    return null;
  }

  if (colType === 'string') {
    // Preserve string identity literally; never coerce numbers or trim leading zeros
    if (typeof rawVal !== 'string') throw new Error('TYPE_MISMATCH: Expected exact text from declared source type.');
    return rawVal;
  }

  if (colType === 'boolean') {
    if (typeof rawVal !== 'boolean') throw new Error('TYPE_MISMATCH: Expected boolean; text is not a boolean.');
    return rawVal;
  }

  if (colType === 'date') {
    if (rawVal instanceof Date) {
      return rawVal.toISOString().slice(0, 10);
    }
    if (typeof rawVal !== 'string') throw new Error('TYPE_MISMATCH: Expected exact ISO date text.');
    return rawVal;
  }

  if (colType === 'month') {
    if (typeof rawVal !== 'string') throw new Error('TYPE_MISMATCH: Expected exact ISO month text.');
    return rawVal;
  }

  if (colType === 'decimal') {
    // Charts contract requires exact decimal string
    if (typeof rawVal !== 'string') throw new Error('TYPE_MISMATCH: Expected exact DECIMAL JSON string.');
    return rawVal;
  }

  if (colType === 'number') {
    if (typeof rawVal === 'bigint') {
      return Number(rawVal);
    }
    if (typeof rawVal === 'number') {
      return rawVal;
    }
    if (typeof rawVal !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawVal)) throw new Error('INVALID_NUMBER: Expected native number or canonical numeric text, never blank/boolean.');
    return Number(rawVal);
  }

  return rawVal;
}

/**
 * Validates column ID according to Charts contract.
 */
export function assertValidColumnId(id, existingIds = new Set()) {
  if (typeof id !== 'string' || !id || id.length > 64) {
    throw new Error(`COLUMN_ID_INVALID: Column ID must be non-empty string <= 64 chars, got '${id}'.`);
  }
  if (!SAFE_ID_REGEX.test(id)) {
    throw new Error(`COLUMN_ID_FORMAT: Column ID '${id}' does not match pattern ${SAFE_ID_REGEX}.`);
  }
  if (FORBIDDEN_COLUMN_IDS.has(id)) {
    throw new Error(`COLUMN_ID_FORBIDDEN: Column ID '${id}' is forbidden (prototype pollution defense).`);
  }
  if (existingIds.has(id)) {
    throw new Error(`COLUMN_ID_DUPLICATE: Duplicate column ID '${id}'.`);
  }
}
