/**
 * SIREN Visual Builder — Graph & Semantic Validator
 * Enforces DAG acyclicity, type compatibility, parameter requirements, and stable references.
 */

import { NODE_TYPES, DATA_TYPES, SCHEMA_VERSION } from './schema.js';

export class ValidationError extends Error {
  constructor(code, message, details = {}) {
    super(`[${code}] ${message}`);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
  }
}

export function validateDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object') {
    throw new ValidationError('INVALID_DOC_STRUCTURE', 'Document must be a valid object');
  }

  if (doc.$schema !== SCHEMA_VERSION) {
    errors.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Expected schema "${SCHEMA_VERSION}", received "${doc.$schema}"`
    });
  }

  if (!doc.documentId || typeof doc.documentId !== 'string') {
    errors.push({ code: 'MISSING_DOC_ID', message: 'Document must have a valid string documentId' });
  }

  if (!doc.semantics || typeof doc.semantics !== 'object') {
    throw new ValidationError('MISSING_SEMANTICS', 'Document must include a semantics section');
  }

  const { nodes = [], connections = [], subflows = [] } = doc.semantics;
  if (!Array.isArray(nodes) || !Array.isArray(connections) || !Array.isArray(subflows)) {
    throw new ValidationError('INVALID_MODEL_COLLECTION', 'Nodes, connections and subflows must be arrays');
  }
  const nodeMap = new Map();
  const idRegex = /^[a-zA-Z0-9_-]+$/;

  // 1. Validate Nodes
  for (const node of nodes) {
    if (!node || typeof node !== 'object') { errors.push({code:'INVALID_NODE',message:'Node must be an object'}); continue; }
    if (!Object.values(NODE_TYPES).includes(node.type) || ['pivot','unpivot'].includes(node.type)) {
      errors.push({code:'UNSUPPORTED_NODE_TYPE',nodeId:node.id,message:`Node type ${node.type} has no executable generator`});
    }
    if (node.executable !== undefined && typeof node.executable !== 'boolean') errors.push({code:'INVALID_EXECUTABLE',nodeId:node.id,message:'executable must be boolean'});
    if (node.inputs !== undefined && !Array.isArray(node.inputs) || node.outputs !== undefined && !Array.isArray(node.outputs)) {
      errors.push({code:'INVALID_PORTS',nodeId:node.id,message:'Node ports must be arrays'}); continue;
    }
    if (!node.id || !idRegex.test(node.id)) {
      errors.push({
        code: 'INVALID_NODE_ID',
        nodeId: node.id,
        message: `Node ID "${node.id}" is invalid. Must match regex ^[a-zA-Z0-9_-]+$`
      });
      continue;
    }

    if (nodeMap.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        nodeId: node.id,
        message: `Duplicate node ID detected: "${node.id}"`
      });
    }
    nodeMap.set(node.id, node);

    // Validate parameters based on node type
    validateNodeParams(node, errors);
  }
  const pythonKeywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
  const reserved = new Set(['params','con','job_id','own_con','node_metrics','os','sys','time','json','duckdb','uuid']);
  for (const name of Object.keys(doc.semantics.parameters || {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || pythonKeywords.has(name) || reserved.has(name)) errors.push({code:'INVALID_PARAMETER_NAME',message:`Parameter ${name} is not a safe Python variable name`});
  }
  const subflowIds=new Set();
  for(const sf of subflows){
    if(!sf || typeof sf.id!=='string' || !idRegex.test(sf.id) || subflowIds.has(sf.id)) errors.push({code:'INVALID_SUBFLOW_ID',message:'Subflow IDs must be valid and unique'});
    else subflowIds.add(sf.id);
  }
  for(const n of nodes) if(n?.type===NODE_TYPES.SUBFLOW && !subflowIds.has(n.params?.subflowId)) errors.push({code:'MISSING_SUBFLOW',nodeId:n.id,message:'Referenced subflow is missing'});

  // 2. Validate Connections
  for (const conn of connections) {
    const srcNode = nodeMap.get(conn.sourceNode);
    const tgtNode = nodeMap.get(conn.targetNode);

    if (!srcNode) {
      errors.push({
        code: 'MISSING_SOURCE_NODE',
        connId: conn.id,
        message: `Connection references non-existent source node "${conn.sourceNode}"`
      });
      continue;
    }
    if (!tgtNode) {
      errors.push({
        code: 'MISSING_TARGET_NODE',
        connId: conn.id,
        message: `Connection references non-existent target node "${conn.targetNode}"`
      });
      continue;
    }

    // Check port existence
    const srcPort = (srcNode.outputs || []).find(p => p.id === conn.sourcePort);
    const tgtPort = (tgtNode.inputs || []).find(p => p.id === conn.targetPort);

    if (!srcPort) {
      errors.push({
        code: 'INVALID_SOURCE_PORT',
        connId: conn.id,
        nodeId: srcNode.id,
        message: `Source port "${conn.sourcePort}" not found on node "${srcNode.id}"`
      });
    }
    if (!tgtPort) {
      errors.push({
        code: 'INVALID_TARGET_PORT',
        connId: conn.id,
        nodeId: tgtNode.id,
        message: `Target port "${conn.targetPort}" not found on node "${tgtNode.id}"`
      });
    }

    // Check type compatibility
    if (srcPort && tgtPort) {
      if (
        srcPort.dataType !== DATA_TYPES.ANY &&
        tgtPort.dataType !== DATA_TYPES.ANY &&
        srcPort.dataType !== tgtPort.dataType
      ) {
        errors.push({
          code: 'TYPE_MISMATCH',
          connId: conn.id,
          message: `Incompatible types: port "${srcPort.id}" (${srcPort.dataType}) cannot connect to "${tgtPort.id}" (${tgtPort.dataType})`
        });
      }
    }
  }

  // 3. Cycle Detection on Executable DAG
  const executableNodes = nodes.filter(n => n && n.executable !== false && n.type !== NODE_TYPES.ANNOTATION);
  const execNodeIds = new Set(executableNodes.map(n => n.id));
  const inDegree = new Map();
  const adj = new Map();

  for (const nid of execNodeIds) {
    inDegree.set(nid, 0);
    adj.set(nid, []);
  }

  for (const conn of connections) {
    if (execNodeIds.has(conn.sourceNode) && execNodeIds.has(conn.targetNode)) {
      inDegree.set(conn.targetNode, inDegree.get(conn.targetNode) + 1);
      adj.get(conn.sourceNode).push(conn.targetNode);
    }
  }

  const queue = [];
  for (const [nid, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(nid);
  }

  const sorted = [];
  while (queue.length > 0) {
    const curr = queue.shift();
    sorted.push(curr);
    for (const neighbor of adj.get(curr)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== execNodeIds.size) {
    const cycleNodes = [];
    for (const [nid, deg] of inDegree.entries()) {
      if (deg > 0) cycleNodes.push(nid);
    }
    errors.push({
      code: 'DISALLOWED_CYCLE',
      message: `Cycle detected in executable DAG involving nodes: ${cycleNodes.join(', ')}`,
      cycleNodes
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    topologicalOrder: sorted
  };
}

function validateNodeParams(node, errors) {
  const p = node.params || {};

  switch (node.type) {
    case NODE_TYPES.INPUT:
      if (!p.path || typeof p.path !== 'string') {
        errors.push({ code: 'MISSING_PARAM', nodeId: node.id, param: 'path', message: 'Input node requires non-empty "path"' });
      }
      break;

    case NODE_TYPES.FILTER:
      if (!p.condition || typeof p.condition !== 'string') {
        errors.push({ code: 'MISSING_PARAM', nodeId: node.id, param: 'condition', message: 'Filter node requires non-empty SQL condition' });
      }
      break;

    case NODE_TYPES.JOIN:
      if (!p.leftKey || !p.rightKey) {
        errors.push({ code: 'MISSING_PARAM', nodeId: node.id, param: 'leftKey/rightKey', message: 'Join node requires leftKey and rightKey' });
      }
      break;

    case NODE_TYPES.EXPORT:
      if (!p.path || typeof p.path !== 'string') {
        errors.push({ code: 'MISSING_PARAM', nodeId: node.id, param: 'path', message: 'Export node requires non-empty export path' });
      }
      break;

    case NODE_TYPES.FOR_EACH:
      if (p.maxIterations !== undefined && (!Number.isSafeInteger(p.maxIterations) || p.maxIterations <= 0)) {
        errors.push({ code: 'INVALID_PARAM', nodeId: node.id, param: 'maxIterations', message: 'maxIterations must be a positive number' });
      }
      break;

    case NODE_TYPES.CUSTOM_PYTHON:
      if (p.code !== undefined && typeof p.code !== 'string') {
        errors.push({ code: 'INVALID_PARAM', nodeId: node.id, param: 'code', message: 'Custom Python code must be a string' });
      }
      break;
  }
}
