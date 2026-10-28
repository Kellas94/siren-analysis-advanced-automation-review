import {validateResultEnvelope} from '../registry/src/result_envelope.js';
import {validateMeasureColumnSchema} from './producer.js';
export function retainedMeasure(record,measure){
  validateResultEnvelope(record);
  if(record.counts.transferStatus!=='COMPLETE'||record.counts.resultRowCount!==record.data.rows.length||record.counts.capturedRows!==record.data.rows.length)throw Error('HISTOGRAM_COMPLETE_REQUIRED: histograma cere toate rândurile rezultatului păstrat.');
  return validateMeasureColumnSchema(record.schema,measure);
}
export function buildRetainedInputSQL(viewName,record,measure){
  const col=retainedMeasure(record,measure),quote=s=>'"'+s.replaceAll('"','""')+'"';
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(viewName))throw Error('INVALID_RETAINED_VIEW');
  // The sealed schema whitelist and cell validator have already rejected SQL
  // fragments, noncanonical DECIMALs, undefined values and lossy integer numbers.
  const table=quote(viewName),column=quote(col.name),type=col.type;
  const rows=record.data.rows.map(row=>{
    const value=row[measure];if(value===null)return '(NULL)';
    const raw=String(value).replaceAll("'","''"),cast=`CAST('${raw}' AS ${type})`;
    // Verify the exact native JSON numeric representation after the 32-bit cast,
    // rather than silently rounding an inconsistent retained FLOAT value.
    if(/^(FLOAT|REAL)$/.test(type))return `(CASE WHEN CAST(to_json(${cast}) AS DOUBLE) = CAST('${raw}' AS DOUBLE) THEN ${cast} ELSE error('RETAINED_FLOAT_ROUNDING') END)`;
    return '('+cast+')';
  });
  return `CREATE OR REPLACE TEMP TABLE ${table} (${column} ${type});`+(rows.length?`\nINSERT INTO ${table} VALUES ${rows.join(',')};`:'');
}
