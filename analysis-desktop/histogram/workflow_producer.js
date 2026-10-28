/**
 * SIREN Analysis Exact Histogram Producer for Filtered and Aggregated Sources
 *
 * Extends the exact DuckDB histogram producer with:
 *   1. Full upstream lineage & execution binding (input, filter, select, join, aggregate, pivot)
 *   2. Strict distinction between filtered observations, aggregate entity distributions, and direct source observations
 *   3. Rejection of sampled, truncated, preview-only, and outdated outputs
 *   4. Strict separation between execution identity (resultVersion) and physical dataset identity (datasetIdentity)
 *   5. Preservation of exact numeric intervals, interval closure, NULL separation, zero bins, and out-of-range rejection
 *
 * Target contracts: siren.chart-data/1 (mode: engine-bins), siren.chart/1, siren.chart-file/1
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const DECIMAL_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
// Extrema are metadata, not chart coordinates. Widened floating values may use
// scientific notation; bound the exponent to the actual DOUBLE domain.
function validExtremumString(v){if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(v))return false;const m=/e([+-]?\d+)$/i.exec(v);if(m&&Math.abs(Number(m[1]))>324)return false;const n=Number(v);return Number.isFinite(n)&&!(n===0&&/[1-9]/.test(v.split(/[eE]/)[0]))}


const NUMERIC_DUCKDB_TYPE_REGEX = /^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i;

export function quoteIdentifier(name) {
  if (typeof name !== 'string' || !name || name.length > 128 || name.includes('\0')) {
    throw new Error('INVALID_IDENTIFIER: Identifier must be a non-empty string <= 128 characters without null bytes.');
  }
  return '"' + name.replaceAll('"', '""') + '"';
}

export const canonical = v =>
  v === null
    ? 'null'
    : Array.isArray(v)
    ? '[' + v.map(canonical).join(',') + ']'
    : typeof v === 'object'
    ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
    : JSON.stringify(v);

export const sha = v => crypto.createHash('sha256').update(canonical(v)).digest('hex');

export function freeze(v) {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}

/**
 * Exact numeric string comparison for decimal strings.
 * Reconciles with Charts core exactCompare.
 */
export function exactCompare(a, b) {
  function parts(v) {
    const match = String(v).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if (!match) throw new Error(`DECIMAL_PARSE_ERROR: Cannot compare exact decimal: ${v}`);
    const scale = (match[3] || '').length - Number(match[4] || 0);
    return {
      n: BigInt((match[1] || '') + match[2] + (match[3] || '')),
      scale
    };
  }
  const x = parts(a);
  const y = parts(b);
  const scale = Math.max(x.scale, y.scale);
  const nx = x.n * 10n ** BigInt(scale - x.scale);
  const ny = y.n * 10n ** BigInt(scale - y.scale);
  return nx < ny ? -1 : nx > ny ? 1 : 0;
}

/**
 * Validates histogram bin edges according to Charts contract and DuckDB decimal literal limits.
 *
 * @param {Array<string>} edges - Array of strictly increasing decimal strings
 * @returns {Array<string>} Validated edges
 */
export function validateBinEdges(edges) {
  if (!Array.isArray(edges)) {
    throw new Error('INVALID_BIN_EDGES: "edges" must be an array of strings.');
  }
  if (edges.length < 2 || edges.length > 51) {
    throw new Error(
      `INVALID_BIN_EDGES: Charts requires 2..51 explicit edges (yielding 1..50 bins), got ${edges.length}.`
    );
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (typeof e !== 'string' || e.length > 1024 || !DECIMAL_REGEX.test(e)) {
      throw new Error(
        `INVALID_BIN_EDGE_FORMAT: Edge at index ${i} ('${e}') must be an exact decimal string matching ${DECIMAL_REGEX}.`
      );
    }
    // Check significant digits (Charts <=15 digits guard)
    const digits = e.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
    if (digits.length > 15) {
      throw new Error(
        `UNSAFE_COORDINATE: Edge '${e}' has ${digits.length} significant digits, exceeding the 15-digit limit for safe floating point representation.`
      );
    }
    const n = Number(e);
    if (!Number.isFinite(n) || (n === 0 && /[1-9]/.test(e)) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
      throw new Error('UNSAFE_COORDINATE: edge is not safely representable by Charts');
    }
    const fraction = e.split('.')[1] || '';
    const integer = e.replace('-', '').split('.')[0].replace(/^0+/, '');
    if (fraction.length > 38 || integer.length + fraction.length > 38) {
      throw new Error('SQL_EDGE_PRECISION: exact DuckDB decimal literal exceeds width/scale38');
    }

    if (i > 0) {
      const cmp = exactCompare(edges[i - 1], e);
      if (cmp === 0) {
        throw new Error(
          `DUPLICATE_BIN_EDGE: Duplicate edge value '${e}' detected at indices ${i - 1} and ${i}. Edges must be strictly increasing.`
        );
      }
      if (cmp > 0) {
        throw new Error(
          `UNORDERED_BIN_EDGES: Edge at index ${i - 1} ('${edges[i - 1]}') is greater than edge at index ${i} ('${e}'). Edges must be strictly increasing.`
        );
      }
    }
  }

  return edges;
}

