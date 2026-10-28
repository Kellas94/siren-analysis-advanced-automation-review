function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}

export function computeLogicRevision(semantics) {
  if(!semantics)return '0';
  const nodes=(semantics.nodes||[]).filter(n=>n.executable!==false&&n.type!=='annotation').map(n=>({id:n.id,type:n.type,inputs:n.inputs||[],outputs:n.outputs||[],params:n.params||{}})).sort((a,b)=>a.id.localeCompare(b.id));
  const ids=new Set(nodes.map(n=>n.id));
  const connections=(semantics.connections||[]).filter(c=>ids.has(c.sourceNode)&&ids.has(c.targetNode)).map(c=>({id:c.id,sourceNode:c.sourceNode,sourcePort:c.sourcePort,targetNode:c.targetNode,targetPort:c.targetPort})).sort((a,b)=>a.id.localeCompare(b.id));
  return canonical({logicVersion:semantics.logicVersion,parameters:semantics.parameters||{},subflows:semantics.subflows||[],nodes,connections});
}
