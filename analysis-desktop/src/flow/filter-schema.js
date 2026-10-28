import {getNodeSchema} from './schema.js';
import {executionPrefix} from './run-prefix.js';
export function filterInput(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.find(n=>n?.id===nodeId)?.type!=='filter')throw Error('Select a Filter node.');
  const links=edges.filter(e=>e?.target===nodeId);
  if(links.length!==1||typeof links[0].source!=='string'||links[0].source===nodeId)throw Error('Connect exactly one Filter input.');
  return links[0].source;
}
export function filterInputPrefix(nodes,edges,nodeId){
  const input=filterInput(nodes,edges,nodeId),prefix=executionPrefix(nodes,edges,input);
  if(prefix.nodes.some(n=>n.id===nodeId))throw Error('Filter input contains a cycle.');
  return prefix;
}
export function getFilterSchema(context={}){
  try{
    const {nodes,edges,nodeId}=context,input=filterInput(nodes,edges,nodeId);
    filterInputPrefix(nodes,edges,nodeId);
    const schema=getNodeSchema({...context,nodeId:input});
    if(schema.status!=='available')return schema;
    return {...schema,reason:'Columns from the captured Filter input. Source files can change outside this app.',token:{...schema.token,nodeId,upstreamId:input}};
  }catch{return {status:'unavailable',reason:'Connect one valid input and run it to capture its schema.',columns:[]};}
}
