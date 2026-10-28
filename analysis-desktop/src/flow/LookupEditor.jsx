import React from 'react';
import {compileExactLookup,EXACT_LOOKUP_VERSION} from '../../engine/conditional-functions.js';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
function actualColumns(value){
  if(!Array.isArray(value)||!value.length||Object.keys(value).length!==value.length)return null;
  const seen=new Set();
  for(const column of value){
    if(!plain(column)||typeof column.name!=='string'||!column.name||column.name.includes('\0')||typeof column.type!=='string'||!column.type.trim()||column.type.includes('\0'))return null;
    const key=column.name.replace(/[A-Z]/g,c=>c.toLowerCase());
    if(seen.has(key))return null;
    seen.add(key);
  }
  return value;
}
function sameColumns(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}}
function selectedColumn(value,columns){
  if(typeof value!=='string'||!/^column:(0|[1-9]\d*)$/.test(value))return null;
  const index=Number(value.slice(7));
  return Number.isSafeInteger(index)?columns[index]||null:null;
}
const freshModel=()=>({version:EXACT_LOOKUP_VERSION,leftKey:'',rightKey:'',valueColumn:'',alias:'',duplicates:'error',unmatched:'null'});

export function LookupEditor({node,schemas,onEdit,onRun,runBusy=false,pendingFields=0,Field}){
  const data=plain(node?.data)?node.data:{},model=data.lookupModel;
  const currentLeft=actualColumns(schemas?.left?.columns),currentRight=actualColumns(schemas?.right?.columns);
  const storedLeft=actualColumns(data.lookupSchemas?.left),storedRight=actualColumns(data.lookupSchemas?.right);
  const available=schemas?.status==='available'&&!!currentLeft&&!!currentRight&&schemas.token!=null;
  const left=(available?currentLeft:storedLeft)||[],right=(available?currentRight:storedRight)||[];
  const allowed=['version','leftKey','rightKey','valueColumn','alias','duplicates','unmatched','textMatch'];
  const known=plain(model)&&Object.keys(model).every(k=>allowed.includes(k))&&model.version===EXACT_LOOKUP_VERSION&&['leftKey','rightKey','valueColumn','alias'].every(k=>typeof model[k]==='string')&&model.duplicates==='error'&&model.unmatched==='null'&&(!Object.hasOwn(model,'textMatch')||typeof model.textMatch==='string');
  const canCommit=available&&!runBusy&&typeof onEdit==='function';
  const editable=canCommit&&pendingFields===0;
  // Field's blur retires its own draft before Root's live guard runs.
  const edit=next=>canCommit?onEdit(node?.id,next,schemas.token)===true:false;
  const change=next=>editable?edit(next):false;
  const run=()=>!runBusy&&pendingFields===0&&typeof onRun==='function'?onRun(node?.id):false;
  const choose=(field,columns,value)=>{
    const column=selectedColumn(value,columns);
    if(!column||!known)return false;
    const next={...model,[field]:column.name};
    if(field==='leftKey'){
      if(column.type.trim().toUpperCase()==='VARCHAR')next.textMatch='binary';
      else delete next.textMatch;
    }
    return change(next);
  };
  let error=null;
  try{compileExactLookup(model,data.lookupSchemas?.left,data.lookupSchemas?.right);}catch(e){error=typeof e?.message==='string'?e.message:'The saved lookup definition could not be validated.';}
  const reason=typeof schemas?.reason==='string'?schemas.reason:'';
  const sourceLabel=side=>typeof schemas?.[side]?.sourceId==='string'?schemas[side].sourceId:'unavailable';
  const choice=(field,label,columns)=>{
    const index=columns.findIndex(c=>c.name===model[field]);
    return <label className="flow-field">{label}<select aria-label={label} value={index<0?'':'column:'+index} disabled={pendingFields!==0} onChange={e=>choose(field,columns,e.target.value)}><option value="">{model[field]?'Saved column is unavailable — choose a column':'Choose a column'}</option>{columns.map((column,i)=><option key={'column:'+i} value={'column:'+i}>{column.name+' · '+column.type}</option>)}</select></label>;
  };
  return <section className="flow-lookup-editor" aria-label="Exact Lookup">
    <button type="button" disabled={runBusy||pendingFields!==0||typeof onRun!=='function'} onClick={run}>Run Lookup inputs</button>
    <p className="flow-help">Runs both input branches without executing this Lookup. Connect the left and right inputs to their labeled ports.</p>
    <p className="flow-help">{reason||(!available?'Run both input branches to capture their current columns before editing.':'Both column schemas belong to the captured input job.')}</p>
    {schemas?.status==='available'&&!available&&<p role="status">The captured column schemas or their owner are invalid. Run both inputs again before editing.</p>}
    <p className="flow-help">All left rows and columns are kept; row order is unspecified. An unmatched key adds a typed NULL. NULL keys do not match; empty text matches empty text.</p>
    <p className="flow-help">More than one right row for a key matched by the left input stops the job, even if the returned values are equal. Unrelated right duplicates do not stop it. No first or last row is chosen.</p>
    <p className="flow-help">Text keys use binary UTF8 equality: case-sensitive, without trimming or Unicode normalization. Other key types must match exactly. This is an exact Lookup with these explicit policies.</p>
    {!known?<>
      <p role="status">The saved Lookup structure or policy is invalid or uses an unsupported version. It is kept until you explicitly reset it.</p>
      <button type="button" disabled={!editable} onClick={()=>change(freshModel())}>Reset exact Lookup</button>
    </>:<>
      {available&&(!sameColumns(data.lookupSchemas?.left,currentLeft)||!sameColumns(data.lookupSchemas?.right,currentRight))&&<button type="button" disabled={!editable} onClick={()=>change(model)}>Use captured Lookup columns</button>}
      <fieldset disabled={!available||runBusy}><legend>Exact Lookup columns</legend>
        <p className="flow-help">Left input: {sourceLabel('left')} · Right input: {sourceLabel('right')}</p>
        {choice('leftKey','Lookup left key',left)}
        {choice('rightKey','Lookup right key',right)}
        {choice('valueColumn','Lookup returned value',right)}
        <Field label="Lookup output column name" value={model.alias} onCommit={alias=>edit({...model,alias})}/>
      </fieldset>
    </>}
    {error&&<p role="status" className="flow-criteria-error">Lookup needs attention: {error}</p>}
    <p className="flow-help">Choosing columns or an output name does not run or save the workflow. No key cast is added. Source files can change outside this app.</p>
  </section>;
}
