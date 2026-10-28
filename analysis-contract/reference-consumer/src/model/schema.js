/**
 * SIREN Visual Builder — Intermediate Model Schema (v1.0.0)
 * Contract: "siren.visual-builder/1.0.0"
 *
 * Strictly separates:
 * 1. LAYOUT (visual positions, zoom, annotations, decorative notes/arrows)
 * 2. SEMANTICS (program logic, node types, typed ports, params, connections, control flow)
 */

export const SCHEMA_VERSION = 'siren.visual-builder/1.0.0';
export const LOGIC_VERSION = '1.0.0';

export const NODE_TYPES = {
  // Dataflow Nodes
  INPUT: 'input',
  SELECT: 'select',
  FILTER: 'filter',
  JOIN: 'join',
  AGGREGATE: 'aggregate',
  PIVOT: 'pivot',
  UNPIVOT: 'unpivot',
  EXPORT: 'export',
  
  // Structured Control Flow Nodes
  IF_ELSE: 'if_else',
  FOR_EACH: 'for_each',
  SUBFLOW: 'subflow',
  CUSTOM_PYTHON: 'custom_python',
  
  // Purely Descriptive (Non-executable)
  ANNOTATION: 'annotation'
};

export const DATA_TYPES = {
  DATASET: 'dataset',
  SCALAR_NUMBER: 'number',
  SCALAR_STRING: 'string',
  SCALAR_BOOLEAN: 'boolean',
  COLLECTION: 'collection',
  ANY: 'any'
};

/**
 * Creates an empty, pristine Visual Builder document conforming to schema v1.0.0
 */
export function createEmptyDocument(name = 'New Workflow', description = '') {
  const docId = `vb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    $schema: SCHEMA_VERSION,
    documentId: docId,
    name,
    description,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1.0 },
      nodeLayouts: {},
      visualAnnotations: []
    },
    semantics: {
      logicVersion: LOGIC_VERSION,
      parameters: {},
      nodes: [],
      connections: [],
      subflows: []
    }
  };
}

/**
 * Helper to create a semantic node with stable ID and typed ports
 */
export function createSemanticNode({
  id,
  type,
  name,
  doc = '',
  params = {},
  inputs,
  outputs,
  executable,
  ...extensions
}) {
  if (!id || typeof id !== 'string') {
    throw new Error('Node id must be a non-empty string');
  }
  if (!Object.values(NODE_TYPES).includes(type)) {
    throw new Error(`Unsupported node type: ${type}`);
  }

  // Default port configuration based on node type if omitted
  const resolvedInputs = inputs === undefined ? [] : [...inputs];
  const resolvedOutputs = outputs === undefined ? [] : [...outputs];

  if (inputs === undefined && type !== NODE_TYPES.INPUT && type !== NODE_TYPES.ANNOTATION) {
    if (type === NODE_TYPES.JOIN) {
      resolvedInputs.push(
        { id: 'left', name: 'Left Dataset', dataType: DATA_TYPES.DATASET },
        { id: 'right', name: 'Right Dataset', dataType: DATA_TYPES.DATASET }
      );
    } else if (type === NODE_TYPES.IF_ELSE) {
      resolvedInputs.push(
        { id: 'in', name: 'Input Dataset', dataType: DATA_TYPES.DATASET },
        { id: 'condition', name: 'Branch Condition', dataType: DATA_TYPES.SCALAR_BOOLEAN }
      );
    } else if (type === NODE_TYPES.FOR_EACH) {
      resolvedInputs.push(
        { id: 'in', name: 'Input Dataset', dataType: DATA_TYPES.DATASET },
        { id: 'items', name: 'Items Collection', dataType: DATA_TYPES.COLLECTION }
      );
    } else {
      resolvedInputs.push({ id: 'in', name: 'Input', dataType: DATA_TYPES.DATASET });
    }
  }

  if (outputs === undefined && type !== NODE_TYPES.EXPORT && type !== NODE_TYPES.ANNOTATION) {
    if (type === NODE_TYPES.IF_ELSE) {
      resolvedOutputs.push(
        { id: 'then', name: 'Then Branch', dataType: DATA_TYPES.DATASET },
        { id: 'else', name: 'Else Branch', dataType: DATA_TYPES.DATASET }
      );
    } else if (type === NODE_TYPES.FOR_EACH) {
      resolvedOutputs.push(
        { id: 'out', name: 'Output Dataset', dataType: DATA_TYPES.DATASET },
        { id: 'item', name: 'Current Item', dataType: DATA_TYPES.ANY },
        { id: 'results', name: 'Aggregated Results', dataType: DATA_TYPES.COLLECTION }
      );
    } else {
      resolvedOutputs.push({ id: 'out', name: 'Output', dataType: DATA_TYPES.DATASET });
    }
  }

  return {
    ...extensions,
    id,
    type,
    name: name || id,
    doc,
    executable: type !== NODE_TYPES.ANNOTATION && executable !== false,
    inputs: resolvedInputs,
    outputs: resolvedOutputs,
    params: { ...params }
  };
}
