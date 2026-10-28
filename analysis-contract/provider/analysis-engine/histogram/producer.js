/**
 * SIREN Analysis Exact Histogram Producer for Charts
 *
 * Produces siren.chart-data/1 in "engine-bins" mode using exact DuckDB SQL aggregations.
 *
 * Enforces:
 *   - Explicit numeric column identification; refuses implicit VARCHAR conversion
 *   - Interval closure: [left, right), final bin [left, right]
 *   - Zero-observation bin preservation (never omitted)
 *   - Rejection of out-of-range observations (admission gate blocked with diagnostic)
 *   - Exact reconciliation: sum(counts) === numericCount, numericCount + nullCount === totalCount
 *   - Explicit documentation of 1-row wide DuckDB result normalized into N bin rows
 *   - Direct validation with Charts app/core.js validator and project()
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const DECIMAL_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
// Extrema are metadata, not chart coordinates. Widened floating values may use
// scientific notation; bound the exponent to the actual DOUBLE domain.
function validExtremumString(v){if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(v))return false;const m=/e([+-]?\d+)$/i.exec(v);if(m&&Math.abs(Number(m[1]))>324)return false;const n=Number(v);return Number.isFinite(n)&&!(n===0&&/[1-9]/.test(v.split(/[eE]/)[0]))}


const NUMERIC_DUCKDB_TYPE_REGEX = /^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i;
function quoteIdentifier(name) {
  if(typeof name!=='string'||!name||name.length>128||name.includes('\0'))throw Error('INVALID_IDENTIFIER');
  return '"'+name.replaceAll('"','""')+'"';
}
const canonical=v=>v===null?'null':Array.isArray(v)?'['+v.map(canonical).join(',')+']':typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}

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
 * Validates histogram bin edges according to Charts contract.
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
    if (typeof e !== 'string' || e.length>1024 || !DECIMAL_REGEX.test(e)) {
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
    const n=Number(e);
    if(!Number.isFinite(n)||(n===0&&/[1-9]/.test(e))||(Number.isInteger(n)&&!Number.isSafeInteger(n)))throw Error('UNSAFE_COORDINATE: edge is not safely representable by Charts');
    const fraction=e.split('.')[1]||'',integer=e.replace('-','').split('.')[0].replace(/^0+/, '');
    if(fraction.length>38||integer.length+fraction.length>38)throw Error('SQL_EDGE_PRECISION: exact DuckDB decimal literal exceeds width/scale38');

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
 * Generates exact DuckDB SQL for calculating histogram bins using conditional aggregation.
 *
 * @param {Object} params
 *   - sourceTableOrView: string
 *   - measureColumn: string
 *   - edges: Array<string>
 *   - whereClause?: string
 * @returns {string} Generated SQL statement
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
 *
 * @param {Object} params
 *   - wideRow: Object (The single row object returned from DuckDB query)
 *   - edges: Array<string> (Validated bin edges)
 *   - measureColumn: string
 *   - unit: string|null (Observation unit, e.g. 'RON', 'EUR', or null)
 *   - source: Object ({ sourceId, jobId, resultVersion?, state? })
 *   - description?: string
 *   - snapshotId?: string
 * @returns {Object} siren.chart-data/1 snapshot in "engine-bins" mode
 */
