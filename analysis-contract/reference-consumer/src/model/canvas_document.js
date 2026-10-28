import {createEmptyDocument,createSemanticNode,NODE_TYPES} from './schema.js';

const clone = value => JSON.parse(JSON.stringify(value));

// Retain the loaded envelope as the authority for fields the canvas does not edit.
export function serializeCanvasDocument(metadata, nodes, edges) {
  const original = clone(metadata.sourceDocument || createEmptyDocument(metadata.name, metadata.description));
  const doc = {...clone(metadata.unsupportedElements || {}), ...original,
    documentId:metadata.documentId, name:metadata.name, description:metadata.description,
    version:metadata.version, createdAt:metadata.createdAt, updatedAt:new Date().toISOString()};
  const oldNodes = new Map((original.semantics.nodes || []).map(n=>[n.id,n]));
  const oldEdges = new Map((original.semantics.connections || []).map(e=>[e.id,e]));
  const types = new Map(nodes.map(n=>[n.id,n.type]));
  doc.semantics = {...original.semantics,
    parameters:clone(metadata.parameters || {}), subflows:clone(metadata.subflows || []),
    nodes:nodes.map(n=>{
      const {label,doc:nodeDoc,inputs,outputs,executable,status,rowCount,elapsedMs,...params}=n.data || {};
      const old=oldNodes.get(n.id) || {};
      return {...old,...createSemanticNode({id:n.id,type:n.type,name:label ?? n.id,doc:nodeDoc ?? '',
        params:{...(old.params||{}),...params},inputs,outputs,executable})};
    }),
    connections:edges.map(e=>({...oldEdges.get(e.id),id:e.id,sourceNode:e.source,
      sourcePort:e.sourceHandle ?? (types.get(e.source)===NODE_TYPES.IF_ELSE?'then':'out'),
      targetNode:e.target,targetPort:e.targetHandle ?? (types.get(e.target)===NODE_TYPES.JOIN?'left':'in')}))};
  doc.layout={...original.layout,
    viewport:clone(metadata.viewport || {x:0,y:0,zoom:1}),
    visualAnnotations:clone(metadata.visualAnnotations || []),
    nodeLayouts:Object.fromEntries(nodes.map(n=>[n.id,{...(original.layout?.nodeLayouts?.[n.id] || {}),
      x:n.position.x,y:n.position.y,...(n.style?{style:clone(n.style)}:{}),
      ...(n.width!==undefined?{width:n.width}:{}),...(n.height!==undefined?{height:n.height}:{})}]))};
  return doc;
}