/**
 * Validates that the target measure column exists in the schema and has an explicitly numeric type.
 * Refuses implicit conversion of VARCHAR or non-numeric types.
 *
 * @param {Array<Object>} schema - Array of DuckDB schema columns [{ columnName, columnType }] or [{ name, type }]
 * @param {string} measureColumn - Name of the column to bin
 * @returns {Object} Validated column definition { name, type }
 */
export function validateMeasureColumnSchema(schema, measureColumn) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error('INVALID_SCHEMA: Schema must be a non-empty array of column definitions.');
  }
  if (!measureColumn || typeof measureColumn !== 'string') {
    throw new Error('INVALID_MEASURE_COLUMN: "measureColumn" must be a non-empty string.');
  }

  const col = schema.find(c => {
    const colName = c.columnName || c.name;
    return colName === measureColumn;
  });

  if (!col) {
    const available = schema.map(c => c.columnName || c.name).join(', ');
    throw new Error(`COLUMN_NOT_FOUND: Measure column "${measureColumn}" was not found in schema. Available columns: [${available}].`);
  }

  const colType = (col.columnType || col.type || '').trim().toUpperCase();

  if (colType === 'VARCHAR' || colType === 'TEXT' || colType.startsWith('VARCHAR') || colType.startsWith('CHAR')) {
    throw new Error(
      `NON_NUMERIC_COLUMN_REFUSED: Measure column "${measureColumn}" is of type "${colType}". Implicit conversion of VARCHAR to numeric is strictly forbidden by SIREN contract. Cast explicitly in upstream pipeline if numeric.`
    );
  }

  if (!NUMERIC_DUCKDB_TYPE_REGEX.test(colType)) {
    throw new Error(
      `NON_NUMERIC_COLUMN_REFUSED: Measure column "${measureColumn}" has non-numeric type "${colType}". Histograms require explicit numeric types (DECIMAL, BIGINT, INTEGER, DOUBLE, etc.).`
    );
  }

  return {
    name: col.columnName || col.name,
    type: colType
  };
}

/**
 * Builds aggregation expressions for an Alteryx-style visual 'aggregate' DAG node.
 * Compatible with DuckDB and PipelineCompiler.
 *
 * @param {string} measureColumn
 * @param {Array<string>} edges
 * @returns {Array<Object>} [{ expr, alias }]
 */
export function buildHistogramAggregationExprs(measureColumn,edges) {
  validateBinEdges(edges);const col=quoteIdentifier(measureColumn);
  const floating=`typeof(any_value(${col})) IN ('FLOAT','DOUBLE')`,wide=`CAST(${col} AS DOUBLE)`,edge=v=>`CAST('${v}' AS DOUBLE)`;
  const count=(native,promoted)=>`CASE WHEN ${floating} THEN COUNT(CASE WHEN ${promoted} THEN 1 END) ELSE COUNT(CASE WHEN ${native} THEN 1 END) END`;
  const result=[{expr:'COUNT(*)',alias:'total_count'},{expr:`COUNT(${col})`,alias:'non_null_count'},{expr:`COUNT(*) - COUNT(${col})`,alias:'null_count'},
    {expr:count(`${col} < ${edges[0]} OR ${col} > ${edges.at(-1)}`,`${wide} < ${edge(edges[0])} OR ${wide} > ${edge(edges.at(-1))}`),alias:'out_of_range_count'},
    {expr:`CASE WHEN ${floating} THEN CAST(MIN(${wide}) AS VARCHAR) ELSE CAST(MIN(${col}) AS VARCHAR) END`,alias:'min_observed'},
    {expr:`CASE WHEN ${floating} THEN CAST(MAX(${wide}) AS VARCHAR) ELSE CAST(MAX(${col}) AS VARCHAR) END`,alias:'max_observed'}];
  for(let i=0;i<edges.length-1;i++){const op=i===edges.length-2?'<=':'<';
    result.push({expr:count(`${col} >= ${edges[i]} AND ${col} ${op} ${edges[i+1]}`,`${wide} >= ${edge(edges[i])} AND ${wide} ${op} ${edge(edges[i+1])}`),alias:'bin_'+i});
  }
  return result;
}

