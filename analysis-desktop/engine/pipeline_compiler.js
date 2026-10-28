/**
 * SIREN Analysis & Advanced Automation — Pipeline Compiler
 *
 * Compiles a visual DAG into deterministic DuckDB SQL views.
 * Features:
 * - Proper SQL escaping for paths (handling O'Brien.csv) and identifiers (spaces/quotes).
 * - Explicit Join input port mapping (left vs right handle).
 * - Automatic CTE pre-filtering for PIVOT to prevent DuckDB USING-clause filter ignores.
 * - Validation of node configurations and export formats.
 * - Explicit CSV nullStr support: preserves exact legacy SQL when omitted,
 *   strictly validates string type when present, and escapes single quotes for SQL safety.
 */

import fs from 'node:fs';
import {assertNodeViewIdentities,nodeViewName} from './graph-identity.js';
import {compileFilterBinding} from './filter-binding.js';
import {compileDerivedBinding} from './derived-binding.js';
import {compileSumBinding,compileLookupBinding,compileCountBinding} from './conditional-binding.js';
import path from 'node:path';
import {buildRetainedInputSQL} from '../histogram/typed_input.js';

export function escapeSqlString(str) {
  if (str === null || str === undefined) return "''";
  return String(str).replace(/'/g, "''");
}

export function escapeSqlIdentifier(ident) {
  if (!ident || typeof ident !== 'string') return '""';
  // If identifier contains spaces, hyphens, uppercase, or special characters, or always
  return `"${ident.replace(/"/g, '""')}"`;
}

export class PipelineCompiler {
  constructor(pipelineDef, options = {}) {
    this.nodes = pipelineDef.nodes || [];
    this.edges = pipelineDef.edges || [];
    assertNodeViewIdentities(this.nodes);
    this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));
    this.options = options || {};
  }

  validateDAG() {
    assertNodeViewIdentities(this.nodes);
    // 1. Check all edge references exist
    for (const edge of this.edges) {
      if (!this.nodeMap.has(edge.source)) {
        throw new Error(`Invalid graph: edge references missing source node "${edge.source}"`);
      }
      if (!this.nodeMap.has(edge.target)) {
        throw new Error(`Invalid graph: edge references missing target node "${edge.target}"`);
      }
    }

    // 2. Cycle detection & topological sort (Kahn's algorithm)
    const inDegree = new Map();
    const adj = new Map();
    for (const n of this.nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }

    for (const edge of this.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      adj.get(edge.source).push(edge.target);
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const u = queue.shift();
      sorted.push(u);
      for (const v of adj.get(u)) {
        inDegree.set(v, inDegree.get(v) - 1);
        if (inDegree.get(v) === 0) queue.push(v);
      }
    }

    if (sorted.length !== this.nodes.length) {
      throw new Error('Cycle detected in visual node graph! Alteryx-style pipeline must be a Directed Acyclic Graph (DAG).');
    }

    return sorted; // Topologically sorted node IDs
  }

  getIncomingEdges(nodeId) {
    return this.edges.filter(e => e.target === nodeId);
  }

  getIncomingNodes(nodeId) {
    const incomingEdges = this.getIncomingEdges(nodeId);
    return incomingEdges.map(e => this.nodeMap.get(e.source));
  }

  compileToSQL() {
    const sortedNodeIds = this.validateDAG();
    const sqlStatements = [];
    const viewNames = new Map();

    for (const nodeId of sortedNodeIds) {
      const node = this.nodeMap.get(nodeId);
      const incomingEdges = this.getIncomingEdges(nodeId);
      const viewName = nodeViewName(node.id);
      viewNames.set(node.id, viewName);

      const nodeSQL = this.compileNode(node, incomingEdges, viewNames);
      sqlStatements.push({
        nodeId: node.id,
        nodeType: node.type,
        viewName,
        sql: nodeSQL,
        ...(node.type==='conditional_count'?{functionSchemaChecks:[{viewName:viewNames.get(incomingEdges[0].source),columns:compileCountBinding(node.data).columns,full:false,scope:'Count'}]}:{}),
        ...(node.type==='conditional_sum'?{functionSchemaChecks:[{viewName:viewNames.get(incomingEdges[0].source),columns:compileSumBinding(node.data).columns,full:false,scope:'Conditional sum'}]}:{}),
        ...(node.type==='lookup'?{functionSchemaChecks:['left','right'].map(side=>({viewName:viewNames.get(incomingEdges.find(e=>e.targetHandle===side).source),columns:compileLookupBinding(node.data)[side],full:side==='left',scope:'Lookup '+side}))}:{}),
        ...(node.type==='derive'?{derivedSchemaCheck:{viewName:viewNames.get(incomingEdges[0].source),columns:compileDerivedBinding(node.data).schema}}:{}),
        ...(node.type==='filter'&&node.data?.criteria!==undefined?{filterSchemaCheck:{viewName:viewNames.get(incomingEdges[0].source),columns:compileFilterBinding(node.data).columns}}:{})
      });
    }

    return sqlStatements;
  }

  compileNode(node, incomingEdges, viewNames) {
    const data = node.data || {};

    switch (node.type) {
      case 'input': {
        if(Object.hasOwn(data,'retainedResult'))return buildRetainedInputSQL(viewNames.get(node.id),data.retainedResult,data.retainedMeasure);
        const rawPath = data.path || '';
        if (!rawPath.trim()) {
          throw new Error(`Input node "${node.id}" requires a valid file path.`);
        }

        let resolvedPath = rawPath;
        if (!path.isAbsolute(rawPath)) {
          const candidates = [
            this.options.dataDir ? path.resolve(this.options.dataDir, rawPath) : null,
            this.options.dataDir ? path.resolve(this.options.dataDir, path.basename(rawPath)) : null,
            path.resolve(process.cwd(), rawPath),
            path.resolve(process.cwd(), 'data', path.basename(rawPath)),
            path.resolve(process.cwd(), 'resources/app', rawPath),
            path.resolve(process.cwd(), 'resources/app/data', path.basename(rawPath)),
            path.resolve(process.cwd(), '../data', path.basename(rawPath)),
            path.resolve(process.cwd(), '../../data', path.basename(rawPath)),
            path.resolve(process.cwd(), '../../../data', path.basename(rawPath))
          ].filter(Boolean);

          for (const cand of candidates) {
            if (fs.existsSync(cand)) {
              resolvedPath = cand;
              break;
            }
          }
        }

        // Normalize path and escape single quotes for SQL safety (e.g. D:/O'Brien.csv -> D:/O''Brien.csv)
        const normalizedPath = resolvedPath.replace(/\\/g, '/');
        const escapedPath = escapeSqlString(normalizedPath);

        const format = (data.format || (normalizedPath.endsWith('.parquet') ? 'parquet' : 'csv')).toLowerCase();
        if (format === 'parquet') {
          return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS SELECT * FROM read_parquet('${escapedPath}');`;
        } else {
          const header = data.header !== false ? 'true' : 'false';
          const delim = data.delimiter ? `'${escapeSqlString(data.delimiter)}'` : `','`;
          const allVarchar = data.allVarchar !== false ? 'true' : 'false';

          if (data.nullStr !== undefined) {
            if (typeof data.nullStr !== 'string') {
              throw new Error(`Input node "${node.id}" invalid nullStr: must be a string if defined, got ${data.nullStr === null ? 'null' : typeof data.nullStr}`);
            }
            const escapedNullStr = escapeSqlString(data.nullStr);
            return `CREATE OR REPLACE TEMP TABLE ${viewNames.get(node.id)} AS SELECT * FROM read_csv('${escapedPath}', header=${header}, delim=${delim}, auto_detect=true, allow_quoted_nulls=false, all_varchar=${allVarchar}, nullstr='${escapedNullStr}');`;
          }

          return `CREATE OR REPLACE TEMP TABLE ${viewNames.get(node.id)} AS SELECT * FROM read_csv('${escapedPath}', header=${header}, delim=${delim}, auto_detect=true, allow_quoted_nulls=false, all_varchar=${allVarchar});`;
        }
      }

      case 'select': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Select) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);
        const columns = data.columns || [];
        let selectClause = '*';
        if (columns.length > 0) {
          selectClause = columns.map(c => {
            const rawCol = escapeSqlIdentifier(c.name);
            const expr = c.castType ? `TRY_CAST(${rawCol} AS ${c.castType})` : rawCol;
            return c.alias ? `${expr} AS ${escapeSqlIdentifier(c.alias)}` : expr;
          }).join(', ');
        }
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS SELECT ${selectClause} FROM ${upstream};`;
      }

      case 'conditional_count': {
        if(incomingEdges.length!==1)throw Error('Count needs exactly one input.');
        const binding=compileCountBinding(data),upstream=viewNames.get(incomingEdges[0].source);
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS WITH "input_data" AS (SELECT * FROM ${upstream}) ${binding.sql};`;
      }
      case 'conditional_sum': {
        if(incomingEdges.length!==1)throw Error('Conditional sum needs exactly one input.');
        const binding=compileSumBinding(data),upstream=viewNames.get(incomingEdges[0].source);
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS WITH "input_data" AS (SELECT * FROM ${upstream}) ${binding.sql};`;
      }
      case 'lookup': {
        if(incomingEdges.length!==2||['left','right'].some(side=>incomingEdges.filter(e=>e.targetHandle===side).length!==1))throw Error('Lookup needs one explicit left and right input.');
        const binding=compileLookupBinding(data),left=viewNames.get(incomingEdges.find(e=>e.targetHandle==='left').source),right=viewNames.get(incomingEdges.find(e=>e.targetHandle==='right').source);
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS WITH "left_input" AS (SELECT * FROM ${left}), "right_input" AS (SELECT * FROM ${right}) SELECT * FROM (${binding.sql}) AS "__lookup_output";`;
      }
      case 'derive': {
        if(incomingEdges.length!==1)throw Error('New columns needs exactly one input.');
        const {projection}=compileDerivedBinding(data);
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS SELECT ${projection} FROM ${viewNames.get(incomingEdges[0].source)};`;
      }

      case 'filter': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Filter) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);
        const {condition} = compileFilterBinding(data);
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS SELECT * FROM ${upstream} WHERE ${condition};`;
      }

      case 'join': {
        if (incomingEdges.length < 2) {
          throw new Error(`Node ${node.id} (Join) requires two incoming table connections (left and right ports)`);
        }

        // Port-aware mapping: Check targetHandle ('left' vs 'right')
        let leftSourceId = null;
        let rightSourceId = null;

        // Check if edge explicitly defines targetHandle
        for (const edge of incomingEdges) {
          if (edge.targetHandle === 'left') leftSourceId = edge.source;
          else if (edge.targetHandle === 'right') rightSourceId = edge.source;
        }

        // Fallback to explicit node configuration
        if (!leftSourceId && data.leftSourceNodeId) leftSourceId = data.leftSourceNodeId;
        if (!rightSourceId && data.rightSourceNodeId) rightSourceId = data.rightSourceNodeId;

        // Fallback to edge order if not specified
        if (!leftSourceId || !rightSourceId) {
          leftSourceId = incomingEdges[0].source;
          rightSourceId = incomingEdges[1].source;
        }

        const leftUpstream = viewNames.get(leftSourceId);
        const rightUpstream = viewNames.get(rightSourceId);
        if (!leftUpstream || !rightUpstream) {
          throw new Error(`Join node "${node.id}" could not resolve upstream views for left: "${leftSourceId}" and right: "${rightSourceId}"`);
        }

        const joinType = (data.joinType || 'INNER').toUpperCase();
        const leftKey = escapeSqlIdentifier(data.leftKey || 'id');
        const rightKey = escapeSqlIdentifier(data.rightKey || 'id');

        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS 
SELECT left_tab.*, right_tab.* EXCLUDE (${rightKey}) 
FROM ${leftUpstream} AS left_tab 
${joinType} JOIN ${rightUpstream} AS right_tab 
ON left_tab.${leftKey} = right_tab.${rightKey};`;
      }

      case 'aggregate': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Aggregate) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);
        const groupBy = data.groupBy || [];
        const aggregations = data.aggregations || [{ expr: 'COUNT(*)', alias: 'row_count' }];

        const groupClause = groupBy.map(g => escapeSqlIdentifier(g)).join(', ');
        const aggClause = aggregations.map(a => `${a.expr} AS ${escapeSqlIdentifier(a.alias || 'agg')}`).join(', ');

        const selectParts = [];
        if (groupClause) selectParts.push(groupClause);
        selectParts.push(aggClause);

        const groupQuery = groupBy.length > 0 ? ` GROUP BY ${groupClause}` : '';
        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS SELECT ${selectParts.join(', ')} FROM ${upstream}${groupQuery};`;
      }

      case 'pivot': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Pivot) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);

        const rowDims = (data.rows || ['id']).map(r => escapeSqlIdentifier(r)).join(', ');
        const rawColDim = data.column || 'category';
        const colDim = escapeSqlIdentifier(rawColDim);
        const rawMeasure = data.measure || 'amount';
        const measure = escapeSqlIdentifier(rawMeasure);
        const aggFunc = (data.agg || 'SUM').toUpperCase();

        // Automatic CTE Pre-filtering:
        // DuckDB optimization can ignore WHERE clauses inside USING in PIVOT.
        // We guarantee correct semantics by executing pre-filtering in a dedicated CTE first.
        const filterConditions = [];
        if (data.filterCondition) {
          filterConditions.push(data.filterCondition);
        }
        if (Array.isArray(data.inCategories) && data.inCategories.length > 0) {
          const inList = data.inCategories.map(c => `'${escapeSqlString(c)}'`).join(', ');
          filterConditions.push(`${colDim} IN (${inList})`);
        }

        const prefilterWhere = filterConditions.length > 0 ? ` WHERE ${filterConditions.join(' AND ')}` : '';

        let onValuesClause = '';
        const hasExplicitCategories = Array.isArray(data.inCategories) && data.inCategories.length > 0;
        if (hasExplicitCategories) {
          onValuesClause = ` IN (${data.inCategories.map(c => `'${escapeSqlString(c)}'`).join(', ')})`;
        }

        // DuckDB requirement: Dynamic PIVOT (without explicit IN clause) cannot be a VIEW;
        // it must be materialized as a TEMP TABLE. Explicit PIVOT can be a VIEW.
        const createTarget = hasExplicitCategories 
          ? `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS`
          : `CREATE OR REPLACE TEMP TABLE ${viewNames.get(node.id)} AS`;

        return `${createTarget} 
