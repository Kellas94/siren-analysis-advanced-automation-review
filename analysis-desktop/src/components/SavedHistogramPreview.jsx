import React from 'react';
import {histogramPreviewModel} from './histogram_preview.js';

export function SavedHistogramPreview({file}){
 let m;try{m=histogramPreviewModel(file);}catch(e){return <p id="journal-plot-error" role="alert" style={{color:'#92400e'}}>Previzualizarea nu poate fi desenată. Tabelul salvat rămâne disponibil. {e.message}</p>;}
 const ink=m.light?'#334155':'#f1f5f9',grid=m.light?'#cbd5e1':'#475569';
 return <figure id="journal-histogram-plot" style={{margin:'8px 0',padding:8,border:'1px solid #cbd5e1',borderRadius:4,background:m.light?'#fff':'#0f172a',color:ink}}>
  <figcaption style={{overflowWrap:'anywhere'}}><strong>{m.title}</strong><br/>{m.numericCount} valori numerice; {m.nullCount} NULL separat. {m.bars.length} intervale complete.</figcaption>
  <div id="journal-plot-scroll" tabIndex={0} role="region" aria-label="Previzualizare histogramă; derulare orizontală pentru toate intervalele" style={{overflowX:'auto',maxWidth:'100%'}}>
   <svg id="journal-histogram-svg" xmlns="http://www.w3.org/2000/svg" width={m.width} height={m.height} role="img" aria-label={m.title+'. '+m.numericCount+' valori numerice; '+m.nullCount+' NULL separat.'} style={{display:'block',fontFamily:'inherit',fontSize:10}}>
    <title>{m.title}</title><desc>Snapshot salvat. {m.totalCount} rânduri sursă; {m.numericCount} valori numerice; {m.nullCount} NULL. Toate intervalele sunt păstrate; ultimul include limita finală. Sursa actuală este necunoscută.</desc>
    <metadata>{JSON.stringify({snapshotId:m.snapshotId,resultVersion:m.resultVersion,snapshotSha256:file.snapshotSha256,integritySha256:file.integritySha256})}</metadata>
    {m.ticks.map(t=><g key={t.value}><line x1={m.left} x2={m.width-m.right} y1={t.y} y2={t.y} stroke={grid}/><text x={m.left-8} y={t.y+3} textAnchor="end" fill={ink}>{t.value}</text></g>)}
    {m.bars.map((bar,i)=><g key={i} data-preview-bin={i}>
     <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={m.color}><title>{bar.label}: {bar.count}</title></rect>
     <text x={bar.labelX} y={bar.y-4} textAnchor="middle" fill={ink}>{bar.count}</text>
     <text x={bar.labelX} y={m.baseline+18} textAnchor="middle" fill={ink}>{bar.label}</text>
    </g>)}
   </svg>
  </div>
  <p style={{margin:'2px 0',overflowWrap:'anywhere'}}>{m.xLabel} · {m.yLabel}. Derulează orizontal dacă etichetele nu încap. Valorile exacte sunt și în tabel.</p>
 </figure>;
}
