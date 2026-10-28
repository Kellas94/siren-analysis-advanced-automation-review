import path from 'node:path';
import {definitionIdentity} from '../registry/bridge.js';
import {computeSha256} from '../registry/src/result_envelope.js';
import {PipelineCompiler} from '../engine/pipeline_compiler.js';
import {extractSourceLineage,validateMeasureColumnSchema} from './workflow_producer.js';
const transient=new Set(['status','preview','rowCount','isOutdated','label']);
const allowedFunctions=new Set(['COUNT','SUM','AVG','MIN','MAX','ROUND','COALESCE','NULLIF','ABS','CAST','TRY_CAST','DECIMAL','NUMERIC','VARCHAR','LENGTH','LOWER','UPPER','TRIM','FLOOR','CEIL','CEILING']);
const forbidden=new Set('SELECT FROM COPY TO ATTACH DETACH LOAD INSTALL CALL CREATE DROP ALTER DELETE UPDATE INSERT EXPORT IMPORT PRAGMA SET USE EXECUTE PREPARE TRUNCATE VACUUM WITH INTO UNION INTERSECT EXCEPT PIVOT UNPIVOT'.split(' '));
// This new rerun route accepts a bounded expression subset, never arbitrary SQL statements.
export function validateRerunExpression(expression){
 if(typeof expression!=='string'||!expression.trim()||expression.length>8192)throw Error('WORKFLOW_HISTOGRAM_EXPRESSION');
 const tokens=[];let i=0;
 while(i<expression.length){const c=expression[i];if(/\s/.test(c)){i++;continue;}
  if(c==="'"||c==='"'){const quote=c;let value='',closed=false;i++;while(i<expression.length){if(expression[i]===quote){if(expression[i+1]===quote){value+=quote;i+=2;}else{i++;closed=true;break;}}else value+=expression[i++];}if(!closed)throw Error('WORKFLOW_HISTOGRAM_EXPRESSION');tokens.push({type:quote==="'"?'literal':'identifier',value});continue;}
  if(c===';'||expression.startsWith('--',i)||expression.startsWith('/*',i))throw Error('WORKFLOW_HISTOGRAM_STATEMENT_REFUSED');
  const word=/^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(i));if(word){tokens.push({type:'word',value:word[0]});i+=word[0].length;continue;}
  const number=/^\d+(?:\.\d+)?/.exec(expression.slice(i));if(number){tokens.push({type:'literal',value:number[0]});i+=number[0].length;continue;}
  if('()+-*/%<>=!|&,'.includes(c)){tokens.push({type:'symbol',value:c});i++;continue;}
  throw Error('WORKFLOW_HISTOGRAM_EXPRESSION');
 }
 for(let k=0;k<tokens.length;k++){const t=tokens[k],upper=t.value.toUpperCase();if(t.type==='word'&&forbidden.has(upper))throw Error('WORKFLOW_HISTOGRAM_STATEMENT_REFUSED');if(['word','identifier'].includes(t.type)&&tokens[k+1]?.value==='('&&!allowedFunctions.has(upper)&&!['IN','NOT'].includes(upper))throw Error('WORKFLOW_HISTOGRAM_FUNCTION_REFUSED');}
 return true;
}
function selected(job,nodeId){
 if(!job||job.status!=='completed'||typeof job.jobId!=='string'||!Number.isFinite(Date.parse(job.completedAt)))throw Error('WORKFLOW_COMPLETED_JOB_REQUIRED');
 const original=job.pipelineDef;if(!original||!Array.isArray(original.nodes)||!Array.isArray(original.edges))throw Error('WORKFLOW_DEFINITION_REQUIRED');
 const ids=new Set(),views=new Set();for(const n of original.nodes){if(typeof n.id!=='string'||!n.id||ids.has(n.id))throw Error('WORKFLOW_NODE_ID');ids.add(n.id);const view=n.id.replace(/[^a-zA-Z0-9_]/g,'_');if(views.has(view))throw Error('WORKFLOW_VIEW_COLLISION');views.add(view);}
 const lineage=extractSourceLineage(original,nodeId,job.nodeOutputs),keep=new Set(lineage.lineageNodes.map(n=>n.id));
 const pipelineDef=JSON.parse(JSON.stringify({nodes:original.nodes.filter(n=>keep.has(n.id)).map(n=>({id:n.id,type:n.type,data:Object.fromEntries(Object.entries(n.data||{}).filter(([k])=>!transient.has(k)))})),edges:original.edges.filter(e=>keep.has(e.target)).map(e=>({source:e.source,target:e.target,targetHandle:e.targetHandle??null}))}));
 const inputBindings=[];
 for(const n of pipelineDef.nodes){if(job.nodeOutputs[n.id]?.isOutdated)throw Error('WORKFLOW_OUTDATED');const d=n.data;
  if(n.type==='filter')validateRerunExpression(d.condition||'TRUE');
  if(n.type==='aggregate'){if(!Array.isArray(d.aggregations))throw Error('WORKFLOW_HISTOGRAM_AGGREGATIONS');for(const a of d.aggregations)validateRerunExpression(a.expr);}
  if(n.type==='select'){for(const c of d.columns||[])if(c.castType&&!/^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC|VARCHAR|BOOLEAN|DATE|TIMESTAMP)(?:\(\d+(?:,\s*\d+)?\))?$/i.test(c.castType))throw Error('WORKFLOW_HISTOGRAM_CAST');}
  if(n.type==='join'&&!['INNER','LEFT','RIGHT','FULL','LEFT OUTER','RIGHT OUTER','FULL OUTER','SEMI','ANTI'].includes((d.joinType||'INNER').toUpperCase()))throw Error('WORKFLOW_HISTOGRAM_JOIN');
  if(n.type==='pivot'){if(!['SUM','COUNT','AVG','MIN','MAX'].includes((d.agg||'SUM').toUpperCase()))throw Error('WORKFLOW_HISTOGRAM_PIVOT');if(d.filterCondition)validateRerunExpression(d.filterCondition);}
  if(n.type==='input'){
   if(Object.hasOwn(d,'retainedResult')||typeof d.path!=='string')throw Error('WORKFLOW_HISTOGRAM_FILE_INPUT_REQUIRED');
   const steps=job.generatedSQL?.filter(s=>s.nodeId===n.id&&s.nodeType==='input');if(steps?.length!==1)throw Error('WORKFLOW_INPUT_SQL_REQUIRED');
   const match=/\bFROM read_(parquet|csv)\('((?:''|[^'])*)'/.exec(steps[0].sql);if(!match)throw Error('WORKFLOW_INPUT_SQL_BINDING');
   const bound=match[2].replaceAll("''","'");if(!path.isAbsolute(bound)||bound.includes('\0'))throw Error('WORKFLOW_INPUT_ABSOLUTE_PATH_REQUIRED');
   inputBindings.push({nodeId:n.id,originalPath:d.path,executionPath:bound,format:match[1]});d.path=bound;
  }
 }
 const compiled=new PipelineCompiler(pipelineDef).compileToSQL();for(const b of inputBindings){const actual=compiled.find(s=>s.nodeId===b.nodeId),old=job.generatedSQL.find(s=>s.nodeId===b.nodeId);if(actual.sql!==old.sql)throw Error('WORKFLOW_INPUT_SQL_BINDING');}
 const schema=job.nodeOutputs[nodeId]?.schema;if(!Array.isArray(schema)||!schema.length)throw Error('WORKFLOW_SCHEMA_REQUIRED');
 const names=schema.map(c=>c.name??c.columnName);if(names.some(n=>typeof n!=='string'||!n)||new Set(names).size!==names.length)throw Error('WORKFLOW_SCHEMA_AMBIGUOUS');
 const measures=[];for(const name of names){try{measures.push(validateMeasureColumnSchema(schema,name))}catch{}}
 const descriptor={jobId:job.jobId,nodeId,completedAt:job.completedAt,definitionSha256:definitionIdentity(original),priorRowCount:job.nodeOutputs[nodeId].rowCount,sourceSchema:schema,measures,sourceSemantic:lineage.sourceSemantic,physicalIdentity:'NOT_CAPTURED_AT_EXECUTION',inputBindings};
 descriptor.selectionSha256=computeSha256(descriptor);return {descriptor,pipelineDef};
}
export function describeWorkflowSelection(job,nodeId){return selected(job,nodeId).descriptor;}
export function inspectWorkflowSelection(job,nodeId){return selected(job,nodeId);}
export function prepareWorkflowSelection(job,request){const s=selected(job,request.nodeId);if(s.descriptor.selectionSha256!==request.expectedSelectionSha256)throw Error('WORKFLOW_SELECTION_CHANGED');const column=validateMeasureColumnSchema(s.descriptor.sourceSchema,request.measure);return {...s,column};}
