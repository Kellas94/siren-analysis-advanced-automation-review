import {getNodeSchema} from './schema.js';
import {executionPrefix} from './run-prefix.js';
function input(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.find(n=>n?.id===nodeId)?.type!=='derive')throw Error('Select a New columns node.');
  const links=edges.filter(e=>e?.target===nodeId);
  if(links.length!==1||typeof links[0].source!=='string'||links[0].source===nodeId)throw Error('Connect one New columns input.');
  return links[0].source;
}
export function derivedInputPrefix(nodes,edges,nodeId){
  const prefix=executionPrefix(nodes,edges,input(nodes,edges,nodeId));
  if(prefix.nodes.some(n=>n.id===nodeId))throw Error('New columns input contains a cycle.');
  return prefix;
}
export function getDerivedSchema(context={}){
  try{
    const {nodes,edges,nodeId}=context,upstreamId=input(nodes,edges,nodeId);derivedInputPrefix(nodes,edges,nodeId);
    const schema=getNodeSchema({...context,nodeId:upstreamId});
    if(schema.status!=='available')return schema;
    return {...schema,reason:'Columns from the captured New columns input. Source files can change outside this app.',token:{...schema.token,nodeId,upstreamId}};
  }catch{return {status:'unavailable',reason:'Connect one valid input and run it to capture its schema.',columns:[]};}
}