/**
 * Constructs a full visual DAG pipeline definition for computing an exact histogram.
 */
export function buildHistogramPipelineDef(params) {
  const {
    inputNodeId = 'in_source',
    sourcePath,
    format = 'parquet',
    header = true,
    delimiter = ',',
    allVarchar = false,
    histNodeId = 'hist_agg',
    measureColumn,
    edges
  } = params;

  if (!sourcePath) {
    throw new Error('INVALID_PIPELINE_PARAMS: "sourcePath" is required.');
  }

  const aggregations = buildHistogramAggregationExprs(measureColumn, edges);

  return {
    nodes: [
      {
        id: inputNodeId,
        type: 'input',
        data: {
          path: sourcePath,
          format,
          header,
          delimiter,
          allVarchar
        }
      },
      {
        id: histNodeId,
        type: 'aggregate',
        data: {
          groupBy: [],
          aggregations
        }
      }
    ],
    edges: [
      { source: inputNodeId, target: histNodeId }
    ]
  };
}

/**
 * Generates exact DuckDB SQL for calculating histogram bins using conditional aggregation.
 */
export function buildHistogramSql({sourceTableOrView,measureColumn,edges,whereClause=null}) {
  if(typeof sourceTableOrView!=='string'||!sourceTableOrView)throw Error('INVALID_SOURCE_VIEW');
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sourceTableOrView))throw Error('INVALID_SOURCE_VIEW');
  const expressions=buildHistogramAggregationExprs(measureColumn,edges).map(a=>a.expr+' AS '+quoteIdentifier(a.alias));
  return 'SELECT '+expressions.join(', ')+' FROM '+sourceTableOrView+(whereClause?' WHERE '+whereClause:'')+';';
}

/**
 * Normalizes the 1-row wide DuckDB conditional aggregation result into N bin rows,
 * validates against out-of-range observations, and constructs the siren.chart-data/1 snapshot.
 */
export function exactCount(value, name) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('COUNT_REPRESENTATION: ' + name);
    return value;
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error('COUNT_REPRESENTATION: ' + name);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('COUNT_PRECISION: ' + name);
  return n;
}

