import {visibleEdges} from './model.js';
import {executionPrefix} from './run-prefix.js';
import {getNodeSchema} from './schema.js';
const fail=reason=>({status:'unavailable',reason});

export function joinInputs(nodes,edges,nodeId){
  if(!Array.isArray(nodes)||!Array.isArray(edges))throw Error('Missing workflow definition.');
  const ids=new Set();for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id))throw Error('Node identifiers must be unique.');ids.add(n.id);}
  const join=nodes.find(n=>n.id===nodeId);if(join?.type!=='join'||!join.data)throw Error('Select a Join node.');
  if(edges.some(e=>!e||typeof e.source!=='string'||typeof e.target!=='string'))throw Error('Invalid workflow connection.');
  const links=visibleEdges(nodes,edges).filter(e=>e.target===nodeId);
  if(links.length!==2||links.filter(e=>e.targetHandle==='left').length!==1||links.filter(e=>e.targetHandle==='right').length!==1)throw Error('Connect exactly one source to each Join port.');
  const leftId=links.find(e=>e.targetHandle==='left').source,rightId=links.find(e=>e.targetHandle==='right').source;
  if(join.data.leftSourceNodeId!==undefined||join.data.rightSourceNodeId!==undefined){if(join.data.leftSourceNodeId!==leftId||join.data.rightSourceNodeId!==rightId)throw Error('Join source configuration differs from its ports. Reconnect explicitly.');}
  for(const id of [leftId,rightId]){const n=nodes.find(n=>n.id===id);if(!n||n.type==='export')throw Error('Choose existing upstream table outputs.');}
  return {leftId,rightId};
}

export function joinInputsPrefix(nodes,edges,nodeId){
  const {leftId,rightId}=joinInputs(nodes,edges,nodeId),left=executionPrefix(nodes,edges,leftId),right=executionPrefix(nodes,edges,rightId);
  const ids=new Set([...left.nodes,...right.nodes].map(n=>n.id));
  if(ids.has(nodeId))throw Error('Join inputs contain a cycle through this Join.');
  return {nodes:nodes.filter(n=>ids.has(n.id)),edges:edges.filter(e=>ids.has(e.target))};
}

export function getJoinSchemas(context){
  try{
    const {nodes,edges,nodeId,capture,view}=context,{leftId,rightId}=joinInputs(nodes,edges,nodeId);
    const left=getNodeSchema({...context,nodeId:leftId}),right=getNodeSchema({...context,nodeId:rightId});
    if(left.status!=='available'||right.status!=='available')return fail('Run Join inputs to capture both current input schemas. Manual keys remain editable.');
    if(left.token.jobId!==right.token.jobId||left.token.view!==right.token.view)return fail('Run both Join inputs in the same execution.');
    const prefix=joinInputsPrefix(nodes,edges,nodeId);
    // The existing graph validator owns full prefix validity at Run dispatch;
    // getNodeSchema already validates each captured dependency for choices.
    if(!prefix.nodes.length||capture.view!==view)return fail('Run Join inputs to capture its schema.');
    const key=JSON.stringify({left:left.token,right:right.token});
    return {status:'available',reason:'Keys from the last successful input run. No type conversion is added.',left:{...left,sourceId:leftId},right:{...right,sourceId:rightId},token:{jobId:left.token.jobId,view,nodeId,key}};
  }catch(error){return fail(error.message||'Connect two valid Join inputs.');}
}
