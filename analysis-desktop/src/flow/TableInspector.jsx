import React,{useEffect,useRef,useState} from 'react';
import {columnLetter} from './table-coordinates.js';
export function TableInspector({table,title,onClose}){
  const dialogRef=useRef(null),[query,setQuery]=useState(''),[page,setPage]=useState(0);
  useEffect(()=>{const origin=document.activeElement,dialog=dialogRef.current;dialog.showModal();return()=>{dialog.close();if(!document.querySelector('dialog[open]')){if(origin?.isConnected&&!origin.disabled)origin.focus();if(document.activeElement!==origin)document.querySelector('.analysis-app')?.focus();}};},[]);
  const matching=table.columns.map((c,index)=>({...c,letter:columnLetter(index)})).filter(c=>c.name.toLowerCase().includes(query.toLowerCase()));
  const start=Math.min(page*24,Math.max(0,Math.floor((matching.length-1)/24)*24)),columns=matching.slice(start,start+24);
  return <dialog ref={dialogRef} className="flow-table-inspector" aria-labelledby="table-inspector-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <header><h2 id="table-inspector-title">Table · {title}</h2><button type="button" onClick={onClose}>Close table</button></header>
    <p className="flow-help">Showing {table.visible.toLocaleString()} of {table.total.toLocaleString()} result rows · {table.columns.length.toLocaleString()} columns. Preview limited to 50 rows; large data stays in Analysis.</p>
    <p className="flow-help">Captured execution: {table.executedNodes} nodes · Current workflow: {table.definitionNodes} nodes. Other nodes may still need to run.</p>
    <details><summary>Captured output details</summary><p>Job {table.token.jobId} · Node {table.token.nodeId}. This table describes the captured run; source files may change outside the app.</p></details>
    <label className="flow-field">Find a column<input autoFocus aria-label="Find a table column" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Column name"/></label>
    <p className="flow-help">Column search only changes this view. NULL, empty text and zero are distinct. Inspection does not edit data, run or save.</p>
    <p className="flow-help">Letters follow this result's column order. Row numbers identify rows in this captured preview.</p>
    <nav aria-label="Table column pages"><button type="button" disabled={start===0} onClick={()=>setPage(Math.max(0,page-1))}>Previous columns</button>{' '}<button type="button" disabled={start+24>=matching.length} onClick={()=>setPage(Math.floor(start/24)+1)}>Next columns</button>{' '}<span>Columns {matching.length?start+1:0}–{start+columns.length} of {matching.length} matching · {table.columns.length} total. Up to 24 columns per page.</span></nav>
    <div className="flow-inspection-scroll" tabIndex={0} role="region" aria-label="Captured result table"><table><caption>{columns.length} of {table.columns.length} columns shown</caption><thead><tr><th scope="col" className="flow-row-number flow-coordinate-corner" aria-label="Row number in captured preview">Row</th>{columns.map(c=><th scope="col" key={c.name}><b className="flow-column-letter" aria-label={'Column '+c.letter}>{c.letter}</b><span>{c.name}</span><small>{c.type}</small></th>)}</tr></thead><tbody>{columns.length>0&&table.rows.map((row,i)=><tr key={i}><th scope="row" className="flow-row-number" aria-label={'Preview row '+(i+1)}>{i+1}</th>{columns.map(c=><td key={c.name}>{row[c.name]===null?<span className="flow-cell-special">NULL</span>:row[c.name]===''?<span className="flow-cell-special">Empty text ("")</span>:String(row[c.name])}</td>)}</tr>)}</tbody></table>{!columns.length&&<p>No columns match this name.</p>}{table.total===0&&<p>No result rows. The captured schema is shown above.</p>}</div>
  </dialog>;
}