export function normalizeEngineBins(params) {
  const {
    wideRow,
    edges,
    measureColumn,
    unit = null,
    source,
    description = null,
    snapshotId: explicitSnapshotId = null,
    coverageMeta = {}
  } = params || {};

  validateBinEdges(edges);
  quoteIdentifier(measureColumn);

  if (!wideRow || typeof wideRow !== 'object' || Array.isArray(wideRow)) {
    throw new Error('INVALID_ENGINE_RESULT');
  }

  const expected = [
    'total_count',
    'non_null_count',
    'null_count',
    'out_of_range_count',
    'min_observed',
    'max_observed',
    ...edges.slice(1).map((_, i) => 'bin_' + i)
  ];

  if (Object.keys(wideRow).length !== expected.length || expected.some(k => !Object.hasOwn(wideRow, k))) {
    throw new Error('ENGINE_RESULT_SHAPE: wide row does not match expected histogram metric keys');
  }

  const total = exactCount(wideRow.total_count, 'total_count');
  const numeric = exactCount(wideRow.non_null_count, 'non_null_count');
  const nulls = exactCount(wideRow.null_count, 'null_count');
  const out = exactCount(wideRow.out_of_range_count, 'out_of_range_count');

  if (out > 0) {
    throw new Error(
      `OUT_OF_RANGE_REFUSED: ${out} numeric observations fall outside explicit bin edges [${edges[0]}, ${edges[edges.length - 1]}]. Minimum observed: ${wideRow.min_observed}, Maximum observed: ${wideRow.max_observed}. Charts requires complete bin coverage; no chart exported.`
    );
  }

  if (!Number.isSafeInteger(numeric + nulls) || numeric + nulls !== total) {
    throw new Error('MATHEMATICAL_RECONCILIATION_FAILED: numeric + NULL must equal total count');
  }

  let min = wideRow.min_observed;
  let max = wideRow.max_observed;
  const canonicalExtremum=v=>typeof v==='string'&&v.startsWith('.')?'0'+v:typeof v==='string'&&v.startsWith('-.')?'-0'+v.slice(1):v;min=canonicalExtremum(min);max=canonicalExtremum(max);

  if (numeric === 0) {
    if (min !== null || max !== null) throw new Error('EMPTY_EXTREMA_REQUIRED: min and max observed must be null when numeric count is 0');
  } else {
    for (const v of [min, max]) {
      if (
        !(
          (typeof v === 'string' && v.length <= 1024 && validExtremumString(v)) ||
          (typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)))
        )
      ) {
        throw new Error('EXTREMA_REPRESENTATION: min and max observed must be exact decimal strings or safe numbers');
      }
    }
    if (exactCompare(min, max) > 0 || exactCompare(min, edges[0]) < 0 || exactCompare(max, edges.at(-1)) > 0) {
      throw new Error('EXTREMA_RANGE_MISMATCH: observed min/max values violate edge boundaries or min > max');
    }
  }

  if (!(unit === null || (typeof unit === 'string' && unit.length > 0 && unit.length <= 128))) {
    throw new Error('UNIT_REPRESENTATION: unit must be null or string <= 128 chars');
  }

  if (!source || !['sourceId', 'jobId', 'resultVersion'].every(k => typeof source[k] === 'string' && source[k].length > 0 && source[k].length <= 1024)) {
    throw new Error('SOURCE_IDENTITY_REQUIRED: sourceId, jobId, and resultVersion are strictly required');
  }

  if (source.state !== undefined && !['unknown', 'current', 'outdated', 'missing'].includes(source.state)) {
    throw new Error('SOURCE_STATE: state must be one of unknown, current, outdated, missing');
  }

  const capturedAt = source.capturedAt;
  if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('CAPTURE_TIME_REQUIRED: capturedAt must be a valid ISO timestamp');
  }

  const rows = edges.slice(1).map((edge, i) => ({
    id: 'r' + (i + 1),
    values: {
      bin_start: edges[i],
      bin_end: edge,
      count: exactCount(wideRow['bin_' + i], 'bin_' + i)
    }
  }));

  const counted = rows.reduce((n, r) => n + r.values.count, 0);
  if (!Number.isSafeInteger(counted) || counted !== numeric) {
    throw new Error('MATHEMATICAL_RECONCILIATION_FAILED: sum of bin counts must equal numeric count');
  }

  const columns = [
    { id: 'bin_start', label: 'bin_start', type: 'decimal', role: 'dimension', unit, nullable: false },
    { id: 'bin_end', label: 'bin_end', type: 'decimal', role: 'dimension', unit, nullable: false },
    { id: 'count', label: 'count', type: 'number', role: 'measure', unit: 'count', nullable: false }
  ];

  const sourceSemantic = coverageMeta.sourceSemantic || 'direct-observation-distribution';
  const initialSourceRowCountRaw = coverageMeta.initialSourceRowCount !== undefined ? coverageMeta.initialSourceRowCount : total;
  const initialSourceRowCount = initialSourceRowCountRaw === null ? null : exactCount(initialSourceRowCountRaw, 'initialSourceRowCount');
  const filteredRowCountRaw = coverageMeta.filteredRowCount !== undefined ? coverageMeta.filteredRowCount : null;
  const filteredRowCount = filteredRowCountRaw === null ? null : exactCount(filteredRowCountRaw, 'filteredRowCount');
  const aggregateEntityCountRaw = coverageMeta.aggregateEntityCount !== undefined ? coverageMeta.aggregateEntityCount : null;
  const aggregateEntityCount = aggregateEntityCountRaw === null ? null : exactCount(aggregateEntityCountRaw, 'aggregateEntityCount');

  if(!['direct-observation-distribution','filtered-observation-distribution','joined-observation-distribution','aggregate-result-distribution','derived-result-row-distribution'].includes(sourceSemantic))throw Error('SOURCE_SEMANTIC');
  for(const [key,value] of Object.entries({initialSourceRowCount,filteredRowCount,aggregateEntityCount}))if(value!==null)exactCount(value,key);
  if(sourceSemantic==='aggregate-result-distribution'&&aggregateEntityCount!==total)throw Error('AGGREGATE_ENTITY_COUNT_MISMATCH');
  if(sourceSemantic!=='aggregate-result-distribution'&&aggregateEntityCount!==null)throw Error('AGGREGATE_ENTITY_COUNT_UNBOUND');
  const defaultDesc = sourceSemantic === 'derived-result-row-distribution'
    ? `Distribution of '${measureColumn}' across ${total} selected output rows of a graph containing aggregate and JOIN stages. Rows are unweighted; measure/entity grain is not inferred.`
    : sourceSemantic === 'aggregate-result-distribution'
    ? `Distribution of aggregated '${measureColumn}' across ${total} aggregated groups/entities (selected node '${source.sourceId}', aggregate-grain output rows). No implicit weighting applied. 1 wide engine row normalized to ${rows.length} bin rows.`
    : sourceSemantic === 'filtered-observation-distribution'
    ? `Exact DuckDB histogram of '${measureColumn}' over filtered subset (${total} observations retained from ${initialSourceRowCount} initial source rows). 1 wide engine row normalized to ${rows.length} bin rows.`
    : `Exact DuckDB histogram of '${measureColumn}': ${total} observation rows, 1 wide aggregate row normalized into ${rows.length} bin rows. NULL separate, all bins retained.`;

  const desc = description ?? defaultDesc;
  if (typeof desc !== 'string' || !desc || desc.length > 1024) {
    throw new Error('AGGREGATION_DESCRIPTION: aggregation description is required and <= 1024 chars');
  }

  const identity = {
    columns,
    rows,
    measureColumn,
    coverage: {
      total,
      numeric,
      nulls,
      out,
      min,
      max,
      sourceSemantic,
      initialSourceRowCount,
      filteredRowCount,
      aggregateEntityCount,
      description: desc
    },
    source: {
      sourceId: source.sourceId,
      jobId: source.jobId,
      resultVersion: source.resultVersion,
      state: source.state ?? 'unknown',
      capturedAt
    }
  };

  const snapshotId = explicitSnapshotId || 'hist_' + sha(identity);
  if (typeof snapshotId !== 'string' || !snapshotId || snapshotId.length > 1024) {
    throw new Error('SNAPSHOT_ID: snapshotId must be a valid string');
  }

  return freeze({
    schemaVersion: 'siren.chart-data/1',
    snapshotId,
    columns,
    rows,
    source: {
      sourceId: source.sourceId,
      jobId: source.jobId,
      resultVersion: source.resultVersion,
      state: source.state ?? 'unknown',
      capturedAt
    },
    coverage: {
      kind: 'aggregate',
      sourceRowCount: total,
      resultRowCount: rows.length,
      transferredRows: rows.length,
      aggregation: {
        kind: 'histogram',
        description: desc,
        binStartColumn: 'bin_start',
        binEndColumn: 'bin_end',
        countColumn: 'count',
        unit,
        numericCount: numeric,
        nullCount: nulls,
        totalCount: total,
        outOfRangeCount: out,
        minObserved: min,
        maxObserved: max,
        measureColumn,
        closure: '[left, right), final bin [left, right]',
        sourceSemantic,
        populationBasis: 'selected-node-output-rows',
        initialSourceRowCountMeaning: 'sum-of-root-input-rows-not-a-joined-population',
        initialSourceRowCount,
        filteredRowCount,
        aggregateEntityCount,
        engineResultRowCount: 1,
        normalizedBinRowsCount: rows.length
      },
      selection: null
    }
  });
}

