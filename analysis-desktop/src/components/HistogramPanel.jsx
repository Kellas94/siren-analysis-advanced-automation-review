import React,{useEffect,useRef,useState} from 'react';
export function HistogramPanel({record,measure}){
  const [edges,setEdges]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[output,setOutput]=useState(null);
  const mounted=useRef(true),operation=useRef(null),bridge=window.sirenDesktop;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const id=operation.current;operation.current=null;if(id)bridge.histogramCancel(id).catch(()=>{})}},[]);
  async function start(){
    if(operation.current)return;const id=crypto.randomUUID();operation.current=id;setBusy(true);setOutput(null);setMessage('Calcul în curs…');setError('');
    try{const receipt=await bridge.histogramStart({operationId:id,resultId:record.resultId,expectedIntegrity:record.integritySha256,measure,edges:edges.trim().split(/[;\s]+/).filter(Boolean)});
      if(!mounted.current||operation.current!==id)return;
      if(receipt.status!=='saved'||receipt.operationId!==id||receipt.resultId!==record.resultId||receipt.registryIntegritySha256!==record.integritySha256)throw Error('Identitatea histogramei salvate nu corespunde cererii.');
      setOutput(receipt);setMessage('Histogramă salvată: '+receipt.chartFilePath);
    }catch(e){if(mounted.current&&operation.current===id){setMessage(e.message.includes('HISTOGRAM_CANCELLED')?'Histogramă anulată.':'');if(!e.message.includes('HISTOGRAM_CANCELLED'))setError(e.message)}}
    finally{if(mounted.current&&operation.current===id){operation.current=null;setBusy(false)}}
  }
  async function cancel(){const id=operation.current;if(!id)return;try{await bridge.histogramCancel(id)}catch(e){if(mounted.current&&operation.current===id)setError(e.message)}}
  const complete=record.counts.transferStatus==='COMPLETE';
  return <div id="histogram-panel" style={{marginTop:12,paddingTop:8,borderTop:'1px solid #cbd5e1'}}>
    <strong>Histogramă</strong><p>Observații: cele {record.counts.capturedRows} rânduri păstrate. Valorile agregate sunt numărate fără ponderare. Sursa originală nu este recitită.</p>
    {!complete&&<p>Rezultatul păstrat este incomplet. Un preview sau un eșantion nu poate deveni histogramă a întregului rezultat.</p>}
    <label>Limite intervale, separate prin ; <input id="registry-histogram-edges" value={edges} disabled={busy} placeholder="0; 100; 200; 300" onChange={e=>{setEdges(e.target.value);setOutput(null);setMessage('');setError('')}} style={{width:'100%',boxSizing:'border-box'}} /></label>
    <p>Folosește punctul pentru zecimale. Ultimul interval include limita finală; NULL se numără separat.</p>
    <button id="registry-histogram-start" disabled={busy||!complete||!measure||!edges.trim()} onClick={start}>Calculează și salvează histograma</button>
    <button id="registry-histogram-cancel" disabled={!busy} onClick={cancel}>Anulează histograma</button>
    {message&&<p role="status" style={{overflowWrap:'anywhere'}}>{message}</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    {output&&<div id="histogram-counts"><p>{output.observationCount} observații; {output.nullCount} NULL.</p><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Interval</th><th>Număr</th></tr></thead><tbody>{output.bins.map((bin,i)=><tr key={i}><td>[{bin.start}, {bin.end}{i===output.bins.length-1?']':')'}</td><td>{bin.count}</td></tr>)}</tbody></table></div>}
  </div>;
}