function exactCount(value,name) {
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw Error('COUNT_REPRESENTATION: '+name);return value}
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)$/.test(value))throw Error('COUNT_REPRESENTATION: '+name);
  const n=Number(value);if(!Number.isSafeInteger(n))throw Error('COUNT_PRECISION: '+name);return n;
}
export function normalizeEngineBins(params) {
  const {wideRow,edges,measureColumn,unit=null,source,description=null,snapshotId:explicitSnapshotId=null}=params||{};
  validateBinEdges(edges);quoteIdentifier(measureColumn);
  if(!wideRow||typeof wideRow!=='object'||Array.isArray(wideRow))throw Error('INVALID_ENGINE_RESULT');
  const expected=['total_count','non_null_count','null_count','out_of_range_count','min_observed','max_observed',...edges.slice(1).map((_,i)=>'bin_'+i)];
  if(Object.keys(wideRow).length!==expected.length||expected.some(k=>!Object.hasOwn(wideRow,k)))throw Error('ENGINE_RESULT_SHAPE');
  const total=exactCount(wideRow.total_count,'total_count'),numeric=exactCount(wideRow.non_null_count,'non_null_count'),nulls=exactCount(wideRow.null_count,'null_count'),out=exactCount(wideRow.out_of_range_count,'out_of_range_count');
  if(out>0)throw Error('OUT_OF_RANGE_REFUSED: '+out+' numeric observations outside explicit edges');
  if(!Number.isSafeInteger(numeric+nulls)||numeric+nulls!==total)throw Error('MATHEMATICAL_RECONCILIATION_FAILED: numeric+NULL total');
  let min=wideRow.min_observed,max=wideRow.max_observed;
  const canonicalExtremum=v=>typeof v==='string'&&v.startsWith('.')?'0'+v:typeof v==='string'&&v.startsWith('-.')?'-0'+v.slice(1):v;min=canonicalExtremum(min);max=canonicalExtremum(max);
  if(numeric===0){if(min!==null||max!==null)throw Error('EMPTY_EXTREMA_REQUIRED')}
  else{
    for(const v of [min,max])if(!((typeof v==='string'&&v.length<=1024&&validExtremumString(v))||(typeof v==='number'&&Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v)))))throw Error('EXTREMA_REPRESENTATION');
    if(exactCompare(min,max)>0||exactCompare(min,edges[0])<0||exactCompare(max,edges.at(-1))>0)throw Error('EXTREMA_RANGE_MISMATCH');
  }
  if(!(unit===null||(typeof unit==='string'&&unit.length>0&&unit.length<=128)))throw Error('UNIT_REPRESENTATION');
  if(!source||!['sourceId','jobId','resultVersion'].every(k=>typeof source[k]==='string'&&source[k].length>0&&source[k].length<=1024))throw Error('SOURCE_IDENTITY_REQUIRED');
  if(source.state!==undefined&&!['unknown','current','outdated','missing'].includes(source.state))throw Error('SOURCE_STATE');
  const capturedAt=source.capturedAt;if(typeof capturedAt!=='string'||!Number.isFinite(Date.parse(capturedAt)))throw Error('CAPTURE_TIME_REQUIRED');
  const rows=edges.slice(1).map((edge,i)=>({id:'r'+(i+1),values:{bin_start:edges[i],bin_end:edge,count:exactCount(wideRow['bin_'+i],'bin_'+i)}}));
  const counted=rows.reduce((n,r)=>n+r.values.count,0);if(!Number.isSafeInteger(counted)||counted!==numeric)throw Error('MATHEMATICAL_RECONCILIATION_FAILED: bin sum');
  const columns=[{id:'bin_start',label:'bin_start',type:'decimal',role:'dimension',unit,nullable:false},{id:'bin_end',label:'bin_end',type:'decimal',role:'dimension',unit,nullable:false},{id:'count',label:'count',type:'number',role:'measure',unit:'count',nullable:false}];
  const identity={columns,rows,measureColumn,coverage:{total,numeric,nulls,out,min,max,description},source:{sourceId:source.sourceId,jobId:source.jobId,resultVersion:source.resultVersion,state:source.state??'unknown',capturedAt}};
  const snapshotId=explicitSnapshotId||'hist_'+sha(identity);if(typeof snapshotId!=='string'||!snapshotId||snapshotId.length>1024)throw Error('SNAPSHOT_ID');
  const desc=description??`Exact DuckDB histogram of '${measureColumn}': ${total} observation rows, 1 wide aggregate row normalized into ${rows.length} bin rows. NULL separate, all bins retained.`;
  if(typeof desc!=='string'||!desc||desc.length>1024)throw Error('AGGREGATION_DESCRIPTION');
  return freeze({schemaVersion:'siren.chart-data/1',snapshotId,columns,rows,source:{sourceId:source.sourceId,jobId:source.jobId,resultVersion:source.resultVersion,state:source.state??'unknown',capturedAt},coverage:{kind:'aggregate',sourceRowCount:total,resultRowCount:rows.length,transferredRows:rows.length,aggregation:{kind:'histogram',description:desc,binStartColumn:'bin_start',binEndColumn:'bin_end',countColumn:'count',unit,numericCount:numeric,nullCount:nulls,totalCount:total,outOfRangeCount:out,minObserved:min,maxObserved:max,measureColumn,closure:'[left, right), final bin [left, right]',engineResultRowCount:1,normalizedBinRowsCount:rows.length},selection:null}});
}

