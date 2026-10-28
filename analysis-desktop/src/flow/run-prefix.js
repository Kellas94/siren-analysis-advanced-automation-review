// Explicit Run-to-node uses the existing runner and the exact authored ancestors.
// It never changes the saved/full workflow or creates a second execution engine.
export function executionPrefix(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges))throw Error('Missing workflow definition.');
  const byId=new Map();for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||byId.has(n.id))throw Error('Node identifiers must be unique.');byId.set(n.id,n);}
  if(!byId.has(nodeId))throw Error('Select an existing node.');
  const ids=new Set(),pending=[nodeId];
  while(pending.length){const id=pending.pop();if(ids.has(id))continue;if(!byId.has(id))throw Error('A connected upstream node is missing.');ids.add(id);for(const e of edges)if(e?.target===id){if(typeof e.source!=='string')throw Error('Invalid upstream connection.');pending.push(e.source);}}
  return {nodes:nodes.filter(n=>ids.has(n.id)),edges:edges.filter(e=>ids.has(e?.target))};
}