WITH prefiltered_src AS (
  SELECT * FROM ${upstream}${prefilterWhere}
)
PIVOT prefiltered_src 
ON ${colDim}${onValuesClause} 
USING ${aggFunc}(${measure}) 
GROUP BY ${rowDims};`;
      }

      case 'unpivot': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Unpivot) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);
        const unpivotCols = (data.columns || []).map(c => escapeSqlIdentifier(c)).join(', ');
        const nameCol = escapeSqlIdentifier(data.nameColumn || 'attribute');
        const valCol = escapeSqlIdentifier(data.valueColumn || 'value');

        return `CREATE OR REPLACE VIEW ${viewNames.get(node.id)} AS 
UNPIVOT ${upstream} 
ON ${unpivotCols} 
INTO NAME ${nameCol} VALUE ${valCol};`;
      }

      case 'export': {
        if (incomingEdges.length === 0) {
          throw new Error(`Node ${node.id} (Export) requires an upstream input connection`);
        }
        const upstream = viewNames.get(incomingEdges[0].source);
        const rawOutPath = data.path || '';
        if (!rawOutPath.trim()) {
          throw new Error(`Export node "${node.id}" requires a destination file path.`);
        }

        let resolvedOutPath = rawOutPath;
        if (!path.isAbsolute(rawOutPath)) {
          const targetDir = this.options.dataDir || path.resolve(process.cwd(), 'data');
          if (!fs.existsSync(targetDir)) {
            try { fs.mkdirSync(targetDir, { recursive: true }); } catch (e) {}
          }
          resolvedOutPath = path.resolve(targetDir, path.basename(rawOutPath));
        }

        const parentDir = path.dirname(resolvedOutPath);
        if (!fs.existsSync(parentDir)) {
          try { fs.mkdirSync(parentDir, { recursive: true }); } catch (e) {}
        }

        const outPath = escapeSqlString(resolvedOutPath.replace(/\\/g, '/'));
        const format = (data.format || 'PARQUET').toUpperCase();

        // Strictly validate native DuckDB COPY formats
        const validFormats = ['PARQUET', 'CSV', 'JSON'];
        if (!validFormats.includes(format)) {
          throw new Error(`Invalid DuckDB COPY export format "${format}". Supported native formats: ${validFormats.join(', ')}. SIREN Docs export is handled via the DocsUniverContract.`);
        }

        return `COPY ${upstream} TO '${outPath}' (FORMAT ${format});`;
      }

      default:
        throw new Error(`Unsupported node type: ${node.type}`);
    }
  }
}