/**
 * Traces the lineage of a node back to its root input sources in the DAG.
 */
export function extractSourceLineage(pipelineDef, sourceNodeId, nodeOutputs = {}) {
  const nodes = pipelineDef?.nodes || [];
  const edges = pipelineDef?.edges || [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  if (!nodeMap.has(sourceNodeId)) {
    throw new Error(`LINEAGE_ERROR: Source node "${sourceNodeId}" not found in pipeline DAG.`);
  }

  const visited = new Set();
  const lineageNodes = [];
  const rootInputs = [];

  function traverse(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) throw Error('LINEAGE_NODE_MISSING');

    lineageNodes.push(node);

    const incoming = edges.filter(e => e.target === nodeId);
    if(!['input','filter','select','join','aggregate','pivot'].includes(node.type))throw Error('LINEAGE_GRAIN_UNSUPPORTED');
    const expectedInputs=node.type==='input'?0:node.type==='join'?2:1;
    if(incoming.length!==expectedInputs)throw Error('LINEAGE_INPUT_CARDINALITY');

    if(node.type==='join'){
      if(incoming.length!==2)throw Error('JOIN_LINEAGE_BINDING: exactly two declared input edges required');
      let left=null,right=null;
      for(const e of incoming){if(e.targetHandle==='left')left=e.source;else if(e.targetHandle==='right')right=e.source}
      if(!left&&node.data?.leftSourceNodeId)left=node.data.leftSourceNodeId;
      if(!right&&node.data?.rightSourceNodeId)right=node.data.rightSourceNodeId;
      if(!left||!right){left=incoming[0].source;right=incoming[1].source}
      if(JSON.stringify([left,right].sort())!==JSON.stringify(incoming.map(e=>e.source).sort()))throw Error('JOIN_LINEAGE_BINDING: compiler inputs differ from declared ancestry');
    }

    if (incoming.length === 0 && node.type === 'input') {
      rootInputs.push(node);
    } else {
      for (const e of incoming) {
        traverse(e.source);
      }
    }
  }

  traverse(sourceNodeId);

  // Counts belong to their own graph stage, not to the final upstream node.
  if(!rootInputs.length)throw Error('LINEAGE_ROOT_REQUIRED');
  const countAt=id=>{const n=nodeOutputs[id]?.rowCount;if(!Number.isSafeInteger(n)||n<0)throw Error('SOURCE_ROOT_COUNTS_REQUIRED: '+id);return n};
  let initialSourceRowCount=0;for(const n of rootInputs){initialSourceRowCount+=countAt(n.id);if(!Number.isSafeInteger(initialSourceRowCount))throw Error('SOURCE_COUNT_PRECISION')}
  const sourceNode=nodeMap.get(sourceNodeId),upstreamType=sourceNode.type;
  const hasFilter=lineageNodes.some(n=>n.type==='filter'),hasJoin=lineageNodes.some(n=>n.type==='join');
  const stageCounts=lineageNodes.map(n=>({nodeId:n.id,nodeType:n.type,rowCount:countAt(n.id)}));
  const filteredNodeCounts=stageCounts.filter(n=>n.nodeType==='filter');
  const filteredRowCount=filteredNodeCounts.length===1?filteredNodeCounts[0].rowCount:null;
  const visiting=new Set();
  function grain(id){
    if(visiting.has(id))throw Error('LINEAGE_CYCLE');visiting.add(id);
    const n=nodeMap.get(id);if(!n)throw Error('LINEAGE_NODE_MISSING');
    const parents=edges.filter(e=>e.target===id).map(e=>e.source);let result;
    if(n.type==='aggregate'||n.type==='pivot')result='aggregate';
    else if(n.type==='input'&&parents.length===0)result='raw';
    else if(n.type==='join'){const kinds=parents.map(grain);result=kinds.some(k=>k==='aggregate'||k==='derived')?'derived':'joined'}
    else if(['filter','select'].includes(n.type)&&parents.length===1)result=grain(parents[0]);
    else throw Error('LINEAGE_GRAIN_UNSUPPORTED');
    visiting.delete(id);return result;
  }
  const rowGrain=grain(sourceNodeId),isPreAggregated=rowGrain==='aggregate';
  const sourceSemantic=isPreAggregated?'aggregate-result-distribution':rowGrain==='derived'?'derived-result-row-distribution':rowGrain==='joined'?'joined-observation-distribution':hasFilter?'filtered-observation-distribution':'direct-observation-distribution';

  return {
    sourceNodeId,
    upstreamType,
    rowGrain, stageCounts, filteredNodeCounts, filteredRowCount,
    lineageNodes: lineageNodes.map(n => ({ id: n.id, type: n.type })),
    rootInputs: rootInputs.map(n => ({
      id: n.id,
      type: n.type,
      path: n.data?.path,
      format: n.data?.format,
      rowCount: nodeOutputs[n.id]?.rowCount ?? null
    })),
    initialSourceRowCount,
    sourceSemantic,
    isPreAggregated,
    hasFilter,
    hasJoin
  };
}

