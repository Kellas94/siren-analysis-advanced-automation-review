// Browser-safe identity guard only. No graph edits, SQL execution or DAG checks.
class GraphIdentityError extends TypeError {
  constructor(code,message,details={}){super(message);this.name='GraphIdentityError';this.code=code;this.details=details;}
}
const fail=(code,message,details)=>{throw new GraphIdentityError(code,message,details);};
const asciiFold=value=>value.replace(/[A-Z]/g,char=>char.toLowerCase());

export function nodeViewName(id){
  if(typeof id!=='string'||id.length===0)fail('GRAPH_NODE_ID_INVALID','Node ID must be a nonempty string.');
  // Keep the compiler's exact UTF-16 replacement and case-preserved spelling.
  return `view_${id.replace(/[^a-zA-Z0-9_]/g,'_')}`;
}

export function assertNodeViewIdentities(nodes){
  if(!Array.isArray(nodes))fail('GRAPH_NODE_LIST_INVALID','Nodes must be an array.');
  const ids=new Map(),views=new Map();
  for(let index=0;index<nodes.length;index++){
    const id=nodes[index]?.id;
    if(typeof id!=='string'||id.length===0)fail('GRAPH_NODE_ID_INVALID',`Node at index ${index} must have a nonempty string ID.`,{index});
    if(ids.has(id)){
      const previous=ids.get(id);
      fail('GRAPH_NODE_ID_DUPLICATE',`Duplicate node ID at indexes ${previous} and ${index}: ${JSON.stringify(id)}.`,{firstIndex:previous,index,id});
    }
    const viewName=nodeViewName(id),identity=asciiFold(viewName),previous=views.get(identity);
    if(previous){
      fail('GRAPH_NODE_VIEW_COLLISION',`Node IDs at indexes ${previous.index} and ${index} map to the same DuckDB view identity: ${JSON.stringify(previous.id)} and ${JSON.stringify(id)} -> ${JSON.stringify(previous.viewName)} / ${JSON.stringify(viewName)}.`,{firstIndex:previous.index,index,firstId:previous.id,id,firstViewName:previous.viewName,viewName});
    }
    ids.set(id,index);views.set(identity,{id,index,viewName});
  }
  return nodes;
}
