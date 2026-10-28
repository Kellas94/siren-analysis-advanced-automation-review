import ChartCore from '../../chart-core.cjs';

// Input is the immutable file admitted by the read-only main-process reader.
// This is a display projection, not a substitute receipt/file verifier.
export function histogramPreviewModel(file){
 const s=file?.snapshot,d=file?.definition;
 if(d?.type!=='histogram'||s?.coverage?.kind!=='aggregate'||s.coverage.aggregation?.kind!=='histogram')throw Error('PREVIEW_ENGINE_BINS_REQUIRED');
 if(!Array.isArray(d.histogramEdges)||d.histogramEdges.length>21)throw Error('PREVIEW_MAX_20_BINS');
 if(d.includeZero!==true)throw Error('PREVIEW_ZERO_BASELINE_REQUIRED');
 const m=ChartCore.project(s,d);if(m.histogram?.inputMode!=='engine-bins')throw Error('PREVIEW_ENGINE_BINS_REQUIRED');
 const counts=m.histogram.counts,maxCount=Math.max(0,...counts),scaleMax=Math.max(1,maxCount),left=Math.max(48,String(scaleMax).length*6+14),right=16,top=18,baseline=164;
 const slot=Math.max(64,String(scaleMax).length*6+12,...m.labels.map(v=>v.length*5+12)),width=Math.max(440,left+right+slot*counts.length),step=(width-left-right)/counts.length;
 const bars=counts.map((count,i)=>({count,label:m.labels[i],x:left+step*i+step*.17,width:step*.66,height:count/scaleMax*(baseline-top),y:baseline-count/scaleMax*(baseline-top),labelX:left+step*(i+.5)}));
 return {snapshotId:s.snapshotId,resultVersion:s.source.resultVersion,title:d.title,width,height:218,left,right,top,baseline,bars,ticks:[...new Set([0,Math.ceil(scaleMax/2),scaleMax])].map(value=>({value,y:baseline-value/scaleMax*(baseline-top)})),color:d.colors[0],light:d.appearance!=='dark',xLabel:d.xLabel+(m.histogram.unit?' ('+m.histogram.unit+')':''),yLabel:d.yLabel,totalCount:m.histogram.totalCount,numericCount:m.histogram.numericCount,nullCount:m.histogram.nullCount};
}
