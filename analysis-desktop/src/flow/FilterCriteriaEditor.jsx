import React from 'react';
import {compileCriteria,operatorsForType,CRITERIA_VERSION} from '../../engine/filter-criteria.js';
const labels={eq:'Equals',ne:'Does not equal',lt:'Less than',lte:'At most',gt:'Greater than',gte:'At least',in:'Is one of',notIn:'Exclude these values',contains:'Contains text',startsWith:'Starts with',endsWith:'Ends with',isNull:'Is NULL',isNotNull:'Is not NULL',isEmpty:'Is empty text',isNotEmpty:'Is not empty text'};
const displayable=value=>value==null||['string','number','boolean'].includes(typeof value);
function ruleFor(column,operator){
  const rule={column:column.name,operator};
  if(!['isNull','isNotNull'].includes(operator)){
    rule.nulls='exclude';
    if(['in','notIn'].includes(operator))rule.values=[column.type.toUpperCase()==='BOOLEAN'?false:''];
    else if(!['isEmpty','isNotEmpty'].includes(operator))rule.value=column.type.toUpperCase()==='BOOLEAN'?false:'';
  }
  return rule;
}
export function FilterCriteriaEditor({node,schema,onEdit,onRun,onSQL,runBusy,pendingFields,Field,runLabel="Run Filter input",allowSQL=true,andOnly=false,maxRules=20}){
  const active=node.data.criteria!==undefined,available=schema?.status==='available',model=node.data.criteria;
  const editable=available&&!runBusy&&pendingFields===0;
  const renderable=model?.version===CRITERIA_VERSION&&['and','or'].includes(model.op)&&Array.isArray(model.rules)&&model.rules.length<=20&&model.rules.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&typeof r.column==='string'&&typeof r.operator==='string'&&displayable(r.value)&&(r.values===undefined||Array.isArray(r.values)&&r.values.length<=100&&r.values.every(displayable)));
  const rules=renderable?model.rules:[];
  const rawColumns=available?schema.columns:node.data.criteriaSchema;
  const columns=(Array.isArray(rawColumns)?rawColumns:[]).filter(c=>c&&typeof c.name==='string'&&typeof c.type==='string'&&c.type.trim());
  let compiled=null,error=null;
  if(active)try{compiled=compileCriteria(model,node.data.criteriaSchema);}catch(e){error=e.message;}
  const edit=next=>onEdit(node.id,next,schema.token);
  const replace=(index,rule)=>edit({...model,rules:rules.map((r,i)=>i===index?rule:r)});
  return <section className="flow-filter-criteria" aria-label="Multiple filter criteria">
    <button type="button" disabled={runBusy||pendingFields>0} onClick={()=>onRun(node.id)}>{runLabel}</button>
    <p className="flow-help">Runs the input branch only. The full workflow is kept.</p>
    <p className="flow-help">{schema?.reason}</p>
    {active&&renderable&&available&&JSON.stringify(node.data.criteriaSchema)!==JSON.stringify(columns)&&<button type="button" disabled={runBusy||pendingFields>0} onClick={()=>edit(model)}>Use captured input columns</button>}
    {!active?<button type="button" disabled={!editable} onClick={()=>edit({version:CRITERIA_VERSION,op:'and',rules:[]})}>Use multiple criteria</button>:<>
      <p className="flow-help">Rules are saved with the workflow and run over all rows in DuckDB. Text edits apply on leaving the field. NULL and empty text are different.</p>
      {!renderable?<><p role="status">The saved criteria structure is invalid or uses an unsupported version. It is kept until you explicitly replace it{allowSQL?' or switch to SQL':null}.</p><button type="button" disabled={!editable} onClick={()=>edit({version:CRITERIA_VERSION,op:'and',rules:[]})}>Reset filter criteria</button></>:<fieldset disabled={!available||runBusy}><legend>Filter rules</legend>
        <label className="flow-field">Combine rules<select aria-label="Combine rules" disabled={pendingFields>0} value={model?.op||''} onChange={e=>edit({...model,op:e.target.value})}><option value="and">All rules (AND)</option><option value="or" disabled={andOnly}>Any rule (OR)</option></select></label>
        {rules.map((rule,index)=>{
          const column=columns.find(c=>c.name===rule?.column),ops=operatorsForType(column?.type),columnIndex=columns.findIndex(c=>c.name===rule?.column),boolean=column?.type?.toUpperCase()==='BOOLEAN';
          return <div className="flow-criteria-rule" key={index} data-rule-index={index}>
            <h5>Rule {index+1}</h5>
            <label className="flow-field">Column<select aria-label={'Rule '+(index+1)+' column'} disabled={pendingFields>0} value={columnIndex<0?'':String(columnIndex)} onChange={e=>{const c=columns[Number(e.target.value)];if(e.target.value!==''&&c)replace(index,ruleFor(c,'isNotNull'));}}><option value="">Choose a column</option>{columns.map((c,i)=><option key={c.name} value={String(i)}>{c.name+' · '+c.type}</option>)}</select></label>
            <label className="flow-field">Condition<select aria-label={'Rule '+(index+1)+' condition'} disabled={pendingFields>0} value={rule.operator||''} onChange={e=>{if(column&&ops.includes(e.target.value))replace(index,ruleFor(column,e.target.value));}}>{!ops.includes(rule.operator)&&<option value={rule.operator||''}>Unsupported saved condition</option>}{ops.map(op=><option key={op} value={op}>{labels[op]}</option>)}</select></label>
            {['in','notIn'].includes(rule.operator)?<Field label={'Rule '+(index+1)+' values (one per line)'} value={Array.isArray(rule.values)?rule.values.map(String).join('\n'):''} multiline onCommit={value=>replace(index,{...rule,values:value.split('\n').map(v=>boolean&&v==='true'?true:boolean&&v==='false'?false:v)})}/>:!['isNull','isNotNull','isEmpty','isNotEmpty'].includes(rule.operator)&&(boolean?<label className="flow-field">Value<select aria-label={'Rule '+(index+1)+' value'} value={String(rule.value)} disabled={pendingFields>0} onChange={e=>replace(index,{...rule,value:e.target.value==='true'})}><option value="false">false</option><option value="true">true</option></select></label>:<Field label={'Rule '+(index+1)+' value'} value={rule.value} onCommit={value=>replace(index,{...rule,value})}/>)}
            {!['isNull','isNotNull'].includes(rule.operator)&&<label className="flow-check"><input aria-label={'Rule '+(index+1)+' keep NULL rows'} type="checkbox" disabled={pendingFields>0} checked={rule.nulls==='include'} onChange={e=>replace(index,{...rule,nulls:e.target.checked?'include':'exclude'})}/>Keep NULL rows for this rule</label>}
            {['in','notIn'].includes(rule.operator)&&<p className="flow-help">One exact value per line; an empty line is empty text. No trimming or wildcard expansion. BOOLEAN: true or false.</p>}
            <button type="button" disabled={pendingFields>0} onClick={()=>edit({...model,rules:rules.filter((_,i)=>i!==index)})} aria-label={'Remove rule '+(index+1)}>Remove rule</button>
          </div>;
        })}
        <button type="button" disabled={!editable||rules.length>=maxRules||!columns.length} onClick={()=>edit({...model,rules:[...rules,ruleFor(columns[0],'isNotNull')]})}>Add rule</button>
      </fieldset>}
      <p className="flow-help">To exclude several values on one column, use “Exclude these values” or combine exclusions with AND. OR keeps its usual meaning.</p>
      {error&&<p role="status" className="flow-criteria-error">Criteria need attention: {error}</p>}
      {compiled&&<details><summary>Generated filter condition</summary><pre>{compiled.condition}</pre></details>}
      {allowSQL&&<button type="button" disabled={runBusy||pendingFields>0} onClick={()=>onSQL(node.id)}>Use SQL condition instead</button>}
      {allowSQL&&<p className="flow-help">Switching removes the structured rules and restores the separate SQL field. Undo restores the rules.</p>}
    </>}
  </section>;
}
