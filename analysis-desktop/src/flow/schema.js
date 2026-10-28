// Schema choices describe a captured upstream run, never the current file on disk.
const runtime = new Set(['label','status','preview','rowCount','isOutdated']);
const upstreamTypes = new Set(['input','select','derive','filter','join','lookup','conditional_sum','conditional_count','aggregate','pivot','unpivot']);
const unavailable = reason => ({status:'unavailable',reason,columns:[]});
// DuckDB identifiers fold ASCII letters, including quoted names. Unicode case
// folding would wrongly conflate distinct columns such as Ä and ä.
const identifier = name => name.replace(/[A-Z]/g,c=>c.toLowerCase());
export const sameColumnName = (a,b) => typeof a==='string'&&typeof b==='string'&&identifier(a)===identifier(b);
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Invalid definition');
  if (value !== undefined && !['string','number','boolean','object'].includes(typeof value)) throw Error('Invalid definition');
  return value;
};

function dependency(nodes,edges,upstreamId) {
  if (!Array.isArray(nodes)||!Array.isArray(edges)) throw Error('Missing definition');
  const byId=new Map(),incoming=new Map();
  for(const n of nodes){
    if(!n||typeof n.id!=='string'||!n.id||byId.has(n.id))throw Error('Invalid node identity');
    byId.set(n.id,n);
  }
  for(const e of edges){
    if(!e||typeof e.source!=='string'||typeof e.target!=='string')throw Error('Invalid connection');
    if(!incoming.has(e.target))incoming.set(e.target,[]);
    incoming.get(e.target).push(e);
  }
  const seen=new Set(),pending=[upstreamId],selectedNodes=[],selectedEdges=[];
  while(pending.length){
    const id=pending.pop();if(seen.has(id))continue;seen.add(id);
    const n=byId.get(id);
    if(!n||!upstreamTypes.has(n.type)||!n.data||typeof n.data!=='object'||Array.isArray(n.data))throw Error('Missing or unsupported upstream node');
    const links=incoming.get(id)||[],expected=n.type==='input'?0:['join','lookup'].includes(n.type)?2:1;
    if(links.length!==expected)throw Error('Ambiguous upstream connections');
    let resolved=links.map(e=>({source:e.source,target:e.target,targetHandle:e.targetHandle??null}));
    if(['join','lookup'].includes(n.type)){
      // Preserve the existing compiler's legacy left/right mapping, including order.
      if(n.type==='join'&&resolved.every(e=>e.targetHandle===null)){
        const {leftSourceNodeId:left,rightSourceNodeId:right}=n.data;
        if(left&&right&&left!==right)resolved=resolved.map(e=>({...e,targetHandle:e.source===left?'left':e.source===right?'right':null}));
        else resolved=resolved.map((e,i)=>({...e,targetHandle:i===0?'left':'right'}));
      }
      if(resolved.filter(e=>e.targetHandle==='left').length!==1||resolved.filter(e=>e.targetHandle==='right').length!==1)throw Error('Ambiguous Join ports');
      if(n.data.leftSourceNodeId!==undefined||n.data.rightSourceNodeId!==undefined){
        if(n.data.leftSourceNodeId!==resolved.find(e=>e.targetHandle==='left').source||n.data.rightSourceNodeId!==resolved.find(e=>e.targetHandle==='right').source)throw Error('Join sources differ from ports');
      }
    }
    selectedNodes.push({id,type:n.type,data:Object.fromEntries(Object.entries(n.data).filter(([k])=>!runtime.has(k)))});
    selectedEdges.push(...resolved);pending.push(...links.map(e=>e.source));
  }
  // A topological count rejects cycles without recursive graph traversal.
  const degree=new Map([...seen].map(id=>[id,0])),children=new Map();
  for(const e of selectedEdges){degree.set(e.target,degree.get(e.target)+1);if(!children.has(e.source))children.set(e.source,[]);children.get(e.source).push(e.target);}
  const ready=[...degree].filter(([,n])=>n===0).map(([id])=>id);let count=0;
  while(ready.length){const id=ready.pop();count++;for(const child of children.get(id)||[]){degree.set(child,degree.get(child)-1);if(degree.get(child)===0)ready.push(child);}}
  if(count!==seen.size)throw Error('Upstream cycle');
  selectedNodes.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  selectedEdges.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  return JSON.stringify(stable({nodes:selectedNodes,edges:selectedEdges}));
}