/**
 * Seals and admits a trusted completed RunnerService histogram job.
 * Extends admission to filtered, joined, projected, and pre-aggregated nodes with full provenance.
 * Strictly refuses sampled, truncated, preview-only, and outdated outputs.
 *
 * @param {Object} params
 *   - job: RunnerService job object
 *   - sourceNodeId: string (id of the upstream node whose output is binned)
 *   - histNodeId: string (id of the histogram aggregate node)
 *   - measureColumn: string
 *   - edges: Array<string>
 *   - unit?: string|null
 * @returns {Object} Validated, frozen siren.chart-data/1 snapshot with full provenance
 */
export function sealHistogramJob({ job, sourceNodeId, histNodeId, measureColumn, edges, unit = null }) {
  if (job?.status !== 'completed' || typeof job.jobId !== 'string' || !Number.isFinite(Date.parse(job.completedAt))) {
    throw new Error('COMPLETED_JOB_REQUIRED: sealHistogramJob requires a successfully completed engine job');
  }

  const nodes = job.pipelineDef?.nodes || [];
  const sourceNode = nodes.find(n => n.id === sourceNodeId);
  const histNode = nodes.find(n => n.id === histNodeId);
  const upstream = job.nodeOutputs?.[sourceNodeId];
  const output = job.nodeOutputs?.[histNodeId];

  if (!sourceNode) {
    throw new Error(`SOURCE_NODE_NOT_FOUND: Node "${sourceNodeId}" was not found in pipeline definition`);
  }
  if (!histNode) {
    throw new Error(`HISTOGRAM_NODE_NOT_FOUND: Node "${histNodeId}" was not found in pipeline definition`);
  }

  // 1. Strict Output Validation: Refuse outdated results
  if (output?.isOutdated !== false || upstream?.isOutdated !== false) {
    throw new Error('OUTDATED_RESULT_REFUSED: Node outputs are outdated; execute pipeline again before producing histogram');
  }

  // 2. Strict Output Validation: Refuse sampled, truncated, or partial preview outputs
  if (upstream?.isSampled === true || output?.isSampled === true) {
    throw new Error('SAMPLED_POPULATION_REFUSED: Sampled results cannot be presented as full population histogram');
  }
  if (upstream?.isTruncated === true || output?.isTruncated === true) {
    throw new Error('TRUNCATED_POPULATION_REFUSED: Truncated results cannot be presented as full population histogram');
  }
  if (upstream?.isPartial === true || output?.isPartial === true) {
    throw new Error('PREVIEW_ONLY_REFUSED: Partial preview output cannot represent full population histogram');
  }

  // 3. Schema & Column Validation
  const col = validateMeasureColumnSchema(upstream?.schema, measureColumn);

  // 4. DAG Connection & Aggregate Node Definition
  const incoming = job.pipelineDef.edges.filter(e => e.target === histNodeId);
  if (
    histNode?.type !== 'aggregate' ||
    incoming.length !== 1 ||
    incoming[0].source !== sourceNodeId ||
    JSON.stringify(histNode.data?.groupBy) !== '[]' ||
    canonical(histNode.data?.aggregations) !== canonical(buildHistogramAggregationExprs(measureColumn, edges))
  ) {
    throw new Error('HISTOGRAM_DEFINITION_MISMATCH: Target node must be an aggregate node with empty groupBy connected to sourceNodeId');
  }

  // 5. Output shape validation
  if (output?.rowCount !== 1 || output?.preview?.length !== 1 || !Array.isArray(output.schema)) {
    throw new Error('HISTOGRAM_OUTPUT_REQUIRED: Histogram node must produce exactly 1 wide row');
  }

  const wide = output.preview[0];
  const schemaNames = output.schema.map(c => c.columnName ?? c.name);
  if (schemaNames.length !== Object.keys(wide).length || schemaNames.some(k => !Object.hasOwn(wide, k))) {
    throw new Error('WIDE_SCHEMA_MISMATCH: Wide preview columns do not match histogram output schema');
  }

  // 6. Source Count Reconciliation
  if (exactCount(wide.total_count, 'total_count') !== upstream.rowCount) {
    throw new Error(
      `SOURCE_COUNT_MISMATCH: Histogram total count (${wide.total_count}) does not match upstream node row count (${upstream.rowCount})`
    );
  }

  // 7. Extract Lineage and Semantic Classification
  const lineage = extractSourceLineage(job.pipelineDef, sourceNodeId, job.nodeOutputs);

  // A late stat/read cannot identify the bytes used by a historical job.
  // Physical execution receipts are not supplied by this RunnerService API.
  const datasetIdentity=lineage.rootInputs.map(inp=>({nodeId:inp.id,path:inp.path??null,format:inp.format??null,status:'NOT_CAPTURED_AT_EXECUTION',exists:null,fileSizeBytes:null,modifiedAt:null}));

  // 9. Construct Immutable Execution Revision
  const revision = {
    kind: 'completed-engine-job-output',
    jobId: job.jobId,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    pipelineDef: job.pipelineDef,
    generatedSQL: job.generatedSQL,
    sourceNodeId,
    histNodeId,
    schema: upstream.schema,
    rowCount: upstream.rowCount,
    wide
  };

  const resultVersion = 'engine-job-sha256:' + sha(JSON.parse(JSON.stringify(revision)));

  const coverageMeta = {
    sourceSemantic: lineage.sourceSemantic,
    initialSourceRowCount: lineage.initialSourceRowCount,
    filteredRowCount: lineage.filteredRowCount,
    aggregateEntityCount: lineage.isPreAggregated ? upstream.rowCount : null
  };

  // 10. Normalize into siren.chart-data/1
  const snapshot = normalizeEngineBins({
    wideRow: wide,
    edges,
    measureColumn,
    unit,
    source: {
      sourceId: sourceNodeId,
      jobId: job.jobId,
      resultVersion,
      state: 'unknown',
      capturedAt: job.completedAt
    },
    coverageMeta
  });

  // 11. Attach Provenance Origin and Physical Dataset Identity
  return freeze({
    ...snapshot,
    source: {
      ...snapshot.source,
      origin: {
        revisionKind: 'completed-engine-job-output',
        sourceNodeId,
        histNodeId,
        measureColumn,
        measureType: col.type,
        sourceSemantic: lineage.sourceSemantic,
        isPreAggregated: lineage.isPreAggregated,
        hasFilter: lineage.hasFilter,
        hasJoin: lineage.hasJoin,
        counts: {
          initialSourceRowCount: lineage.initialSourceRowCount,
          filteredRowCount: lineage.filteredRowCount,
          aggregateEntityCount: lineage.isPreAggregated ? upstream.rowCount : null,
          engineResultRowCount: 1,
          normalizedBinRowsCount: snapshot.rows.length
        },
        lineageNodes: lineage.lineageNodes,
        stageCounts: lineage.stageCounts,
        filteredNodeCounts: lineage.filteredNodeCounts,
        rowGrain: lineage.rowGrain,
        populationBasis: 'selected-node-output-rows',
        datasetIdentity,
        sourceSchema: JSON.parse(JSON.stringify(upstream.schema)),
        generatedSQL: JSON.parse(JSON.stringify(job.generatedSQL || [])),
        pipelineDef: JSON.parse(JSON.stringify(job.pipelineDef))
      }
    }
  });
}

/**
 * Creates a valid Charts chart definition for an engine-bins histogram snapshot.
 */
export function createHistogramDefinition(snapshot, title = 'Histogramă') {
  const edges = snapshot.rows.map(r => r.values.bin_start);
  edges.push(snapshot.rows[snapshot.rows.length - 1].values.bin_end);

  const unit = snapshot.coverage.aggregation.unit || '';

  return {
    schemaVersion: 'siren.chart/1',
    id: `chart-${snapshot.snapshotId}`,
    type: 'histogram',
    title,
    x: 'bin_start',
    y: ['count'],
    seriesBy: null,
    xLabel: 'Interval Observații',
    yLabel: 'Număr Observații',
    xUnitLabel: unit,
    yUnitLabel: 'count',
    legend: false,
    colors: ['#60a5fa'],
    decimals: 0,
    includeZero: true,
    histogramEdges: edges,
    appearance: 'dark'
  };
}
