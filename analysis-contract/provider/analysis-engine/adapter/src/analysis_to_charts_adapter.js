/**
 * SIREN Analysis -> Charts Minimal Adapter
 *
 * Transforms an Analysis DuckDB execution result into a siren.chart-data/1 snapshot.
 * Enforces:
 *   - Strict type preservation (no VARCHAR numeric auto-coercion, leading zeros preserved)
 *   - Safe coordinates (refuses decimals with >15 significant digits or unsafe integers)
 *   - Explicit identity (sourceId, jobId, resultVersion with content-sha256 fallback)
 *   - Explicit coverage counts (sourceRowCount, resultRowCount, transferredRows)
 *   - Rejection of TRUNCATED results
 *   - Hard admission limits (<=5 MiB, <=5000 rows, <=32 columns)
 *   - Direct validation against Charts app/core.js validator
 */

import { createRequire } from 'node:module';
import {
  mapDuckDBTypeToCharts,
  assertSafeCoordinate,
  formatCellValue,
  assertValidColumnId
} from './type_mapper.js';
import {
  buildSourceIdentity,
  generateSnapshotId,
  computeContentHash
} from './identity_helper.js';
import { buildAndValidateCoverage } from './coverage_validator.js';

const require = createRequire(import.meta.url);

export const CHARTS_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024, // 5 MiB
  maxRows: 5000,
  maxColumns: 32,
  maxCategories: 50,
  maxSeries: 8
});

export class AnalysisToChartsAdapter {
  /**
   * Transforms an Analysis query result into a siren.chart-data/1 snapshot payload.
   *
   * @param {Object} input
   *   - rows: Array<Object> (Preview / fetched row objects from DuckDB)
   *   - schema: Array<Object> (DuckDB schema from DESCRIBE or getTableSchema: [{ name, type, nullable }])
   *   - source: Object ({ sourceId, jobId, resultVersion?, capturedAt?, state? })
   *   - coverage: Object ({ kind: 'complete'|'aggregate'|'sampled', sourceRowCount, resultRowCount, transferredRows, aggregation?, selection? })
   *   - columnHints?: Object ({ [colName]: { role, type, unit, label } })
   *   - snapshotId?: string (optional override)
   * @param {Object} options
   *   - validateWithChartsCore?: boolean (default: true)
   *   - chartsCorePath?: string (default: 'C:/Claude/SIREN_WORK/charts-visual-analytics-parallel-20261025/app/core.js')
   * @returns {Object} siren.chart-data/1 snapshot object
   */
  static transform(input, options = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error('ADAPTER_INPUT_ERROR: Input must be a valid object.');
    }

    const {
      rows = [],
      schema = [],
      source = {},
      coverage = {},
      columnHints = {},
      snapshotId: explicitSnapshotId = null
    } = input;

    if (!Array.isArray(rows)) {
      throw new Error('ADAPTER_INPUT_ERROR: "rows" must be an array.');
    }
    if (!Array.isArray(schema) || schema.length === 0) {
      throw new Error('ADAPTER_INPUT_ERROR: "schema" must be a non-empty array of column definitions.');
    }

    // 1. Admission Limit Checks (Hard Gates)
    if (schema.length > CHARTS_LIMITS.maxColumns) {
      throw new Error(
        `COLUMNS_LIMIT_EXCEEDED: Result has ${schema.length} columns, exceeding Charts admission limit of ${CHARTS_LIMITS.maxColumns}. Request a projected column selection from Analysis.`
      );
    }
    if (rows.length > CHARTS_LIMITS.maxRows) {
      throw new Error(
        `ROWS_LIMIT_EXCEEDED: Result has ${rows.length} rows, exceeding Charts admission limit of ${CHARTS_LIMITS.maxRows}. Request an engine-computed bounded aggregate or explicit sample from Analysis. Truncation is rejected.`
      );
    }

    // 2. Build Columns with Safe Types & Roles
    const columns = [];
    const columnIds = new Set();
    const sqlTypes = new Map();

    for (let i = 0; i < schema.length; i++) {
      const col = schema[i];
      const colName = col.name || col.columnName || col.id;
      if (!colName) {
        throw new Error(`SCHEMA_ERROR: Column at index ${i} has no name.`);
      }

      assertValidColumnId(colName, columnIds);
      columnIds.add(colName);

      const duckDbType = col.type || col.columnType;
      if (typeof duckDbType !== 'string' || !duckDbType) throw new Error('SCHEMA_ERROR: Exact SQL type required.');
      sqlTypes.set(colName,duckDbType.trim().toUpperCase());
      const hints = columnHints[colName] || {};

      const { type, role } = mapDuckDBTypeToCharts(duckDbType, hints);

      const unit = hints.unit !== undefined
        ? (hints.unit === null ? null : String(hints.unit).trim() || null)
        : null;

      const nullable = hints.nullable !== undefined
        ? Boolean(hints.nullable)
        : (col.nullable !== undefined ? Boolean(col.nullable) : true);

      const label = hints.label || col.label || colName;

      columns.push({
        id: colName,
        label: String(label).slice(0, 1024),
        type,
        role,
        unit,
        nullable
      });
    }

