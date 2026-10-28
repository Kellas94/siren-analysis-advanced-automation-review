import React from 'react';
import {compileConditionalSum,CONDITIONAL_SUM_VERSION} from '../../engine/conditional-functions.js';
import {FilterCriteriaEditor} from './FilterCriteriaEditor.jsx';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.hasOwn(value,key);
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
const freshModel=()=>({version:CONDITIONAL_SUM_VERSION,operation:'sumif',measure:'',criteria:{version:'analysis.criteria/1',op:'and',rules:[]}});

export function SumEditor({node,schema,onEdit,onRun,runBusy=false,pendingFields=0,Field}){
  const data=plain(node?.data)?node.data:{},model=data.sumModel;
  const captured=actualColumns(schema?.columns),stored=actualColumns(data.sumSchema);
  const available=schema?.status==='available'&&!!captured&&schema.token!=null;
  const columns=(available?captured:stored)||[];
  const known=plain(model)&&Object.keys(model).every(k=>['version','operation','measure','criteria'].includes(k))&&['version','operation','measure','criteria'].every(k=>own(model,k))&&model.version===CONDITIONAL_SUM_VERSION&&['sumif','sumifs'].includes(model.operation)&&typeof model.measure==='string';
  const canCommit=available&&!runBusy&&typeof onEdit==='function';
  const editable=canCommit&&pendingFields===0;
  // Field clears its draft before calling onCommit. Root checks the live draft
  // owner; a captured pendingFields value here would reject that same blur.
  const edit=next=>canCommit?onEdit(node?.id,next,schema.token)===true:false;
  const change=next=>editable?edit(next):false;
  const run=()=>!runBusy&&pendingFields===0&&typeof onRun==='function'?onRun(node?.id):false;
  let error=null;
  try{compileConditionalSum(model,data.sumSchema);}catch(e){error=typeof e?.message==='string'?e.message:'The saved sum definition could not be validated.';}
  const index=known?columns.findIndex(c=>c.name===model.measure):-1;
  const reason=typeof schema?.reason==='string'?schema.reason:'';
  const adaptedNode={id:node?.id,data:{criteria:known?model.criteria:undefined,criteriaSchema:data.sumSchema}};
  const adaptedSchema={status:available?'available':'unavailable',columns,token:schema?.token,reason};
  return <section className="flow-sum-editor" aria-label="Conditional sum">
    <p className="flow-help">SUMIF uses exactly one rule. SUMIFS combines one or more rules with AND. DuckDB calculates one sum over all matching rows.</p>
    <p className="flow-help">No matching non-NULL measure values returns NULL. Integer and DECIMAL results keep the actual engine type; floating measures are unsupported here.</p>
    {!available&&<p className="flow-help">{reason||'Run the input branch to capture its current columns before editing.'}</p>}
    {schema?.status==='available'&&!available&&<p role="status">The captured column schema or its owner is invalid. Run the input again before editing.</p>}
    {!known?<>
      <button type="button" disabled={runBusy||pendingFields!==0||typeof onRun!=='function'} onClick={run}>Run Sum input</button>
      <p role="status">The saved sum structure is invalid or uses an unsupported version. It is kept until you explicitly reset it.</p>
      <button type="button" disabled={!editable} onClick={()=>change(freshModel())}>Reset conditional sum</button>
    </>:<>
      {available&&!sameColumns(data.sumSchema,captured)&&<button type="button" disabled={!editable} onClick={()=>change(model)}>Use captured Sum columns</button>}
      <fieldset disabled={!available||runBusy}><legend>Conditional sum</legend>
        <label className="flow-field">Operation<select aria-label="Conditional sum operation" value={model.operation} disabled={pendingFields!==0} onChange={e=>['sumif','sumifs'].includes(e.target.value)?change({...model,operation:e.target.value}):false}><option value="sumif">SUMIF · one rule</option><option value="sumifs">SUMIFS · all rules</option></select></label>
        <label className="flow-field">Measure column<select aria-label="Conditional sum measure" value={index<0?'':'column:'+index} disabled={pendingFields!==0} onChange={e=>{const column=selectedColumn(e.target.value,columns);return column?change({...model,measure:column.name}):false;}}><option value="">{model.measure?'Saved measure is unavailable — choose a column':'Choose a measure column'}</option>{columns.map((column,i)=><option key={'column:'+i} value={'column:'+i}>{column.name+' · '+column.type}</option>)}</select></label>
      </fieldset>
      <FilterCriteriaEditor node={adaptedNode} schema={adaptedSchema} onEdit={(_id,criteria)=>edit({...model,criteria})} onRun={run} runBusy={runBusy} pendingFields={pendingFields} Field={Field} runLabel="Run Sum input" allowSQL={false} andOnly={model.operation==='sumifs'}/>
      {model.operation==='sumifs'&&model.criteria?.op==='or'&&<p role="status">SUMIFS requires AND. Select “All rules (AND)” explicitly; the saved OR group has been kept.</p>}
    </>}
    {error&&<p role="status" className="flow-criteria-error">Conditional sum needs attention: {error}</p>}
    <p className="flow-help">Choosing columns or rules does not run or save the workflow. Source files can change outside this app.</p>
  </section>;
}
