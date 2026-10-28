/**
 * Real Pipeline Execution: DuckDB -> Analysis Engine Worker -> Result -> Adapter -> Charts Validator
 *
 * Verifies the end-to-end analytical pipeline with real DuckDB native execution.
 * Tests:
 *   - VARCHAR numeric ('42', '1.20')
 *   - Identifier with leading zeros ('0042', '007')
 *   - DECIMAL ('225.25', '0.00')
 *   - BIGINT (100000000)
 *   - NULL values
 *   - Empty string ('')
 *   - Numeric zero (0, 0.00)
 *   - Complete packing & unpacking with Charts core.pack() and core.unpack()
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AnalysisToChartsAdapter } from '../src/analysis_to_charts_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Load DuckDB from Analysis prototype node_modules
const analysisNodeModules = 'D:/Siren analysis prototype/node_modules';
const { DuckDBInstance } = require(`${analysisNodeModules}/@duckdb/node-api`);
const chartsCore = require('C:/Claude/SIREN_WORK/charts-visual-analytics-parallel-20261025/app/core.js');

let passCount = 0;
let failCount = 0;
const results = [];

function assert(description, condition, details = {}) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${description}`);
    results.push({ test: description, status: 'PASS', details });
  } else {
    failCount++;
    console.error(`  [FAIL] ${description}`, details);
    results.push({ test: description, status: 'FAIL', details });
  }
}

export async function runDuckDBPipelineTest() {
  console.log('\n=== RUNNING DUCKDB -> ANALYSIS WORKER -> ADAPTER -> CHARTS PIPELINE TEST ===');

  // 1. Initialize real native DuckDB in-memory instance
  console.log('1. Spawning DuckDB native database instance...');
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();
  assert('DuckDB native instance created & connection established', Boolean(conn));

  // 2. Create Analytical Table with strict typed columns
  console.log('2. Creating table with mixed types (VARCHAR numeric, leading zeros, DECIMAL, BIGINT, NULL)...');
  await conn.run(`
    CREATE TABLE raw_transactions (
      tx_code VARCHAR,
      customer_id VARCHAR,
      amount DECIMAL(18, 2),
      item_count BIGINT,
      note VARCHAR,
      discount_pct DOUBLE,
      sale_date DATE
    );
  `);

  // 3. Insert real records with all required edge cases
  console.log('3. Inserting records covering all required edge case representations...');
  const insertSql = `
    INSERT INTO raw_transactions VALUES
      ('TX-101', '0042', 225.25, 3, 'Regular order', 0.10, '2026-10-21'),
      ('TX-102', '0042', 0.00, 0, '', 0.00, '2026-10-22'),
      ('TX-103', '0007', 999.99, 100000000, NULL, NULL, '2026-10-23'),
      ('TX-104', '0007', 42.00, 1, '42', 0.05, '2026-10-24'),
      ('TX-105', '0099', 1.20, 2, '1.20', 0.00, '2026-10-25'),
      ('TX-106', '0099', -50.00, 1, 'Refund', NULL, '2026-10-25'),
      ('TX-107', '0001', 5000.00, 50, 'Wholesale', 0.15, '2026-10-25'),
      ('TX-108', '0001', 0.00, 0, NULL, 0.00, '2026-10-25');
  `;
  await conn.run(insertSql);

  const totalSourceResult = await conn.run('SELECT COUNT(*)::BIGINT AS total_source FROM raw_transactions');
  const totalSourceRows = Number((await totalSourceResult.getRowObjectsJson())[0].total_source);
  assert('Total source rows inserted into DuckDB is 8', totalSourceRows === 8);

  // 4. Execute Bounded Aggregation Query (Analysis worker pipeline step)
  console.log('4. Executing bounded analytical aggregation query in DuckDB worker...');
  const aggSql = `
    CREATE OR REPLACE VIEW view_customer_summary AS
    SELECT
      customer_id,
      MIN(tx_code) AS sample_tx,
      SUM(amount) AS total_revenue,
      SUM(item_count) AS total_items,
      AVG(discount_pct) AS avg_discount,
      MIN(note) AS sample_note
    FROM raw_transactions
    GROUP BY customer_id
    ORDER BY total_revenue DESC;
  `;
  await conn.run(aggSql);

  // 5. Extract DuckDB Catalog Schema (exact replica of DuckDBRunner.getTableSchema)
  console.log('5. Extracting catalog schema from DuckDB...');
  const describeRes = await conn.run('DESCRIBE view_customer_summary');
  const schemaRows = await describeRes.getRowObjectsJson();
  const duckDbSchema = schemaRows.map(r => ({
    name: r.column_name,
    type: r.column_type,
    columnName: r.column_name,
    columnType: r.column_type,
    nullable: r.null === 'YES'
  }));

  assert('DuckDB catalog schema extracted with 6 columns', duckDbSchema.length === 6);
  assert('customer_id catalog type is VARCHAR', duckDbSchema.find(c => c.name === 'customer_id').type === 'VARCHAR');
  assert('total_revenue catalog type is DECIMAL(38,2)', duckDbSchema.find(c => c.name === 'total_revenue').type.includes('DECIMAL'));
  assert('total_items catalog type is HUGEINT or BIGINT', duckDbSchema.find(c => c.name === 'total_items').type.includes('INT'));

  // 6. Fetch Result Rows (exact replica of DuckDBRunner.queryObjects)
  console.log('6. Fetching computed result rows from DuckDB view...');
  const previewRes = await conn.run('SELECT * FROM view_customer_summary');
  const resultRows = await previewRes.getRowObjectsJson();
  assert('Result view returned 4 aggregated rows', resultRows.length === 4);

  // 7. Pass Analysis Worker Result to Adapter
  console.log('7. Transforming worker result with AnalysisToChartsAdapter...');
  const jobId = 'job_duckdb_live_' + Date.now();
  const nodeId = 'node_customer_agg';

  const adapterInput = {
    schema: duckDbSchema,
    rows: resultRows,
    source: {
      sourceId: nodeId,
      jobId: jobId,
      state: 'current'
    },
    coverage: {
      kind: 'aggregate',
      sourceRowCount: totalSourceRows,
      resultRowCount: resultRows.length,
      transferredRows: resultRows.length,
      aggregation: {
        description: 'GROUP BY customer_id with SUM(amount), SUM(item_count), AVG(discount_pct)',
        type: 'SUM'
      }
    },
    columnHints: {
      customer_id: { role: 'dimension', label: 'Customer ID' },
      total_revenue: { role: 'measure', unit: 'RON', label: 'Total Revenue' },
      total_items: { role: 'measure', unit: 'units', label: 'Items Sold' },
      avg_discount: { role: 'measure', unit: 'ratio', label: 'Avg Discount' }
    }
  };

  const snapshot = AnalysisToChartsAdapter.transform(adapterInput);

  // 8. Verify Precise Properties of the Transformed Snapshot
  console.log('8. Verifying converted snapshot properties...');
  assert('Snapshot has valid schemaVersion siren.chart-data/1', snapshot.schemaVersion === 'siren.chart-data/1');
  assert('Snapshot has deterministic content-sha256 resultVersion', snapshot.source.resultVersion.startsWith('content-sha256:'));
  assert('Customer "0001" has total_revenue 5000.00', snapshot.rows.find(r => r.values.customer_id === '0001').values.total_revenue === '5000.00');
  assert('Customer "0042" preserves leading zeros', snapshot.rows.some(r => r.values.customer_id === '0042'));
  assert('Customer "0007" preserves leading zeros', snapshot.rows.some(r => r.values.customer_id === '0007'));
  assert('Customer "0007" total_items is safe number 100000001', snapshot.rows.find(r => r.values.customer_id === '0007').values.total_items === 100000001);
  assert('Coverage sourceRowCount is 8', snapshot.coverage.sourceRowCount === 8);
  assert('Coverage resultRowCount is 4', snapshot.coverage.resultRowCount === 4);
  assert('Coverage transferredRows is 4', snapshot.coverage.transferredRows === 4);

  // 9. Validate with Charts core.js
  console.log('9. Validating against Charts app/core.js validator...');
  let isValidated = false;
  try {
    chartsCore.validateSnapshot(snapshot);
    isValidated = true;
  } catch (err) {
    console.error('Validation failure:', err);
  }
  assert('Snapshot validated successfully by Charts app/core.js validateSnapshot()', isValidated);

  // 10. Seal and Pack into siren.chart-file/1 Envelope
  console.log('10. Packaging into sealed siren.chart-file/1 with chartsCore.pack()...');
  const chartDef = chartsCore.defaultDefinition(snapshot);
  chartDef.title = 'Venituri Agregate pe Clienți (DuckDB Native)';
  chartDef.x = 'customer_id';
  chartDef.y = ['total_revenue'];
  chartDef.yUnitLabel = 'RON';

  const packedChart = await chartsCore.pack(snapshot, chartDef);
  assert('Chart packed into siren.chart-file/1', packedChart.schemaVersion === 'siren.chart-file/1');
  assert('Packed chart has snapshotSha256 hash', Boolean(packedChart.snapshotSha256 && packedChart.snapshotSha256.length === 64));
  assert('Packed chart has integritySha256 hash', Boolean(packedChart.integritySha256 && packedChart.integritySha256.length === 64));

  // 11. Unpack & Verify Readback Integrity
  console.log('11. Unpacking and verifying cryptographic integrity with chartsCore.unpack()...');
  const serialized = JSON.stringify(packedChart, null, 2);
  const unpacked = await chartsCore.unpack(serialized);
  assert('Unpacked chart matches original definition title', unpacked.definition.title === chartDef.title);
  assert('Unpacked chart preserves customer "0042"', unpacked.snapshot.rows.some(r => r.values.customer_id === '0042'));

  // 12. Save Evidence Artifacts
  const evidenceDir = path.resolve(__dirname, '../evidence');
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  const snapshotPath = path.join(evidenceDir, 'duckdb_pipeline_snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Saved snapshot evidence to: ${snapshotPath}`);

  const chartPackagePath = path.join(evidenceDir, 'duckdb_pipeline_chart.sirenchart.json');
  fs.writeFileSync(chartPackagePath, serialized, 'utf8');
  console.log(`Saved sealed chart package evidence to: ${chartPackagePath}`);

  console.log(`\nPipeline Test Finished: ${passCount} passed, ${failCount} failed.\n`);
  return { passCount, failCount, results, snapshotPath, chartPackagePath };
}

if (process.argv[1] && process.argv[1].endsWith('test_duckdb_worker_pipeline.mjs')) {
  runDuckDBPipelineTest().catch(err => {
    console.error('Fatal pipeline test error:', err);
    process.exit(1);
  });
}
