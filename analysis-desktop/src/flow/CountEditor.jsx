import React from 'react';
import {compileConditionalCount,CONDITIONAL_COUNT_VERSION,isCountColumnType} from '../../engine/conditional-count.js';
import {FilterCriteriaEditor} from './FilterCriteriaEditor.jsx';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.hasOwn(value,key);
function actualColumns(value){
  if(!Array.isArray(value)||!value.length||Object.keys(value).length!==value.length)return null;
  const seen=new Set();
  for(const c of value){
    if(!plain(c)||typeof c.name!=='string'||!c.name||c.name.includes('\0')||typeof c.type!=='string'||!c.type.trim()||c.type.includes('\0'))return null;
    const key=c.name.replace(/[A-Z]/g,ch=>ch.toLowerCase());if(seen.has(key))return null;seen.add(key);
  }
  return value;
}
const fresh=operation=>operation==='countif'
  ?{version:CONDITIONAL_COUNT_VERSION,operation:'countif',criteria:{version:'analysis.criteria/1',op:'and',rules:[]}}
  :{version:CONDITIONAL_COUNT_VERSION,operation:'count',column:''};
function recognized(model){
  if(!plain(model)||model.version!==CONDITIONAL_COUNT_VERSION)return false;
  const fields=model.operation==='count'?['version','operation','column']:model.operation==='countif'?['version','operation','criteria']:null;
  return !!fields&&fields.every(k=>own(model,k))&&Object.keys(model).every(k=>fields.includes(k))&&(model.operation!=='count'||typeof model.column==='string');
}
function selectedColumn(value,columns){
  if(typeof value!=='string'||!/^column:(0|[1-9]\d*)$/.test(value))return null;
  const index=Number(value.slice(7));return Number.isSafeInteger(index)?columns[index]||null:null;
}
export function CountEditor({node,schema,onEdit,onRun,runBusy=false,pendingFields=0,Field}){
  const data=plain(node?.data)?node.data:{},model=data.countModel;
  const captured=actualColumns(schema?.columns),stored=actualColumns(data.countSchema);
  const available=schema?.status==='available'&&!!captured&&schema.token!=null;
  const columns=(available?captured:stored)||[],known=recognized(model);
  const canCommit=available&&!runBusy&&typeof onEdit==='function',editable=canCommit&&pendingFields===0;
  // Field releases its live draft before committing; Root checks current ownership.
  const edit=next=>canCommit?onEdit(node?.id,next,schema.token)===true:false;
  const change=next=>editable?edit(next):false;
  const run=()=>!runBusy&&pendingFields===0&&typeof onRun==='function'?onRun(node?.id):false;
  const choices=columns.map((column,index)=>({column,index})).filter(({column})=>isCountColumnType(column.type));
  const index=known&&model.operation==='count'?columns.findIndex(c=>c.name===model.column&&isCountColumnType(c.type)):-1;
  let error=null;try{compileConditionalCount(model,data.countSchema);}catch(e){error=typeof e?.message==='string'?e.message:'The saved count definition could not be validated.';}
  const reason=typeof schema?.reason==='string'?schema.reason:'';
  return <section className="flow-count-editor" aria-label="Count">
    <p className="flow-help">COUNT counts non-NULL values in one supported text, numeric or BOOLEAN column. Empty text, zero and false count as values; original contents are kept.</p>
    <p className="flow-help">COUNTIF counts rows matching one typed rule over the full input. Empty input or no matches returns 0. The result is one BIGINT row.</p>
    {!available&&<p className="flow-help">{reason||'Run the input branch to capture its current columns before editing.'}</p>}
    {schema?.status==='available'&&!available&&<p role="status">The captured column schema or its owner is invalid. Run the input again before editing.</p>}
    {!known?<>
      <button type="button" disabled={runBusy||pendingFields!==0||typeof onRun!=='function'} onClick={run}>Run Count input</button>
      <p role="status">The saved count structure is invalid or uses an unsupported version. It is kept until you explicitly reset it.</p>
      <button type="button" disabled={!editable} onClick={()=>change(fresh('count'))}>Reset count</button>
    </>:<>
      {available&&JSON.stringify(data.countSchema)!==JSON.stringify(captured)&&<button type="button" disabled={!editable} onClick={()=>change(model)}>Use captured Count columns</button>}
      <fieldset disabled={!available||runBusy}><legend>Count</legend>
        <label className="flow-field">Operation<select aria-label="Count operation" disabled={pendingFields!==0} value={model.operation} onChange={e=>['count','countif'].includes(e.target.value)?change(fresh(e.target.value)):false}><option value="count">COUNT · values</option><option value="countif">COUNTIF · one rule</option></select></label>
        {model.operation==='count'&&<label className="flow-field">Column<select aria-label="Count column" disabled={pendingFields!==0} value={index<0?'':'column:'+index} onChange={e=>{const c=selectedColumn(e.target.value,columns);return c&&isCountColumnType(c.type)?change({...model,column:c.name}):false;}}><option value="">{model.column?'Saved column needs review — choose a column':'Choose a column'}</option>{choices.map(({column,index})=><option key={'column:'+index} value={'column:'+index}>{column.name+' · '+column.type}</option>)}</select></label>}
      </fieldset>
      {model.operation==='count'?<>
        {!choices.length&&<p role="status">No supported scalar columns are available. Run the input and review its actual schema.</p>}
        <button type="button" disabled={runBusy||pendingFields!==0||typeof onRun!=='function'} onClick={run}>Run Count input</button>
      </>:<FilterCriteriaEditor node={{id:node?.id,data:{criteria:model.criteria,criteriaSchema:data.countSchema}}} schema={{status:available?'available':'unavailable',columns,token:schema?.token,reason}} onEdit={(_id,criteria)=>edit({...model,criteria})} onRun={run} runBusy={runBusy} pendingFields={pendingFields} Field={Field} runLabel="Run Count input" allowSQL={false} maxRules={1}/>}
    </>}
    {error&&<p role="status" className="flow-criteria-error">Count needs attention: {error}</p>}
    <p className="flow-help">Changing operation starts its corresponding fields again. Choosing columns or criteria does not run or save. Row counts and preview row numbers remain distinct.</p>
  </section>;
}
