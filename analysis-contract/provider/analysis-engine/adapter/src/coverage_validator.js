/**
 * SIREN Analysis -> Charts Adapter: Coverage & Admission Policy Validator
 *
 * Enforces strict coverage counts and admission policies from siren.chart-data/1.
 * Distinguishes sourceRowCount, resultRowCount, and transferredRows.
 * Rejects silent slicing or TRUNCATED results with explicit actionable refusal.
 */

/**
 * Validates and normalizes coverage metadata.
 *
 * @param {Object} inputCoverage
 *   - kind: 'complete' | 'aggregate' | 'sampled' | 'truncated'
 *   - sourceRowCount: number (safe integer >= 0)
 *   - resultRowCount: number (safe integer >= 0)
 *   - transferredRows: number (safe integer >= 0)
 *   - aggregation?: Object (required if kind === 'aggregate')
 *   - selection?: Object (required if kind === 'sampled')
 * @param {number} actualRowsLength - Number of rows actually being transferred
 * @returns {Object} Validated coverage object
 */
export function buildAndValidateCoverage(inputCoverage = {}, actualRowsLength = 0) {
  const kind = String(inputCoverage.kind || inputCoverage.transferStatus || '').toLowerCase();
  for (const key of ['sourceRowCount','resultRowCount','transferredRows']) {
    if (!Object.hasOwn(inputCoverage,key) || typeof inputCoverage[key] !== 'number') throw new Error(`ROW_COUNT_REQUIRED: Explicit numeric ${key} required; unknown counts cannot be inferred from preview length.`);
  }

  // Strict Policy: REFUSE TRUNCATED RESULTS
  if (kind === 'truncated') {
    throw new Error(
      'TRUNCATION_REFUSED: TRUNCATED coverage is strictly refused by the Charts contract. Charts does not allow arbitrary or silent row slicing because truncating a dataset skews visual distributions and invalidates analytical summaries. To visualize large datasets in Charts, request either an engine-computed bounded aggregate (kind: "aggregate") or an explicit representative sample (kind: "sampled") with a documented sampling method.'
    );
  }

  if (!['complete', 'aggregate', 'sampled'].includes(kind)) {
    throw new Error(
      `INVALID_COVERAGE_KIND: Coverage kind must be one of ['complete', 'aggregate', 'sampled'], got '${kind}'.`
    );
  }

  const sourceRowCount = inputCoverage.sourceRowCount !== undefined && inputCoverage.sourceRowCount !== null
    ? Number(inputCoverage.sourceRowCount)
    : actualRowsLength;

  const resultRowCount = inputCoverage.resultRowCount !== undefined && inputCoverage.resultRowCount !== null
    ? Number(inputCoverage.resultRowCount)
    : actualRowsLength;

  const transferredRows = inputCoverage.transferredRows !== undefined && inputCoverage.transferredRows !== null
    ? Number(inputCoverage.transferredRows)
    : actualRowsLength;

  // Assert non-negative safe integers
  for (const [key, val] of [
    ['sourceRowCount', sourceRowCount],
    ['resultRowCount', resultRowCount],
    ['transferredRows', transferredRows]
  ]) {
    if (!Number.isSafeInteger(val) || val < 0) {
      throw new Error(
        `ROW_COUNT_INVALID: Coverage count '${key}' must be a non-negative safe integer, got ${val}.`
      );
    }
  }

  // Contract rule: transferredRows MUST equal actual array length
  if (transferredRows !== actualRowsLength) {
    throw new Error(
      `ROW_COUNT_MISMATCH: transferredRows (${transferredRows}) does not equal actual rows transferred (${actualRowsLength}).`
    );
  }

  // Contract rule: resultRowCount cannot be smaller than transferredRows
  if (resultRowCount < transferredRows) {
    throw new Error(
      `ROW_COUNT_INCONSISTENT: resultRowCount (${resultRowCount}) cannot be smaller than transferredRows (${transferredRows}).`
    );
  }

  // Contract rule: For 'complete' and 'aggregate', resultRowCount MUST equal transferredRows
  if (kind !== 'sampled' && resultRowCount !== transferredRows) {
    throw new Error(
      `ROW_COUNT_INCONSISTENT: For coverage kind '${kind}', every computed result row must be transferred (resultRowCount: ${resultRowCount} !== transferredRows: ${transferredRows}). If only a subset is transferred, coverage kind must be 'sampled'.`
    );
  }

  // Contract rule: 'sampled' requires selection object with method & description
  let selection = null;
  if (kind === 'sampled') {
    const sel = inputCoverage.selection;
    if (
      !sel ||
      typeof sel !== 'object' ||
      !sel.method ||
      typeof sel.method !== 'string' ||
      !sel.description ||
      typeof sel.description !== 'string'
    ) {
      throw new Error(
        'SELECTION_METADATA_REQUIRED: Coverage kind "sampled" requires selection object with non-empty "method" and "description" properties.'
      );
    }
    selection = {
      method: String(sel.method).trim(),
      description: String(sel.description).trim()
    };
  }

  // Contract rule: 'aggregate' requires aggregation object with description
  let aggregation = null;
  if (kind === 'aggregate') {
    const agg = inputCoverage.aggregation;
    if (
      !agg ||
      typeof agg !== 'object' ||
      !agg.description ||
      typeof agg.description !== 'string'
    ) {
      throw new Error(
        'AGGREGATION_METADATA_REQUIRED: Coverage kind "aggregate" requires aggregation object with non-empty "description".'
      );
    }
    aggregation = {
      description: String(agg.description).trim(),
      type: agg.type ? String(agg.type).trim() : 'CUSTOM'
    };
  }

  return {
    kind,
    sourceRowCount,
    resultRowCount,
    transferredRows,
    aggregation,
    selection
  };
}
