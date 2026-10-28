import React from 'react';
import {compileDerivedColumns,DERIVED_COLUMNS_VERSION} from '../../engine/derived-columns.js';
const displayable=value=>value==null||['string','number','boolean'].includes(typeof value);
export function DerivedColumnsEditor({node,schema,onEdit,onRun,runBusy,pendingFields,Field}){
  const model=node.data.derivedColumns,available=schema?.status==='available';
  const rawInputs=available?schema.columns:node.data.derivedSchema;
  const inputs=(Array.isArray(rawInputs)?rawInputs:[]).filter(c=>c&&typeof c.name==='string'&&typeof c.type==='string'&&c.type.trim());
  const strings=inputs.filter(c=>c.type.trim().toUpperCase()==='VARCHAR');
  const known=model?.version===DERIVED_COLUMNS_VERSION&&Array.isArray(model.columns)&&model.columns.length<=20&&model.columns.every(c=>c&&typeof c==='object'&&!Array.isArray(c)&&typeof c.alias==='string'&&typeof c.operation==='string'&&displayable(c.value)&&displayable(c.count)&&displayable(c.start));
  const columns=known?model.columns:[];
  const edit=next=>onEdit(node.id,next,schema.token),replace=(index,value)=>edit({...model,columns:columns.map((c,i)=>i===index?value:c)});
  let error=null;try{compileDerivedColumns(model,node.data.derivedSchema);}catch(e){error=e.message;}
  const add=()=>{
    const used=new Set([...inputs.map(c=>c.name),...columns.map(c=>c.alias)].filter(x=>typeof x==='string').map(s=>s.replace(/[A-Z]/g,c=>c.toLowerCase())));
    let alias='new_column',i=2;while(used.has(alias))alias='new_column_'+i++;
    edit({...model,columns:[...columns,{alias,operation:'literal',type:'VARCHAR',value:''}]});
  };
  return <section className="flow-derived-columns" aria-label="New columns">
    <button type="button" disabled={runBusy||pendingFields>0} onClick={()=>onRun(node.id)}>Run New columns input</button>
    <p className="flow-help">Runs the input branch only. All original columns are kept; new columns appear at the end of the table.</p>
    <p className="flow-help">{schema?.reason}</p>
    {known&&available&&JSON.stringify(node.data.derivedSchema)!==JSON.stringify(inputs)&&<button type="button" disabled={runBusy||pendingFields>0} onClick={()=>edit(model)}>Use captured input columns</button>}
    {!known?<><p role="status">The saved new-column structure is invalid or uses an unsupported version. It is kept until you explicitly reset its definitions.</p><button type="button" disabled={!available||runBusy||pendingFields>0} onClick={()=>edit({version:DERIVED_COLUMNS_VERSION,columns:[]})}>Reset new-column definitions</button></>:<>
      <fieldset disabled={!available||runBusy}><legend>Added columns</legend>
        {columns.map((column,index)=>{
          const selected=strings.findIndex(c=>c.name===column.source),label='New column '+(index+1);
          return <div className="flow-derived-column" key={index} data-derived-index={index}>
            <h5>{label}</h5>
            <Field label={label+' name'} value={column.alias} onCommit={alias=>replace(index,{...column,alias})}/>
            <label className="flow-field">Value from<select aria-label={label+' operation'} disabled={pendingFields>0} value={column.operation||''} onChange={e=>{const operation=e.target.value;if(operation==='literal')replace(index,{alias:column.alias,operation,type:'VARCHAR',value:''});else if(['left','right','mid'].includes(operation))replace(index,{alias:column.alias,operation,source:strings[0]?.name||'',count:'1',...(operation==='mid'?{start:'1'}:{})});}}>{!['literal','left','right','mid'].includes(column.operation)&&<option value={column.operation||''}>Unsupported saved operation</option>}<option value="literal">Entered text</option><option value="left">LEFT · first characters</option><option value="right">RIGHT · last characters</option><option value="mid">MID · characters from a position</option></select></label>
            {column.operation==='literal'?<><label className="flow-check"><input type="checkbox" aria-label={label+' NULL value'} disabled={pendingFields>0} checked={column.value===null} onChange={e=>replace(index,{...column,value:e.target.checked?null:''})}/>Use NULL instead of text</label>{column.value!==null&&<Field label={label+' text'} value={column.value} onCommit={value=>replace(index,{...column,value})}/>}<p className="flow-help">The same text is added to each row. Empty text, NULL and “0” stay distinct; “=” remains literal text.</p></>:<>
              <label className="flow-field">Text column<select aria-label={label+' source'} disabled={pendingFields>0} value={selected<0?'':String(selected)} onChange={e=>{const c=strings[Number(e.target.value)];if(e.target.value!==''&&c)replace(index,{...column,source:c.name});}}><option value="">Choose a text column</option>{strings.map((c,i)=><option key={c.name} value={String(i)}>{c.name+' · '+c.type}</option>)}</select></label>
              {column.operation==='mid'&&<Field label={label+' start position'} value={column.start} onCommit={start=>replace(index,{...column,start})}/>}
              <Field label={label+' character count'} value={column.count} onCommit={count=>replace(index,{...column,count})}/>
              <p className="flow-help">MID starts at position1. Count0 returns empty text; NULL stays NULL. Character counts can split combining characters or emoji sequences.</p>
            </>}
            <button type="button" disabled={pendingFields>0} aria-label={'Remove new column '+(index+1)} onClick={()=>edit({...model,columns:columns.filter((_,i)=>i!==index)})}>Remove column</button>
          </div>;
        })}
        <button type="button" disabled={pendingFields>0||columns.length>=20} onClick={add}>Add new column</button>
      </fieldset>
      <p className="flow-help">New names must be unique. Text functions use an original text column; add another New columns step to use a column created here.</p>
    </>}
    {error&&<p role="status" className="flow-criteria-error">New columns need attention: {error}</p>}
    <p className="flow-help">Values are calculated across all rows when you run. The preview stays bounded. Source files can change outside this app.</p>
  </section>;
}
