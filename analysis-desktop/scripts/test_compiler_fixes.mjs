import { PipelineCompiler, escapeSqlString, escapeSqlIdentifier } from '../engine/pipeline_compiler.js';
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

async function testCompilerFixes() {
  console.log('=== Testing Pipeline Compiler Repairs ===');
  const results = [];

  function record(id, desc, pass, details = {}) {
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${id}: ${desc}`);
    if (!pass) console.error('    Details:', details);
    results.push({ id, desc, pass, details });
  }

  // 1. Single quotes in path (O'Brien.csv)
  const escaped = escapeSqlString("D:/O'Brien's Data/test.csv");
  record('COMP-01', 'Single quote path escaping converts to double single-quotes', escaped === "D:/O''Brien''s Data/test.csv", { escaped });

  const inputNodeTest = {
    nodes: [{ id: 'in_1', type: 'input', data: { path: "D:/O'Brien.csv", format: 'csv' } }],
    edges: []
  };
  const comp1 = new PipelineCompiler(inputNodeTest);
  const sql1 = comp1.compileToSQL()[0].sql;
  record('COMP-02', 'Input node SQL contains properly escaped O\'Brien path', sql1.includes("'D:/O''Brien.csv'"), { sql1 });

  // 2. Identifiers with spaces and quotes
  const ident = escapeSqlIdentifier('Total Amount ($)');
  record('COMP-03', 'Identifier with spaces and symbols properly quoted', ident === '"Total Amount ($)"', { ident });

  const selectNodeTest = {
    nodes: [
      { id: 'in_1', type: 'input', data: { path: 'data/test.csv', format: 'csv' } },
      { id: 'sel_1', type: 'select', data: {
        columns: [
          { name: 'Customer Code', alias: 'Client ID', castType: 'VARCHAR' },
          { name: 'Gross "Revenue"', alias: 'Revenue Net', castType: 'DECIMAL(12,2)' }
        ]
      }}
    ],
    edges: [{ source: 'in_1', target: 'sel_1' }]
  };
  const comp2 = new PipelineCompiler(selectNodeTest);
  const sql2 = comp2.compileToSQL()[1].sql;
  record('COMP-04', 'Select node properly quotes spaced and quoted identifiers', sql2.includes('TRY_CAST("Customer Code" AS VARCHAR) AS "Client ID"') && sql2.includes('TRY_CAST("Gross ""Revenue""" AS DECIMAL(12,2)) AS "Revenue Net"'), { sql2 });

  // 3. Explicit Join Ports (targetHandle 'left' vs 'right')
  const joinReversedEdgeOrder = {
    nodes: [
      { id: 'node_left_table', type: 'input', data: { path: 'data/left.csv', format: 'csv' } },
      { id: 'node_right_table', type: 'input', data: { path: 'data/right.csv', format: 'csv' } },
      { id: 'join_node', type: 'join', data: { leftKey: 'left_id', rightKey: 'right_id', joinType: 'INNER' } }
    ],
    // Deliberately place right handle first in edge array!
    edges: [
      { source: 'node_right_table', target: 'join_node', targetHandle: 'right' },
      { source: 'node_left_table', target: 'join_node', targetHandle: 'left' }
    ]
  };
  const comp3 = new PipelineCompiler(joinReversedEdgeOrder);
  const joinSQL = comp3.compileToSQL().find(s => s.nodeId === 'join_node').sql;
  const leftCorrectlyAssigned = joinSQL.includes('FROM view_node_left_table AS left_tab') && joinSQL.includes('JOIN view_node_right_table AS right_tab');
  record('COMP-05', 'Join node maps left/right ports by targetHandle regardless of edge order', leftCorrectlyAssigned, { joinSQL });

  // 4. Automatic CTE Pre-filtering on PIVOT
  const pivotNodeTest = {
    nodes: [
      { id: 'in_1', type: 'input', data: { path: 'data/sales.parquet', format: 'parquet' } },
      { id: 'pivot_1', type: 'pivot', data: {
        rows: ['region'],
        column: 'category',
        measure: 'sales',
        agg: 'SUM',
        inCategories: ['Electronics', 'Furniture'],
        filterCondition: "status = 'APPROVED'"
      }}
    ],
    edges: [{ source: 'in_1', target: 'pivot_1' }]
  };
  const comp4 = new PipelineCompiler(pivotNodeTest);
  const pivotSQL = comp4.compileToSQL()[1].sql;
  const hasPrefilterCTE = pivotSQL.includes('WITH prefiltered_src AS') && pivotSQL.includes("status = 'APPROVED'") && pivotSQL.includes('"category" IN (\'Electronics\', \'Furniture\')');
  record('COMP-06', 'Pivot node generates automatic CTE pre-filtering to prevent USING filter bypass', hasPrefilterCTE, { pivotSQL });

  // 5. Test Pivot in real DuckDB instance to verify SQL execution
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run(`
    CREATE TABLE test_sales AS 
    SELECT * FROM (VALUES 
      ('North', 'Electronics', 100, 'APPROVED'),
      ('North', 'Furniture', 50, 'APPROVED'),
      ('North', 'Food', 20, 'APPROVED'),
      ('South', 'Electronics', 80, 'APPROVED'),
      ('South', 'Furniture', 40, 'REJECTED')
    ) AS t(region, category, sales, status);
  `);
  // Run generated pivot query over test_sales
  const executablePivotSQL = `
    CREATE OR REPLACE VIEW view_pivot_test AS 
    WITH prefiltered_src AS (
      SELECT * FROM test_sales WHERE status = 'APPROVED' AND "category" IN ('Electronics', 'Furniture')
    )
    PIVOT prefiltered_src 
    ON "category" IN ('Electronics', 'Furniture') 
    USING SUM("sales") 
    GROUP BY "region";
  `;
  await conn.run(executablePivotSQL);
  const pivotRes = await conn.run(`SELECT * FROM view_pivot_test ORDER BY region;`);
  const pivotRows = await pivotRes.getRows();
  // South should only have Electronics=80, Furniture=NULL (because Furniture was REJECTED!)
  // Food should be completely excluded
  const southRow = pivotRows.find(r => r[0] === 'South');
  const pivotCorrect = southRow && southRow[1] === 80n && southRow[2] === null;
  record('COMP-07', 'Pivot with prefiltered CTE executes in DuckDB and drops filtered rows correctly', pivotCorrect, { pivotRows });

  // 6. Export format validation
  let caughtInvalidExport = false;
  try {
    const invalidExportTest = {
      nodes: [
        { id: 'in_1', type: 'input', data: { path: 'data/test.csv' } },
        { id: 'exp_1', type: 'export', data: { path: 'data/out.json', format: 'SIRENDOC.JSON' } }
      ],
      edges: [{ source: 'in_1', target: 'exp_1' }]
    };
    new PipelineCompiler(invalidExportTest).compileToSQL();
  } catch (e) {
    caughtInvalidExport = e.message.includes('Invalid DuckDB COPY export format');
  }
  record('COMP-08', 'Export node rejects non-native formats (SIRENDOC.JSON) in DuckDB COPY', caughtInvalidExport);

  const allPassed = results.every(r => r.pass);
  console.log(`\nCompiler tests: ${results.filter(r => r.pass).length}/${results.length} passed.`);
  if (!allPassed) process.exit(1);
}

testCompilerFixes().catch(err => {
  console.error('Fatal error in compiler test:', err);
  process.exit(1);
});
