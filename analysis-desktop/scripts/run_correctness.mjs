import { DuckDBRunner } from '../engine/duckdb_runner.js';
import { PipelineCompiler } from '../engine/pipeline_compiler.js';
import { DataGenerator } from '../engine/data_generator.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('=== SIREN Analysis: Correctness & Engine Validation Suite ===');
  const reportsDir = path.resolve('reports');
  const dataDir = path.resolve('data');
  const evidenceDir = path.resolve('evidence');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  const runner = new DuckDBRunner({
    dbPath: ':memory:',
    maxMemory: '1GB',
    threads: 4,
    tempDirectory: path.join(dataDir, 'temp')
  });

  const initInfo = await runner.initialize();
  console.log('DuckDB initialized successfully:', initInfo);

  const generator = new DataGenerator(runner);
  console.log('\n[1/3] Generating edge-case fixtures...');
  const { txCsvPath, custCsvPath } = await generator.generateCorrectnessFixtures(dataDir);
  console.log('  Transactions CSV:', txCsvPath);
  console.log('  Customers CSV:', custCsvPath);

  const results = {
    timestamp: new Date().toISOString(),
    engine: initInfo,
    assertions: [],
    pipelineResults: null
  };

  function recordAssertion(id, description, passed, details) {
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${id}: ${description}`);
    if (!passed) console.error('    Details:', details);
    results.assertions.push({ id, description, passed, details });
  }

  console.log('\n[2/3] Running Section 5 Correctness Assertions...');

  // 1. Inspect raw CSV read with explicit string types to preserve leading zeros
  // We use allow_quoted_nulls=false so "" is empty string while ,, is NULL
  const rawCsvSql = `
    CREATE OR REPLACE VIEW raw_tx AS 
    SELECT * FROM read_csv('${txCsvPath.replace(/\\/g, '/')}', 
      header=true, 
      allow_quoted_nulls=false,
      types={'trans_id': 'VARCHAR', 'cust_code': 'VARCHAR', 'amount': 'VARCHAR', 'raw_date': 'VARCHAR', 'note': 'VARCHAR', 'qty': 'VARCHAR', 'status': 'VARCHAR'});
  `;
  await runner.run(rawCsvSql);
  const rawCount = await runner.getTableRowCount('raw_tx');
  recordAssertion('CORR-01', 'CSV line count matches exact physical rows (10 rows, handling multiline)', rawCount === 10, { count: rawCount });

  // 2. NULL vs Empty String vs Zero
  const row2 = await runner.queryObjects(`SELECT amount, note, qty FROM raw_tx WHERE trans_id = '2'`);
  const r2 = row2[0];
  const nullVsEmptyPass = r2.amount === null && r2.note === '' && r2.qty === '0';
  recordAssertion('CORR-02', 'NULL vs empty string vs zero distinction preserved (amount=NULL, note="", qty=0)', nullVsEmptyPass, r2);

  // 3. Leading zeros preserved in string identifier
  const row3LeadingZeros = await runner.queryObjects(`SELECT cust_code FROM raw_tx WHERE trans_id = '9007199254740993'`);
  const leadingZeroPass = row3LeadingZeros[0]?.cust_code === '00030';
  recordAssertion('CORR-03', 'Leading zeros identifier "00030" not stripped to 30', leadingZeroPass, row3LeadingZeros[0]);

  // 4. BigInt precision > 2^53 (9007199254740993 > Number.MAX_SAFE_INTEGER)
  const bigIntRow = await runner.queryObjects(`SELECT CAST(trans_id AS BIGINT) AS trans_id_bigint FROM raw_tx WHERE trans_id = '9007199254740993'`);
  const bigIntVal = bigIntRow[0]?.trans_id_bigint;
  const bigIntPass = String(bigIntVal) === '9007199254740993';
  recordAssertion('CORR-04', 'BigInt precision > 2^53 preserved without IEEE-754 rounding', bigIntPass, { val: bigIntVal });

  // 5. Embedded comma in quoted string
  const row4 = await runner.queryObjects(`SELECT note FROM raw_tx WHERE trans_id = '4'`);
  const commaPass = row4[0]?.note === 'București, Sector 1';
  recordAssertion('CORR-05', 'Quoted field containing embedded comma parsed intact', commaPass, row4[0]);

  // 6. Embedded newline inside quoted field
  const row5 = await runner.queryObjects(`SELECT note FROM raw_tx WHERE trans_id = '5'`);
  const newlinePass = row5[0]?.note?.includes('\n') && row5[0]?.note?.startsWith('Linie 1\nLinie 2');
  recordAssertion('CORR-06', 'Quoted field with embedded newline parsed as single record', newlinePass, row5[0]);

  // 7. Escaped quotes
  const row6 = await runner.queryObjects(`SELECT note FROM raw_tx WHERE trans_id = '6'`);
  const quotesPass = row6[0]?.note === 'Clientul a spus: "Urgent"';
  recordAssertion('CORR-07', 'Escaped double quotes "" parsed correctly into single quote', quotesPass, row6[0]);

  // 8. Romanian diacritics Unicode preservation
  const row7 = await runner.queryObjects(`SELECT note FROM raw_tx WHERE trans_id = '7'`);
  const diacriticsPass = row7[0]?.note === 'Factură cu diacritice: școală, țară, pâine';
  recordAssertion('CORR-08', 'Romanian Unicode diacritics (ș, ț, ă, î, â) preserved', diacriticsPass, row7[0]);

  // 9. Exact monetary sums (DECIMAL(12,2) prevents floating point drift)
  const decimalSum = await runner.queryObjects(`
    SELECT SUM(TRY_CAST(amount AS DECIMAL(12,2))) AS total_exact
    FROM raw_tx
    WHERE trans_id IN ('1', '4', '9')
  `);
  // 100.25 + 50.00 + 75.00 = 225.25
  const exactPass = String(decimalSum[0]?.total_exact) === '225.25';
  recordAssertion('CORR-09', 'Monetary sums calculated with exact DECIMAL(12,2) representation', exactPass, decimalSum[0]);

  // 10. Invalid conversions (TRY_CAST) & Rejected Rows audit
  const rejectedRows = await runner.queryObjects(`
    SELECT trans_id, cust_code, amount, raw_date, note
    FROM raw_tx
    WHERE TRY_CAST(amount AS DECIMAL(12,2)) IS NULL AND amount IS NOT NULL AND amount != ''
  `);
  const rejectedPass = rejectedRows.length === 1 && rejectedRows[0].trans_id === '8';
  recordAssertion('CORR-10', 'Invalid numeric/date formats captured via TRY_CAST without silent drops', rejectedPass, rejectedRows);

  // 11. Duplicate join keys and unmatched rows inspection
  await runner.run(`
    CREATE OR REPLACE VIEW raw_cust AS 
    SELECT * FROM read_csv('${custCsvPath.replace(/\\/g, '/')}', header=true, types={'cust_code': 'VARCHAR'});
  `);
  const innerJoin = await runner.queryObjects(`
    SELECT t.trans_id, t.cust_code, c.customer_name
    FROM raw_tx t
    INNER JOIN raw_cust c ON t.cust_code = c.cust_code
    WHERE t.cust_code = '00050'
  `);
  const dupKeyPass = innerJoin.length === 2; // 1 transaction for 00050 matched 2 customer entries
  recordAssertion('CORR-11', 'Join handles duplicate keys correctly (produces 2 matched rows)', dupKeyPass, { count: innerJoin.length });

  const unmatchedRows = await runner.queryObjects(`
    SELECT t.trans_id, t.cust_code
    FROM raw_tx t
    LEFT JOIN raw_cust c ON t.cust_code = c.cust_code
    WHERE c.cust_code IS NULL
  `);
  // Cust 00060 (row 8) and 00999 (row 10) are not present in customer table
  const unmatchedPass = unmatchedRows.length === 2 && unmatchedRows.some(r => r.trans_id === '10') && unmatchedRows.some(r => r.trans_id === '8');
  recordAssertion('CORR-12', 'Unmatched rows identified via LEFT JOIN (cust 00060 and 00999)', unmatchedPass, unmatchedRows);

  console.log('\n[3/3] Compiling and Executing Complete End-to-End Visual Pipeline...');

  // Full pipeline definition
  const exportParquetPath = path.join(dataDir, 'pipeline_result.parquet');
  if (fs.existsSync(exportParquetPath)) fs.unlinkSync(exportParquetPath);

  const pipelineDef = {
    nodes: [
      {
        id: 'node_1_in_tx',
        type: 'input',
        data: { path: txCsvPath, format: 'csv', header: true }
      },
      {
        id: 'node_2_sel_tx',
        type: 'select',
        data: {
          columns: [
            { name: 'trans_id', alias: 'tx_id', castType: 'BIGINT' },
            { name: 'cust_code', alias: 'customer_code' },
            { name: 'amount', alias: 'tx_amount', castType: 'DECIMAL(12,2)' },
            { name: 'raw_date', alias: 'tx_date', castType: 'DATE' },
            { name: 'status', alias: 'tx_status' }
          ]
        }
      },
      {
        id: 'node_3_filt_valid',
        type: 'filter',
        data: {
          condition: `tx_status != 'REJECTED' AND tx_amount IS NOT NULL`
        }
      },
      {
        id: 'node_4_in_cust',
        type: 'input',
        data: { path: custCsvPath, format: 'csv', header: true }
      },
      {
        id: 'node_5_join_cust',
        type: 'join',
        data: {
          joinType: 'INNER',
          leftKey: 'customer_code',
          rightKey: 'cust_code'
        }
      },
      {
        id: 'node_6_agg_tier',
        type: 'aggregate',
        data: {
          groupBy: ['tier', 'tx_status'],
          aggregations: [
            { expr: 'COUNT(*)', alias: 'tx_count' },
            { expr: 'SUM(tx_amount)', alias: 'total_tier_amount' },
            { expr: 'ROUND(AVG(tx_amount), 2)', alias: 'avg_tier_amount' }
          ]
        }
      },
      {
        id: 'node_7_pivot_tier',
        type: 'pivot',
        data: {
          rows: ['tier'],
          column: 'tx_status',
          measure: 'total_tier_amount',
          agg: 'SUM',
          inCategories: ['COMPLETED', 'SHIPPED', 'PENDING']
        }
      },
      {
        id: 'node_8_unpivot_tier',
        type: 'unpivot',
        data: {
          columns: ['COMPLETED', 'SHIPPED', 'PENDING'],
          nameColumn: 'status_name',
          valueColumn: 'pivoted_amount'
        }
      },
      {
        id: 'node_9_export',
        type: 'export',
        data: {
          path: exportParquetPath,
          format: 'PARQUET'
        }
      }
    ],
    edges: [
      { source: 'node_1_in_tx', target: 'node_2_sel_tx' },
      { source: 'node_2_sel_tx', target: 'node_3_filt_valid' },
      { source: 'node_3_filt_valid', target: 'node_5_join_cust' },
      { source: 'node_4_in_cust', target: 'node_5_join_cust' },
      { source: 'node_5_join_cust', target: 'node_6_agg_tier' },
      { source: 'node_6_agg_tier', target: 'node_7_pivot_tier' },
      { source: 'node_7_pivot_tier', target: 'node_8_unpivot_tier' },
      { source: 'node_8_unpivot_tier', target: 'node_9_export' }
    ]
  };

  const compiler = new PipelineCompiler(pipelineDef);
  const statements = compiler.compileToSQL();
  console.log(`Pipeline compiled to ${statements.length} SQL execution steps.`);

  for (const step of statements) {
    console.log(`Executing step [${step.nodeId}] (${step.nodeType})...`);
    await runner.run(step.sql);
  }

  // Verify export file on disk
  const exportExists = fs.existsSync(exportParquetPath);
  const exportStats = exportExists ? fs.statSync(exportParquetPath) : null;
  recordAssertion('CORR-13', 'Full pipeline executes and exports Parquet file to disk', exportExists && exportStats.size > 0, {
    exportPath: exportParquetPath,
    bytes: exportStats?.size
  });

  // Verify reading exported Parquet back
  const exportedRows = await runner.queryObjects(`SELECT * FROM read_parquet('${exportParquetPath.replace(/\\/g, '/')}')`);
  recordAssertion('CORR-14', 'Exported Parquet is readable and contains unpivoted metrics', exportedRows.length > 0, {
    rowCount: exportedRows.length,
    sample: exportedRows.slice(0, 3)
  });

  // Save report with safe BigInt serializer
  const allPassed = results.assertions.every(a => a.passed);
  results.summary = {
    total: results.assertions.length,
    passed: results.assertions.filter(a => a.passed).length,
    failed: results.assertions.filter(a => !a.passed).length,
    status: allPassed ? 'ALL_TESTS_PASS' : 'FAILURES_DETECTED'
  };

  const reportPath = path.join(reportsDir, 'CORRECTNESS_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2), 'utf8');
  console.log(`\nCorrectness report saved to: ${reportPath}`);
  console.log(`Summary: ${results.summary.passed}/${results.summary.total} assertions passed.`);

  await runner.close();

  if (!allPassed) {
    console.error('Some correctness assertions failed!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in correctness suite:', err);
  process.exit(1);
});
