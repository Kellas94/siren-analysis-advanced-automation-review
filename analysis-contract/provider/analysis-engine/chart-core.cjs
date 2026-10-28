(function (root) {
  'use strict';
  const LIMITS = Object.freeze({bytes:5*1024*1024,rows:5000,categories:50,series:8,columns:32});
  const fail = (code, text) => {throw new Error(code + ': ' + text);};
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = v => typeof v === 'string' && v.length <= 1024;
  const clone = o => JSON.parse(JSON.stringify(o));
  function canonical(v) {
    if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
    if (object(v)) return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    return JSON.stringify(v);
  }
  async function hash(v) {
    const bytes = new TextEncoder().encode(canonical(v));
    return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function dateValid(v,type) {
    if (typeof v!=='string') return false;
    if (type==='month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && +v.slice(0,4)>=1900 && +v.slice(0,4)<=9999;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || +v.slice(0,4)<1900) return false;
    const d=new Date(v+'T00:00:00Z');return Number.isFinite(+d) && d.toISOString().slice(0,10)===v;
  }
  function numeric(v) {
    if (v===null) return null;
    if (typeof v==='number') {
      if (!Number.isFinite(v) || (Number.isInteger(v)&&!Number.isSafeInteger(v))) fail('PRECISION','Unsafe numeric coordinate. Request a scaled/aggregated result from Analysis.');
      return v;
    }
    if (typeof v!=='string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) fail('NUMBER','Expected decimal string, without locale separators or exponent.');
    const digits=v.replace('-','').replace('.','').replace(/^0+/,'').replace(/0+$/,'');
    if(digits.length>15) fail('PRECISION','More than 15 significant digits. Raw value retained; request explicit scaling in Analysis.');
    const n=Number(v);
    if(!Number.isFinite(n) || (n===0 && /[1-9]/.test(v)) || (Number.isInteger(n)&&!Number.isSafeInteger(n))) fail('PRECISION','Coordinate cannot be represented safely.');
    return n;
  }
  function validateSnapshot(s) {
    if(!object(s)||s.schemaVersion!=='siren.chart-data/1') fail('VERSION','Unsupported data contract.');
    if(new TextEncoder().encode(JSON.stringify(s)).length>LIMITS.bytes) fail('TOO_LARGE','5 MiB maximum; ask Analysis for a bounded result.');
    if(!str(s.snapshotId)||!s.snapshotId) fail('SNAPSHOT_ID','Required.');
    if(!Array.isArray(s.columns)||!s.columns.length||s.columns.length>LIMITS.columns) fail('COLUMNS','1..32 required.');
    const ids=new Set();
    for(const c of s.columns) {
      if(!object(c)||!str(c.id)||!/^\w[\w-]{0,63}$/.test(c.id)||['__proto__','constructor','prototype'].includes(c.id)||ids.has(c.id)) fail('COLUMN_ID','Invalid or duplicate.');
      ids.add(c.id);
      if(!str(c.label)||!['string','number','decimal','date','month','boolean'].includes(c.type)||!['dimension','measure','series'].includes(c.role)||typeof c.nullable!=='boolean'||!(c.unit===null||str(c.unit))) fail('COLUMN','Invalid metadata.');
      if(c.role==='measure'&&!['decimal','number'].includes(c.type)) fail('MEASURE_TYPE','Measures must be numeric.');
    }
    if(!Array.isArray(s.rows)||s.rows.length>LIMITS.rows) fail('TOO_MANY_ROWS','Maximum 5000; request aggregation/explicit selection from Analysis. No rows were removed.');
    const rowIds=new Set();
    for(const r of s.rows) {
      if(!object(r)||!str(r.id)||!r.id||rowIds.has(r.id)||!object(r.values)) fail('ROW','Unique row identity and values required.');
      rowIds.add(r.id);
      if(Object.keys(r.values).some(k=>!ids.has(k))) fail('UNKNOWN_COLUMN','Unexpected value key.');
      for(const c of s.columns) {
        if(!own(r.values,c.id)) {if(c.role==='measure') fail('MISSING_MEASURE',r.id+'/'+c.id);continue;}
        const v=r.values[c.id];
        if(v===null) {if(!c.nullable) fail('NULL',r.id+'/'+c.id);continue;}
        if(c.type==='decimal' && (typeof v!=='string'||! /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)||v.length>1024)) fail('DECIMAL','Decimal must be exact string.');
        if(c.type==='number' && (typeof v!=='number'||!Number.isFinite(v)|| (Number.isInteger(v)&&!Number.isSafeInteger(v)))) fail('PRECISION','Invalid number.');
        if(c.type==='string'&&!str(v)) fail('STRING','Expected bounded text.');
        if(c.type==='boolean'&&typeof v!=='boolean') fail('BOOLEAN','Expected boolean.');
        if(['date','month'].includes(c.type)&&!dateValid(v,c.type)) fail('DATE','Strict ISO date/month required, years 1900..9999.');
      }
    }
    const src=s.source,cov=s.coverage;
    if(!object(src)||!['sourceId','jobId','resultVersion','capturedAt'].every(k=>str(src[k])&&src[k])||!['current','outdated','missing','unknown'].includes(src.state)||!Number.isFinite(Date.parse(src.capturedAt))) fail('SOURCE','Identity/version/capture time/state required.');
    if(!object(cov)||!['complete','aggregate','sampled'].includes(cov.kind)||!['sourceRowCount','resultRowCount','transferredRows'].every(k=>Number.isSafeInteger(cov[k])&&cov[k]>=0)||cov.transferredRows!==s.rows.length||cov.resultRowCount<cov.transferredRows) fail('ROW_COUNT','Inconsistent coverage counts.');
    if(cov.kind!=='sampled'&&cov.resultRowCount!==cov.transferredRows) fail('ROW_COUNT','Complete/aggregate results must transfer every result row.');
    if(cov.kind==='sampled'&&(!object(cov.selection)||!str(cov.selection.method)||!str(cov.selection.description)||!cov.selection.method||!cov.selection.description)) fail('SELECTION','Sampling method and explanation required.');
    if(cov.kind==='aggregate'&&(!object(cov.aggregation)||!str(cov.aggregation.description)||!cov.aggregation.description)) fail('AGGREGATION','Engine aggregation declaration required.');
    return s;
  }
  function defaultDefinition(s) {
    const dims=s.columns.filter(c=>c.role==='dimension');const x=dims.find(c=>['date','month'].includes(c.type))||dims[0]||s.columns[0];
    return {schemaVersion:'siren.chart/1',id:'chart-'+s.snapshotId,type:'bar',title:'Rezultate vizuale',x:x.id,y:s.columns.filter(c=>c.role==='measure').slice(0,2).map(c=>c.id),seriesBy:null,xLabel:x.label,yLabel:'Valoare',xUnitLabel:'',yUnitLabel:'',legend:true,colors:['#60a5fa','#fbbf24','#34d399','#f472b6','#a78bfa','#fb923c','#22d3ee','#e879f9'],decimals:2,includeZero:true,histogramEdges:['-10','0','10','20','30'],appearance:'dark'};
  }
  function validateDefinition(s,d) {
    const allowed=Object.keys(defaultDefinition(s));
    if(!object(d)||Object.keys(d).some(k=>!allowed.includes(k))) fail('UNKNOWN','Unknown chart definition field.');
    if(d.schemaVersion!=='siren.chart/1') fail('VERSION','Unsupported chart definition.');
    if(!['bar','line','scatter','histogram'].includes(d.type)||!['id','title','x','xLabel','yLabel','xUnitLabel','yUnitLabel'].every(k=>str(d[k]))||!d.id) fail('DEFINITION','Invalid chart fields.');
    if(!Array.isArray(d.y)||!d.y.length||d.y.length>8||new Set(d.y).size!==d.y.length) fail('SERIES','Select 1..8 different measures.');
    if(!Array.isArray(d.colors)||!d.colors.length||d.colors.length>8||d.colors.some(x=>typeof x!=='string'||!/^#[\da-f]{6}$/i.test(x))) fail('COLOR','Use six-digit hex colors.');
    if(!Array.isArray(d.histogramEdges)||d.histogramEdges.length<2||d.histogramEdges.length>51||d.histogramEdges.some(x=>typeof x!=='string'||x.length>1024||! /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(x)))fail('DEFINITION_EDGES','Required bounded decimal-string edge list missing or invalid. Current chart retained.');
    if(typeof d.legend!=='boolean'||typeof d.includeZero!=='boolean'||!['dark','light'].includes(d.appearance)||!Number.isInteger(d.decimals)||d.decimals<0||d.decimals>8) fail('DISPLAY','Invalid legend/axes/decimal/appearance settings.');
    const columns=new Map(s.columns.map(c=>[c.id,c]));
    if(!columns.has(d.x)||d.y.some(k=>!columns.has(k)||columns.get(k).role!=='measure')) fail('COLUMN','Unknown axis or measure.');
    if(d.seriesBy!==null && (!columns.has(d.seriesBy)||columns.get(d.seriesBy).role!=='series'||d.type!=='scatter')) fail('SERIES_BY','Long-form grouping is available for scatter. Use separate measure columns for grouped bars.');
    if(d.type==='line'&&!['date','month'].includes(columns.get(d.x).type)) fail('TIME_AXIS','Select a typed ISO date/month column. Text month names require engine normalization.');
    if(d.type==='scatter'&&(!['number','decimal'].includes(columns.get(d.x).type)||d.y.length!==1)) fail('SCATTER','Select numeric X and one Y measure.');
    if(d.type==='histogram'&&d.y.length!==1) fail('HISTOGRAM','Select one observation measure.');
    const units=new Set(d.y.map(k=>columns.get(k).unit));
    if(units.size>1) fail('MIXED_UNITS','Y measures have different units, including unknown. Choose a common unit in Analysis or separate charts.');
    if(d.yUnitLabel && d.yUnitLabel!==(columns.get(d.y[0]).unit||'')) fail('UNIT_LABEL','Unit label must equal source unit; conversion belongs to Analysis.');
    if(d.xUnitLabel && d.xUnitLabel!==(columns.get(d.x).unit||'')) fail('UNIT_LABEL','X unit must equal source unit; no implicit conversion.');
    return columns;
  }
  function cellLabel(r,k) {
    if(!own(r.values,k))return '⟨missing category⟩';
    const v=r.values[k];return v===null?'⟨NULL⟩':v===''?'⟨empty string⟩':String(v).startsWith('⟨')?JSON.stringify(String(v))+' (text)':String(v);
  }
  function exactCompare(a,b){
    function parts(v){const match=String(v).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);if(!match)fail('DECIMAL','Cannot compare exact decimal.');const scale=(match[3]||'').length-Number(match[4]||0);return {n:BigInt((match[1]||'')+match[2]+(match[3]||'')),scale};}
    const x=parts(a),y=parts(b),scale=Math.max(x.scale,y.scale);const nx=x.n*10n**BigInt(scale-x.scale),ny=y.n*10n**BigInt(scale-y.scale);return nx<ny?-1:nx>ny?1:0;
  }
  function project(s,d) {
    validateSnapshot(s); const columns=validateDefinition(s,d),notices=[];
    if(s.coverage.kind==='sampled') notices.push('sampled: '+s.coverage.selection.description+' This chart is not a population total.');
    if(s.coverage.kind==='aggregate') notices.push('aggregate: '+s.coverage.aggregation.description);
    notices.push('No implicit aggregation. Decimal strings remain exact in the table/saved file; chart coordinates use binary floating point. Display rounding: '+d.decimals+' decimals only.');
    if(d.y.some(k=>columns.get(k).unit===null)) notices.push('Unit unknown in source. No currency or unit has been inferred.');
    const base={type:d.type,title:d.title,labels:[],series:[],rowIds:[],notices,empty:s.rows.length===0,xUnit:columns.get(d.x).unit,yUnit:columns.get(d.y[0]).unit,xType:columns.get(d.x).type,omittedCoordinates:0};
    if(!s.rows.length) {notices.push('Empty result: zero rows, no zero-valued observation was invented.');return base;}
    if(d.type==='histogram') {
      if(!Array.isArray(d.histogramEdges)||d.histogramEdges.length<2||d.histogramEdges.length>51)fail('BINS','2..51 explicit edges required.');
      const edges=d.histogramEdges.map(numeric);
      if(edges.some((n,i)=>n===null||(i&&n<=edges[i-1])))fail('BINS','Strictly increasing numeric edges required.');
      const agg=s.coverage.aggregation;
      if(s.coverage.kind==='aggregate'&&agg.kind==='histogram'){
        const {binStartColumn:start,binEndColumn:end,countColumn:count}=agg;
        if(!columns.has(start)||!columns.has(end)||!columns.has(count)||!['decimal','number'].includes(columns.get(start).type)||!['decimal','number'].includes(columns.get(end).type)||d.y[0]!==count||columns.get(count).unit!=='count'||!(agg.unit===null||str(agg.unit))||columns.get(start).unit!==agg.unit||columns.get(end).unit!==agg.unit||agg.closure!=='[left, right), final bin [left, right]')fail('ENGINE_BINS','Invalid typed engine histogram metadata.');
        if(s.rows.length!==edges.length-1)fail('ENGINE_BINS','Cannot rebucket engine counts in the renderer. Request new bins from Analysis.');
        const counts=s.rows.map((r,i)=>{if(exactCompare(r.values[start],d.histogramEdges[i])!==0||exactCompare(r.values[end],d.histogramEdges[i+1])!==0)fail('ENGINE_BINS','Rows/edges must match exactly in engine order.');const n=numeric(r.values[count]);if(!Number.isSafeInteger(n)||n<0)fail('BIN_COUNT','Nonnegative integer counts required.');return n;});
        const counted=counts.reduce((a,b)=>a+b,0);
        if(!['numericCount','nullCount','totalCount'].every(k=>Number.isSafeInteger(agg[k])&&agg[k]>=0)||!Number.isSafeInteger(counted)||counted!==agg.numericCount||counted+agg.nullCount!==agg.totalCount)fail('BIN_COUNT','Counts and NULL total do not reconcile.');
        base.labels=counts.map((_,i)=>'['+d.histogramEdges[i]+', '+d.histogramEdges[i+1]+(i===counts.length-1?']':')'));
        base.series=[{name:'Observații',values:counts,raw:counts.map(String)}];base.histogram={edges:clone(d.histogramEdges),counts,numericCount:agg.numericCount,nullCount:agg.nullCount,totalCount:agg.totalCount,counted,closure:agg.closure,inputMode:'engine-bins',unit:agg.unit};
        notices.push('Engine bins: '+counted+' numeric observations + '+agg.nullCount+' NULL = '+agg.totalCount+'. '+s.rows.length+' bin rows transferred; no renderer rebucketing.');return base;
      }
      const counts=Array(edges.length-1).fill(0);let nullCount=0,out=0;
      for(const r of s.rows) {
        const n=numeric(r.values[d.y[0]]);if(n===null){nullCount++;continue;}
        const raw=r.values[d.y[0]];
        let i=edges.findIndex((a,j)=>j<edges.length-1 && exactCompare(raw,d.histogramEdges[j])>=0 && (exactCompare(raw,d.histogramEdges[j+1])<0||(j===edges.length-2 && exactCompare(raw,d.histogramEdges[j+1])===0)));
        if(i<0)out++;else counts[i]++;
      }
      if(out)fail('OUT_OF_RANGE',out+' observations outside explicit edges. Extend bins or request a declared selection; no chart exported.');
      base.labels=counts.map((_,i)=>'['+d.histogramEdges[i]+', '+d.histogramEdges[i+1]+(i===counts.length-1?']':')'));
      base.series=[{name:'Observații',values:counts,raw:counts.map(String)}];
      base.histogram={edges:clone(d.histogramEdges),counts,numericCount:s.rows.length-nullCount,nullCount,totalCount:s.rows.length,counted:counts.reduce((a,b)=>a+b,0),closure:'[left, right), final bin [left, right]'};
      notices.push('Histogram: '+base.histogram.numericCount+' numeric observations; '+nullCount+' NULL; '+base.histogram.counted+' counted. Intervals left closed/right open; last right closed. NULL is not zero.');
      return base;
    }
    if(d.type==='scatter') {
      const groups=new Map();
      for(const r of s.rows) {
        if(!own(r.values,d.x))fail('MISSING_X','Coordinate absent: '+r.id);
        const x=numeric(r.values[d.x]),y=numeric(r.values[d.y[0]]);
        if(x===null||y===null){base.omittedCoordinates++;continue;}
        const name=d.seriesBy?cellLabel(r,d.seriesBy):columns.get(d.y[0]).label;
        if(!groups.has(name))groups.set(name,{name,values:[],raw:[],rowIds:[]});
        const g=groups.get(name);g.values.push([x,y]);g.raw.push([r.values[d.x],r.values[d.y[0]]]);g.rowIds.push(r.id);
      }
      if(groups.size>LIMITS.series)fail('TOO_MANY_SERIES','Maximum 8. Request explicit selection in Analysis.');
      base.series=[...groups.values()];base.rowIds=s.rows.map(r=>r.id);
      notices.push(base.omittedCoordinates+' rows have NULL coordinates and cannot be positioned. All rows remain in the table and saved snapshot.');
      return base;
    }
    if(s.rows.length>LIMITS.categories)fail('TOO_MANY_CATEGORIES','Maximum 50 plotted categories/time points. Request an explicit aggregation/selection in Analysis; all input rows retained.');
    let rows=[...s.rows];
    if(d.type==='line') {
      if(rows.some(r=>!own(r.values,d.x)||r.values[d.x]===null))fail('MISSING_TIME','NULL/absent time cannot be positioned. Resolve explicitly in Analysis.');
      if(new Set(rows.map(r=>r.values[d.x])).size!==rows.length)fail('DUPLICATE_TIME','More than one row at a time. Request explicit aggregation or separate series columns.');
    }
    if(['month','date'].includes(columns.get(d.x).type)){
      rows.sort((a,b)=>{const av=a.values[d.x],bv=b.values[d.x];if(av==null)return bv==null?0:1;if(bv==null)return -1;return av.localeCompare(bv);});
      notices.push('Typed time sorted chronologically (UTC), absent/NULL categories last for bars; original order retained in the table/snapshot. Line NULL measures create gaps, never interpolated.');
    }
    const labels=rows.map(r=>cellLabel(r,d.x)),duplicates=new Set(labels.filter((x,i)=>labels.indexOf(x)!==i));
    base.labels=labels.map((x,i)=>duplicates.has(x)?x+' · '+rows[i].id:x);
    if(duplicates.size)notices.push('duplicate categories preserved as separate row slots, labelled with row ID; no sum or deduplication.');
    base.rowIds=rows.map(r=>r.id);
    base.series=d.y.map(k=>({name:columns.get(k).label,values:rows.map(r=>numeric(r.values[k])),raw:rows.map(r=>r.values[k])}));
    const nulls=base.series.reduce((n,a)=>n+a.values.filter(v=>v===null).length,0);
    base.nullMeasureCells=nulls;
    notices.push(nulls+' NULL measure cells: unplotted gaps. Zero/negative values remain valid observations.');
    return base;
  }
  function sourceState(s,receipt) {
    if(!receipt)return 'unknown';
    if(receipt.schemaVersion!=='siren.chart-source-status/1'||receipt.sourceId!==s.source.sourceId||receipt.jobId!==s.source.jobId)fail('SOURCE_ID','Status receipt does not match source/job.');
    if(!['available','missing'].includes(receipt.availability)||!str(receipt.resultVersion)||!Number.isFinite(Date.parse(receipt.checkedAt)))fail('SOURCE_STATUS','Invalid status receipt.');
    if(receipt.availability==='missing')return 'missing';
    return receipt.resultVersion===s.source.resultVersion?'current':'outdated';
  }
  async function pack(snapshot,definition) {
    validateSnapshot(snapshot);validateDefinition(snapshot,definition);
    const payload={schemaVersion:'siren.chart-file/1',engine:{name:'Apache ECharts',version:'6.1.0'},snapshot:clone(snapshot),definition:clone(definition),snapshotSha256:await hash(snapshot)};
    const bundle={...payload,integritySha256:await hash(payload)};
    if(new TextEncoder().encode(JSON.stringify(bundle,null,2)).length>LIMITS.bytes)fail('TOO_LARGE','Complete saved envelope exceeds 5 MiB. No partial file generated.');
    return bundle;
  }
  async function unpack(text) {
    if(typeof text!=='string'||new TextEncoder().encode(text).length>LIMITS.bytes)fail('TOO_LARGE','Maximum 5 MiB.');
    let b;try{b=JSON.parse(text);}catch{fail('JSON','Invalid JSON; current chart retained.');}
    if(!object(b)||b.schemaVersion!=='siren.chart-file/1')fail('VERSION','Unsupported saved chart.');
    const {integritySha256,...payload}=b;
    if(await hash(payload)!==integritySha256 || await hash(b.snapshot)!==b.snapshotSha256)fail('HASH','Saved chart data or definition changed.');
    validateSnapshot(b.snapshot);validateDefinition(b.snapshot,b.definition);return b;
  }
  const api={LIMITS,canonical,hash,clone,validateSnapshot,defaultDefinition,validateDefinition,project,pack,unpack,sourceState,numeric,cellLabel};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ChartCore=api;
})(globalThis);
