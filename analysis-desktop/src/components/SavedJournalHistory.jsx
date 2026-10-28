import React,{useEffect,useRef,useState} from 'react';
import {SavedHistogramPreview} from './SavedHistogramPreview.jsx';

export function SavedJournalHistory(){
 const bridge=window.sirenDesktop,live=useRef(true),listSeq=useRef(0),openSeq=useRef(0);
 const [page,setPage]=useState(null),[listBusy,setListBusy]=useState(false),[opening,setOpening]=useState(''),[record,setRecord]=useState(null),[listError,setListError]=useState(''),[openError,setOpenError]=useState('');
 async function refresh(offset=0,expectedListingRevision){
  const seq=++listSeq.current,requestId=crypto.randomUUID();setListBusy(true);setListError('');
  try{const value=await bridge.journalSnapshotsList({requestId,offset,expectedListingRevision});if(!live.current||seq!==listSeq.current)return;
   if(value.requestId!==requestId||value.schemaVersion!=='siren.saved-journal-list/1'||!Array.isArray(value.entries)||value.offset!==offset||!Number.isSafeInteger(value.total)||typeof value.listingRevision!=='string')throw Error('Lista primită nu corespunde cererii.');setPage(value);
  }catch(e){if(live.current&&seq===listSeq.current)setListError(e.message.includes('LIST_CHANGED')?'Lista s-a schimbat. Reîncarcă prima pagină.':e.message);}
  finally{if(live.current&&seq===listSeq.current)setListBusy(false);}
 }
 async function open(entry){
  const seq=++openSeq.current,requestId=crypto.randomUUID();setOpening(entry.entryId);setOpenError('');
  try{const value=await bridge.journalSnapshotOpen({requestId,entryId:entry.entryId,expectedEntrySha256:entry.entrySha256});if(!live.current||seq!==openSeq.current)return;
   if(value.requestId!==requestId||value.schemaVersion!=='siren.saved-journal-open/1'||value.entryId!==entry.entryId||value.entrySha256!==entry.entrySha256||value.file?.integritySha256!==entry.integritySha256||value.file?.snapshot?.source?.resultVersion!==entry.resultVersion||value.sourceState!=='unknown'||!['VERIFIED','UNAVAILABLE'].includes(value.journal?.status))throw Error('Snapshotul primit nu corespunde selecției.');setRecord(value);
  }catch(e){if(live.current&&seq===openSeq.current)setOpenError(e.message);}
  finally{if(live.current&&seq===openSeq.current)setOpening('');}
 }
 useEffect(()=>{live.current=true;if(bridge?.journalSnapshotsList)refresh();return()=>{live.current=false;listSeq.current++;openSeq.current++;};},[]);
 if(!bridge?.journalSnapshotsList)return null;
 const snapshot=record?.file.snapshot,aggregate=snapshot?.coverage.aggregation,input=snapshot?.source.origin.inputSnapshots[0];
 return <details id="journal-history" style={{padding:12,borderBottom:'1px solid #cbd5e1',background:'#f8fafc',fontSize:12,maxHeight:360,overflow:'auto'}}>
  <summary style={{cursor:'pointer',fontWeight:600}}>Histograme salvate cu jurnal</summary>
  <p>Deschide un snapshot păstrat, inclusiv după restart. Deschiderea citește fișierele salvate și nu pornește o execuție nouă.</p>
  <button id="journal-history-refresh" onClick={()=>refresh()}>Reîncarcă lista</button>
  {listBusy&&<p role="status">Se citește lista…</p>}{listError&&<p id="journal-history-list-error" role="alert" style={{color:'#b91c1c'}}>{listError}</p>}
  {page&&!listBusy&&<p id="journal-history-page">{page.total?`${page.offset+1}–${page.offset+page.entries.length} din ${page.total}`:'Nicio histogramă cu jurnal salvată.'} Lista conține metadate; jurnalul se reverifică la deschidere.</p>}
  <div style={{maxHeight:120,overflow:'auto'}}>{page?.entries.map(entry=><div key={entry.entryId} style={{marginTop:4}}>
   <button data-journal-entry={entry.entryId} disabled={entry.status!=='SAVED_NOT_RECHECKED'} aria-pressed={record?.entryId===entry.entryId} onClick={()=>open(entry)} style={{textAlign:'left',width:'100%'}}>{entry.status==='SAVED_NOT_RECHECKED'?`${entry.measure} · ${entry.measureType} · ${entry.sourceRowCount} rânduri sursă`:'Metadate nevalide · '+entry.entryId}</button>
   {entry.status==='INVALID_METADATA'&&<span style={{color:'#92400e'}}>{entry.error}</span>}
  </div>)}</div>
  {page&&page.offset>0&&<button id="journal-history-first" onClick={()=>refresh()}>Prima pagină</button>}
  {page?.nextOffset!==null&&page?.nextOffset!==undefined&&<button id="journal-history-next" onClick={()=>refresh(page.nextOffset,page.listingRevision)}>Pagina următoare</button>}
  {opening&&<p id="journal-history-opening" role="status">Se verifică snapshotul selectat…</p>}
  {openError&&<p id="journal-history-open-error" role="alert" style={{color:'#b91c1c'}}>{openError}</p>}
  {record&&<div id="journal-history-preview" data-entry-id={record.entryId} style={{marginTop:8}}>
   <strong>Snapshot salvat · sursa actuală necunoscută</strong>
   <p id="journal-history-proof" style={{color:record.journal.status==='VERIFIED'?'#166534':'#92400e'}}>{record.journal.status==='VERIFIED'?'Jurnal și copie reverificate la deschidere.':'Grafic salvat valid; jurnalul nu poate fi verificat acum.'}</p>
   {record.journal.status==='UNAVAILABLE'&&<p style={{color:'#92400e'}}>Dovada de execuție nu este confirmată în această sesiune. Fișierele au fost păstrate. {record.journal.error}</p>}
   <p style={{overflowWrap:'anywhere'}}>Versiune: {snapshot.source.resultVersion}<br/>Măsură: {aggregate.measureColumn} · {snapshot.source.origin.measureType} · unitate: {aggregate.unit??'necunoscută'}</p>
   <p id="journal-history-counts">{aggregate.totalCount} rânduri sursă; {aggregate.numericCount} valori numerice; {aggregate.nullCount} NULL. {snapshot.rows.length} intervale complete.</p>
   <p id="journal-history-reader">{record.readerMode==='LEGACY_PARQUET_RECEIPT_ONLY'?'Parquet · cititor din chitanța istorică, fără descriptorul nou.':input.format==='csv'?`CSV · ${input.options.header?'cu antet':'fără antet'}; separator ${input.options.delimiter==='\t'?'tab':input.options.delimiter}; ${record.readerPolicy?.kind==='explicit-string'?`NULL explicit: ${record.readerPolicy.token===''?'șir gol':JSON.stringify(record.readerPolicy.token)}`:'NULL implicit: câmp gol'}. Valorile între ghilimele sunt păstrate.`:'Parquet · cititor salvat.'}</p>
   <SavedHistogramPreview file={record.file} />
   <div style={{maxHeight:140,overflow:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Interval</th><th>Număr</th></tr></thead><tbody>{snapshot.rows.map((r,i)=><tr key={i}><td>[{r.values.bin_start}, {r.values.bin_end}{i===snapshot.rows.length-1?']':')'}</td><td>{r.values.count}</td></tr>)}</tbody></table></div>
   <p style={{overflowWrap:'anywhere'}}>Fișier Charts: {record.chartFilePath}</p>
  </div>}
 </details>;
}
