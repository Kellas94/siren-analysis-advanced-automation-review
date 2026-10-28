import path from 'node:path';
import crypto from 'node:crypto';
import {inspectWorkflowSelection,prepareWorkflowSelection} from './selection.js';
import {PipelineCompiler,escapeSqlString} from '../engine/pipeline_compiler.js';
import {computeSha256} from '../registry/src/result_envelope.js';

// Bind the reader actually represented by the completed PipelineCompiler SQL.
// Explicitly binds CSV reader options including explicit string nullStr policy.
export function bind(selection){
 const {descriptor:d,pipelineDef:def}=selection;
 if(def.nodes.length!==1||def.edges.length||def.nodes[0].id!==d.nodeId||def.nodes[0].type!=='input'||d.inputBindings.length!==1||d.inputBindings[0].nodeId!==d.nodeId)throw Error('JOURNAL_DIRECT_INPUT_REQUIRED');
 const b=d.inputBindings[0],data=def.nodes[0].data,format=b.format,ext=path.extname(b.executionPath).toLowerCase();
 let options;
 let nullPolicyKind;
 let nullPolicy;

 if(format==='parquet'&&ext==='.parquet'){
  options={};
  nullPolicyKind='native-parquet';
  nullPolicy='native-parquet-types';
 }else if(format==='csv'&&ext==='.csv'){
  for(const key of ['readerOptions','csvOptions','nullstr','null','quote','escape','encoding','columns','types','ignoreErrors','allowQuotedNulls','forceNotNull','nullPadding'])if(Object.hasOwn(data,key)&&data[key]!==undefined)throw Error('JOURNAL_UNREPRESENTED_READER_OPTION:'+key);
  for(const key of ['header','allVarchar'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw Error('JOURNAL_CSV_OPTION_TYPE:'+key);
  if(data.delimiter!==undefined&&(typeof data.delimiter!=='string'||!data.delimiter))throw Error('JOURNAL_CSV_OPTION_TYPE:delimiter');

  if(data.nullStr!==undefined){
   if(typeof data.nullStr!=='string')throw Error('JOURNAL_CSV_OPTION_TYPE:nullStr');
   nullPolicyKind='explicit-string';
   nullPolicy='unquoted-nullstr-matches-null; quoted-values-are-not-null-tokens';
   options={header:data.header!==false,delimiter:data.delimiter||',',nullStr:data.nullStr,allVarchar:data.allVarchar!==false};
  }else{
   nullPolicyKind='legacy-absent';
   nullPolicy='unquoted-empty-matches-null; quoted-values-are-not-null-tokens';
   options={header:data.header!==false,delimiter:data.delimiter||',',nullStr:'',allVarchar:data.allVarchar!==false};
  }
 }else throw Error('JOURNAL_CANONICAL_CSV_OR_PARQUET_REQUIRED');

 // inspect/prepare already require this exact compiled input SQL to equal the
 // recorded execution. Recompile only its validated, path-bound definition.
 const steps=new PipelineCompiler(def).compileToSQL();
 if(steps.length!==1||steps[0].nodeType!=='input')throw Error('JOURNAL_INPUT_SQL_REQUIRED');
 const inputSql=steps[0].sql;
 const inputSqlDigest=crypto.createHash('sha256').update(inputSql,'utf8').digest('hex');

 // The validated selection and exact full recorded SQL bind the policy.
 // Searching raw SQL for parameter text would also match a path/token literal.

 // If caller supplied job with generatedSQL, verify recorded SQL matches recompiled SQL exactly
 if(selection.job?.generatedSQL){
  const rec=selection.job.generatedSQL.find(s=>s.nodeId===d.nodeId&&s.nodeType==='input');
  if(!rec||rec.sql!==inputSql)throw Error('JOURNAL_INPUT_SQL_BINDING: recorded SQL does not match compiled SQL');
 }

 const record={
  schemaVersion:'siren.completed-direct-reader/2',
  selectedJobId:d.jobId,
  nodeId:d.nodeId,
  selectionSha256:d.selectionSha256,
  definitionSha256:d.definitionSha256,
  format,
  executionPath:b.executionPath,
  originalPath:b.originalPath,
  options,
  nullPolicyKind,
  nullPolicy,
  allowQuotedNulls:format==='csv'?false:null,
  inputSql,
  inputSqlDigest
 };
 return {selection,reader:{...record,readerBindingSha256:computeSha256(record)}};
}

export function describeCompletedDirectReader(job,nodeId){
 const s=inspectWorkflowSelection(job,nodeId);
 s.job=job;
 return bind(s);
}

export function prepareCompletedDirectReader(job,request){
 const s=prepareWorkflowSelection(job,request);
 s.job=job;
 return bind(s);
}
