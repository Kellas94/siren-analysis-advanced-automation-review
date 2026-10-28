import React,{useEffect,useRef,useState} from 'react';
export function WorkflowHistogramPanel({jobId,nodeId}){
 const bridge=window.sirenDesktop,live=useRef(true),operation=useRef(null),[descriptor,setDescriptor]=useState(null),[measure,setMeasure]=useState(''),[edges,setEdges]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[output,setOutput]=useState(null);
 useEffect(()=>{let ignore=false;live.current=true;bridge.workflowHistogramDescribe({jobId,nodeId}).then(d=>{if(!ignore){setDescriptor(d);setMeasure(d.measures[0]?.name||'');}},e=>{if(!ignore)setError(e.message);});return()=>{ignore=true;live.current=false;const id=operation.current;operation.current=null;if(id)bridge.histogramCancel(id).catch(()=>{});};},[jobId,nodeId]);
 function reset(){setOutput(null);setMessage('');setError('');}
 async function start(mode='current'){if(operation.current||!descriptor)return;const id=crypto.randomUUID();operation.current=id;setBusy(true);reset();setMessage(mode==='journal'?'Capturare și calcul cu jurnal de execuție în curs…':mode==='copies'?'Capturare surse și calcul în curs…':'Execuție nouă în curs…');try{
  const r=await bridge[mode==='journal'?'workflowHistogramRecoverableStart':mode==='copies'?'workflowHistogramSnapshotStart':'workflowHistogramStart']({operationId:id,jobId,nodeId,expectedSelectionSha256:descriptor.selectionSha256,expectedReaderBindingSha256:mode==='journal'?descriptor.recoverableDirect.readerBindingSha256:undefined,measure,edges:edges.trim().split(/[;\s]+/).filter(Boolean)});
  if(!live.current||operation.current!==id)return;
  if(r.status!=='saved'||r.operationId!==id||r.selectedJobId!==jobId||r.nodeId!==nodeId||r.selectionSha256!==descriptor.selectionSha256)throw Error('Identitatea histogramei nu corespunde selecției.');
  if(mode==='copies'&&r.physicalIdentity!=='VERIFIED_EXECUTION_COPIES')throw Error('Lipsește dovada copiilor de sursă verificate.');
  if(mode==='journal'&&(r.executionJournal!=='VERIFIED_CATALOG_RECEIPT_2'||r.physicalIdentity!=='VERIFIED_EXECUTION_COPIES'))throw Error('Lipsește dovada jurnalului de execuție verificat.');
  if(mode==='journal'&&r.readerBindingSha256!==descriptor.recoverableDirect.readerBindingSha256)throw Error('Cititorul folosit nu corespunde selecției.');
  setOutput(r);setMessage('Histogramă salvată: '+r.chartFilePath);
 }catch(e){if(live.current&&operation.current===id){setMessage(e.message.includes('HISTOGRAM_CANCELLED')?'Histogramă anulată.':'');if(!e.message.includes('HISTOGRAM_CANCELLED'))setError(e.message);}}
 finally{if(live.current&&operation.current===id){operation.current=null;setBusy(false);}}}
 async function cancel(){const id=operation.current;if(!id)return;try{await bridge.histogramCancel(id);}catch(e){if(live.current&&operation.current===id)setError(e.message);}}
 return <section id="workflow-histogram-panel" style={{marginTop:12,padding:12,border:'1px solid #cbd5e1',borderRadius:6,fontSize:12}}>
  <strong>Histogramă pe rezultatul complet al fluxului</strong>
  <p>Pornește o execuție nouă a definiției selectate și recitește sursele. Rezultatul poate diferi de execuția anterioară. Datele mari rămân în motor; histograma folosește toate rândurile rezultatului nou.</p>
  {descriptor&&<p>Execuția selectată: {jobId}; nod: {nodeId}; anterior: {descriptor.priorRowCount} rânduri. Valorile agregate sunt numărate fără ponderare. Acțiunea standard recitește originalele. Acțiunea de capturare calculează pe copii verificate, create înaintea calculului.</p>}
  <label>Măsură numerică <select id="workflow-histogram-measure" disabled={busy||!descriptor} value={measure} onChange={e=>{setMeasure(e.target.value);reset();}}>{descriptor?.measures.map(c=><option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}</select></label>
  {descriptor&&!descriptor.measures.length&&<p>Acest rezultat nu are o coloană numerică declarată. Textul numeric nu este convertit implicit.</p>}
  <label style={{display:'block',marginTop:8}}>Limite intervale, separate prin ; <input id="workflow-histogram-edges" value={edges} disabled={busy} placeholder="0; 100; 200; 300" style={{width:'100%',boxSizing:'border-box'}} onChange={e=>{setEdges(e.target.value);reset();}} /></label>
  <p>Punct pentru zecimale; ultimul interval include limita finală. NULL se numără separat.</p>
  <button id="workflow-histogram-start" disabled={busy||!descriptor||!measure||!edges.trim()} onClick={()=>start('current')}>Execută din nou și salvează histograma</button>
  <p>Cu surse capturate, fiecare intrare este copiată și verificată separat. Originalele pot evolua; nu se garantează o captură simultană a mai multor fișiere.</p>
  <button id="workflow-histogram-snapshot-start" disabled={busy||!descriptor||!measure||!edges.trim()} onClick={()=>start('copies')}>Capturează sursele și salvează histograma</button>
  <p>{descriptor?.recoverableDirect?.reason}</p>
  <button id="workflow-histogram-recoverable-start" disabled={busy||!descriptor?.recoverableDirect?.supported||!descriptor.recoverableDirect.measures.includes(measure)||!edges.trim()||edges.trim().split(/[;\s]+/).filter(Boolean).length>21} onClick={()=>start('journal')}>Capturează și salvează cu jurnal de execuție</button>
  <button id="workflow-histogram-cancel" disabled={!busy} onClick={cancel}>Anulează</button>
  {message&&<p role="status" style={{overflowWrap:'anywhere'}}>{message}</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  {output&&<div id="workflow-histogram-counts"><p>{output.observationCount} observații noi; {output.nullCount} NULL.</p>{output.physicalIdentity==='VERIFIED_EXECUTION_COPIES'&&<p id="workflow-copy-status">Calcul pe {output.inputSnapshots.length} copii verificate. Snapshotul salvat este distinct de sursele actuale.</p>}{output.executionJournal==='VERIFIED_CATALOG_RECEIPT_2'&&<p id="workflow-journal-status">Jurnal și rezultat verificate, păstrate pe disc. Graficul rămâne un snapshot salvat.</p>}<table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Interval</th><th>Număr</th></tr></thead><tbody>{output.bins.map((b,i)=><tr key={i}><td>[{b.start}, {b.end}{i===output.bins.length-1?']':')'}</td><td>{b.count}</td></tr>)}</tbody></table></div>}
 </section>;
}