export function getSelectSchema({nodes,edges,nodeId,capture,view}={}) {
  if(!capture||typeof capture.jobId!=='string'||!capture.jobId.trim()||!Number.isSafeInteger(view)||view<0||capture.view!==view)return unavailable('Run this workflow to capture its upstream schema.');
  try{
    if(!Array.isArray(nodes)||!Array.isArray(edges))return unavailable('Connect one upstream node.');
    const target=nodes.find(n=>n?.id===nodeId),links=edges.filter(e=>e?.target===nodeId);
    if(target?.type!=='select'||links.length!==1)return unavailable('Connect one upstream node.');
    const upstreamId=links[0].source,upstream=nodes.find(n=>n?.id===upstreamId);
    if(upstream?.data?.status!=='completed'||upstream.data.isOutdated!==false)return unavailable('Run again after changing the upstream workflow.');
    const key=dependency(nodes,edges,upstreamId);
    if(key!==dependency(capture.definition?.nodes,capture.definition?.edges,upstreamId))return unavailable('Run again after changing the upstream workflow.');
    const schema=Object.hasOwn(capture.schemas||{},upstreamId)?capture.schemas[upstreamId]:null;
    if(!Array.isArray(schema)||!schema.length)return unavailable('The captured run has no usable upstream schema.');
    const names=new Set(),columns=[];
    for(const c of schema){
      if(!c||typeof c.name!=='string'||!c.name.trim()||typeof c.type!=='string'||!c.type.trim()||names.has(identifier(c.name))||
         (c.columnName!==undefined&&c.columnName!==c.name)||(c.columnType!==undefined&&c.columnType!==c.type))return unavailable('The captured upstream schema is ambiguous.');
      names.add(identifier(c.name));columns.push({name:c.name,type:c.type});
    }
    return {status:'available',reason:'Columns from the last successful upstream run.',columns,token:{jobId:capture.jobId,view,upstreamId,key}};
  }catch{return unavailable('Run a valid connected workflow to capture its upstream schema.');}
}

// Inspection binds the selected output itself (not a downstream editor's input).
export function getNodeSchema({nodes,edges,nodeId,capture,view}={}) {
  if(!capture||typeof capture.jobId!=='string'||!capture.jobId.trim()||!Number.isSafeInteger(view)||view<0||capture.view!==view)return unavailable('Run this workflow to inspect its table.');
  try{
    const node=nodes?.find(n=>n?.id===nodeId);
    if(node?.data?.status!=='completed'||node.data.isOutdated!==false)return unavailable('Run again after changing this output.');
    const key=dependency(nodes,edges,nodeId);
    if(key!==dependency(capture.definition?.nodes,capture.definition?.edges,nodeId))return unavailable('Run again after changing this output.');
    const schema=Object.hasOwn(capture.schemas||{},nodeId)?capture.schemas[nodeId]:null;
    if(!Array.isArray(schema)||!schema.length)return unavailable('The captured output has no usable schema.');
    const names=new Set(),columns=[];
    for(const c of schema){
      if(!c||typeof c.name!=='string'||!c.name.trim()||typeof c.type!=='string'||!c.type.trim()||names.has(identifier(c.name))||(c.columnName!==undefined&&c.columnName!==c.name)||(c.columnType!==undefined&&c.columnType!==c.type))return unavailable('The captured output schema is ambiguous.');
      names.add(identifier(c.name));columns.push({name:c.name,type:c.type});
    }
    return {status:'available',columns,token:{jobId:capture.jobId,view,nodeId,key}};
  }catch{return unavailable('Run a valid workflow to inspect its table.');}
}