// Admission boundary for a trusted completed RunnerService job. It binds the
// selected real upstream schema, compiler definition, wide result and execution
// identity. It does not authenticate an arbitrary externally fabricated object.
export function sealHistogramJob({job,sourceNodeId,histNodeId,measureColumn,edges,unit=null}) {
  if(job?.status!=='completed'||typeof job.jobId!=='string'||!Number.isFinite(Date.parse(job.completedAt)))throw Error('COMPLETED_JOB_REQUIRED');
  const sourceNode=job.pipelineDef?.nodes?.find(n=>n.id===sourceNodeId),histNode=job.pipelineDef?.nodes?.find(n=>n.id===histNodeId),upstream=job.nodeOutputs?.[sourceNodeId],output=job.nodeOutputs?.[histNodeId];
  if(sourceNode?.type!=='input')throw Error('SOURCE_SCOPE: this producer admits a direct input histogram; filtered/aggregate sources require an explicit extended receipt');
  const col=validateMeasureColumnSchema(upstream?.schema,measureColumn);
  const incoming=job.pipelineDef.edges.filter(e=>e.target===histNodeId);
  if(histNode?.type!=='aggregate'||incoming.length!==1||incoming[0].source!==sourceNodeId||JSON.stringify(histNode.data?.groupBy)!=='[]'||canonical(histNode.data?.aggregations)!==canonical(buildHistogramAggregationExprs(measureColumn,edges)))throw Error('HISTOGRAM_DEFINITION_MISMATCH');
  if(output?.isOutdated!==false||upstream?.isOutdated!==false||output?.rowCount!==1||output?.preview?.length!==1||!Array.isArray(output.schema))throw Error('HISTOGRAM_OUTPUT_REQUIRED');
  const wide=output.preview[0],schemaNames=output.schema.map(c=>c.columnName??c.name);
  if(schemaNames.length!==Object.keys(wide).length||schemaNames.some(k=>!Object.hasOwn(wide,k)))throw Error('WIDE_SCHEMA_MISMATCH');
  if(exactCount(wide.total_count,'total_count')!==upstream.rowCount)throw Error('SOURCE_COUNT_MISMATCH');
  const revision={kind:'completed-engine-job-output',jobId:job.jobId,createdAt:job.createdAt,completedAt:job.completedAt,pipelineDef:job.pipelineDef,generatedSQL:job.generatedSQL,sourceNodeId,histNodeId,schema:upstream.schema,rowCount:upstream.rowCount,wide};
  // Existing IPC omits optional undefined DSL metadata; rows themselves have
  // strict shape/representation validation in normalizeEngineBins.
  const resultVersion='engine-job-sha256:'+sha(JSON.parse(JSON.stringify(revision)));
  const snapshot=normalizeEngineBins({wideRow:wide,edges,measureColumn,unit,source:{sourceId:sourceNodeId,jobId:job.jobId,resultVersion,state:'unknown',capturedAt:job.completedAt}});
  return freeze({...snapshot,source:{...snapshot.source,origin:{revisionKind:'completed-engine-job-output',sourceNodeId,histNodeId,measureColumn,measureType:col.type,sourceSchema:JSON.parse(JSON.stringify(upstream.schema)),generatedSQL:JSON.parse(JSON.stringify(job.generatedSQL)),pipelineDef:JSON.parse(JSON.stringify(job.pipelineDef))}}});
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