    // 3. Transform Rows & Check Coordinate Safety
    const transformedRows = [];
    const rowIds = new Set();

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const r = rows[rIdx];
      if (!r || typeof r !== 'object') {
        throw new Error(`ROW_ERROR: Row at index ${rIdx} is not an object.`);
      }

      const rowId = String(r.id || `row_${rIdx}`);
      if (rowIds.has(rowId)) {
        throw new Error(`DUPLICATE_ROW_ID: Row ID '${rowId}' is duplicated at index ${rIdx}.`);
      }
      rowIds.add(rowId);

      // Extract raw values from either row object or r.values (if already nested)
      const rawValues = r.values && typeof r.values === 'object' && !Array.isArray(r.values)
        ? r.values
        : r;

      const rowValues = {};

      for (const col of columns) {
        const hasProp = Object.prototype.hasOwnProperty.call(rawValues, col.id);

        if (!hasProp) {
          if (col.role === 'measure') {
            throw new Error(`MISSING_MEASURE: Row '${rowId}' is missing required measure column '${col.id}'.`);
          }
          // Absent dimension category is allowed in contract
          continue;
        }

        const rawVal = rawValues[col.id];

        if (rawVal === undefined) throw new Error('UNDEFINED_VALUE: Explicit undefined is not SQL NULL or an absent dimension.');
        if (rawVal === null) {
          if (!col.nullable) {
            throw new Error(`NULL_VIOLATION: Non-nullable column '${col.id}' has null value in row '${rowId}'.`);
          }
          rowValues[col.id] = null;
          continue;
        }

        if (col.type === 'number' && /^(?:U?BIGINT|U?INTEGER|U?SMALLINT|U?TINYINT|U?HUGEINT|INT(?:[1248])?|UINT[1248])$/.test(sqlTypes.get(col.id)) && !/^-?(?:0|[1-9]\d*)$/.test(String(rawVal))) throw new Error('INTEGER_REPRESENTATION: Expected an exact integer.');
        const formattedVal = formatCellValue(rawVal, col.type);

        // Enforce Coordinate Safety (IEEE-754 precision limits, max safe integers, valid dates)
        assertSafeCoordinate(formattedVal, col.type, col.role, col.id, rowId);

        rowValues[col.id] = formattedVal;
      }

      transformedRows.push({
        id: rowId,
        values: rowValues
      });
    }

    const validatedCoverage = buildAndValidateCoverage(coverage, transformedRows.length);

    // 4. Source Identity & Provenance
    const sourceIdentity = buildSourceIdentity(source, {
      columns,
      rows: transformedRows,
      coverage: validatedCoverage
    });

    const snapshotId = explicitSnapshotId && String(explicitSnapshotId).trim()
      ? String(explicitSnapshotId).trim()
      : generateSnapshotId(sourceIdentity.sourceId, sourceIdentity.jobId, sourceIdentity.resultVersion);

    // 5. Coverage validated before assigning content identity.

    // 6. Assemble siren.chart-data/1 Envelope
    const snapshot = {
      schemaVersion: 'siren.chart-data/1',
      snapshotId,
      columns,
      rows: transformedRows,
      source: sourceIdentity,
      coverage: validatedCoverage
    };

    // 7. Verify Envelope Size (<= 5 MiB)
    const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    if (jsonBytes > CHARTS_LIMITS.maxBytes) {
      throw new Error(
        `PAYLOAD_TOO_LARGE: Generated snapshot is ${jsonBytes} bytes, exceeding the 5 MiB Charts admission limit (${CHARTS_LIMITS.maxBytes} bytes). Request a smaller bounded result from Analysis.`
      );
    }

    // 8. Direct Validation via Charts core.js Validator (if requested)
    const validateWithCore = options.validateWithChartsCore !== false;
    if (validateWithCore) {
      const corePath = options.chartsCorePath || 'C:/Claude/SIREN_WORK/charts-visual-analytics-parallel-20261025/app/core.js';
      try {
        const chartsCore = require(corePath);
        if (!chartsCore || typeof chartsCore.validateSnapshot !== 'function') throw new Error('VALIDATOR_MISSING: Required Charts validator is unavailable.');
        chartsCore.validateSnapshot(snapshot);
      } catch (err) {
        throw new Error(`CHARTS_CORE_VALIDATION_FAILED: ${err.message}`);
      }
    }

    const freeze = value => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    };
    return freeze(snapshot);
  }
}
