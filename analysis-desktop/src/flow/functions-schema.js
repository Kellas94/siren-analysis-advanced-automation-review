import {getNodeSchema} from './schema.js';
import {executionPrefix} from './run-prefix.js';
export function lookupInputs(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges))throw Error('Missing workflow definition.');
  const ids=new Set();for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id))throw Error('Node identifiers must be unique.');ids.add(n.id);}
  if(nodes.find(n=>n.id===nodeId)?.type!=='lookup')throw Error('Select a Lookup node.');
  if(edges.some(e=>!e||typeof e.source!=='string'||typeof e.target!=='string'))throw Error('Invalid connection.');
  const links=edges.filter(e=>e.target===nodeId);
  if(links.length!==2||links.filter(e=>e.targetHandle==='left').length!==1||links.filter(e=>e.targetHandle==='right').length!==1)throw Error('Connect exactly one source to each Lookup port.');
  const leftId=links.find(e=>e.targetHandle==='left').source,rightId=links.find(e=>e.targetHandle==='right').source;
  for(const id of [leftId,rightId]){const n=nodes.find(n=>n.id===id);if(!n||id===nodeId||n.type==='export')throw Error('Choose existing upstream table outputs.');}
  return {leftId,rightId};
}
export function lookupInputsPrefix(nodes,edges,nodeId){
  const {leftId,rightId}=lookupInputs(nodes,edges,nodeId),a=executionPrefix(nodes,edges,leftId),b=executionPrefix(nodes,edges,rightId),ids=new Set([...a.nodes,...b.nodes].map(n=>n.id));
  if(ids.has(nodeId))throw Error('Lookup inputs contain a cycle.');
  return {nodes:nodes.filter(n=>ids.has(n.id)),edges:edges.filter(e=>ids.has(e.target))};
}
export function getLookupSchemas(context={}){
  try{
    const {nodes,edges,nodeId,view}=context,{leftId,rightId}=lookupInputs(nodes,edges,nodeId);lookupInputsPrefix(nodes,edges,nodeId);
    const left=getNodeSchema({...context,nodeId:leftId}),right=getNodeSchema({...context,nodeId:rightId});
    if(left.status!=='available'||right.status!=='available'||left.token.jobId!==right.token.jobId||left.token.view!==right.token.view)throw Error('Run Lookup inputs to capture both schemas in one current job.');
    return {status:'available',reason:'Both schemas belong to the same captured input job. No key cast is added.',left:{...left,sourceId:leftId},right:{...right,sourceId:rightId},token:{jobId:left.token.jobId,view,nodeId,key:JSON.stringify({left:left.token,right:right.token})}};
  }catch(error){return {status:'unavailable',reason:error.message||'Connect two valid Lookup inputs.'};}
}
export function sumInputPrefix(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.find(n=>n?.id===nodeId)?.type!=='conditional_sum')throw Error('Select a Conditional sum node.');
  const links=edges.filter(e=>e?.target===nodeId);if(links.length!==1)throw Error('Connect one Conditional sum input.');
  const prefix=executionPrefix(nodes,edges,links[0].source);if(prefix.nodes.some(n=>n.id===nodeId))throw Error('Conditional sum input contains a cycle.');return prefix;
}
export function getSumSchema(context={}){
  try{
    const {nodes,edges,nodeId}=context;sumInputPrefix(nodes,edges,nodeId);const upstreamId=edges.find(e=>e.target===nodeId).source,result=getNodeSchema({...context,nodeId:upstreamId});
    if(result.status!=='available')return result;
    return {...result,reason:'Columns from the captured Conditional sum input. External source bytes may change.',token:{...result.token,nodeId,upstreamId}};
  }catch(error){return {status:'unavailable',reason:error.message||'Run the Conditional sum input.',columns:[]};}
}

export function countInputPrefix(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.find(n=>n?.id===nodeId)?.type!=='conditional_count')throw Error('Select a Count node.');
  const links=edges.filter(e=>e?.target===nodeId);if(links.length!==1)throw Error('Connect one Count input.');
  const prefix=executionPrefix(nodes,edges,links[0].source);if(prefix.nodes.some(n=>n.id===nodeId))throw Error('Count input contains a cycle.');return prefix;
}
export function getCountSchema(context={}){
  try{
    const {nodes,edges,nodeId}=context;countInputPrefix(nodes,edges,nodeId);const upstreamId=edges.find(e=>e.target===nodeId).source,result=getNodeSchema({...context,nodeId:upstreamId});
    if(result.status!=='available')return result;
    return {...result,reason:'Columns from the captured Count input. External source bytes may change.',token:{...result.token,nodeId,upstreamId}};
  }catch(error){return {status:'unavailable',reason:error.message||'Run the Count input.',columns:[]};}
}
