/**
 * Unit Tests for Analysis -> Charts Minimal Adapter
 */

import { AnalysisToChartsAdapter } from '../src/analysis_to_charts_adapter.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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

export async function runUnitTests() {
  console.log('\n=== RUNNING ADAPTER UNIT TESTS ===');

  // Test 1: Complete Dataset with all required edge case types
  const schema1 = [
    { name: 'channel_id', type: 'VARCHAR', nullable: false, label: 'Channel ID' },
    { name: 'numeric_code', type: 'VARCHAR', nullable: false, label: 'Numeric Code' },
    { name: 'channel_name', type: 'VARCHAR', nullable: false, label: 'Channel Name' },
    { name: 'revenue', type: 'DECIMAL(18,2)', nullable: false, label: 'Total Revenue' },
    { name: 'transaction_count', type: 'BIGINT', nullable: false, label: 'Tx Count' },
    { name: 'discount_amount', type: 'DOUBLE', nullable: true, label: 'Discount' },
    { name: 'optional_note', type: 'VARCHAR', nullable: true, label: 'Notes' },
    { name: 'is_active', type: 'BOOLEAN', nullable: false, label: 'Active Status' },
    { name: 'report_date', type: 'DATE', nullable: false, label: 'Report Date' }
  ];

  const rows1 = [
    {
      channel_id: '0042', // Leading zeros preserved
      numeric_code: '42', // VARCHAR numeric preserved as string
      channel_name: 'Online Web',
      revenue: '225.25', // DECIMAL string
      transaction_count: 1000n, // BigInt safe integer
      discount_amount: 0, // Numeric zero
      optional_note: '', // Empty string
      is_active: true,
      report_date: '2026-10-25'
    },
    {
      channel_id: '0043',
      numeric_code: '1.20', // VARCHAR numeric decimal appearance
      channel_name: 'Mobile App',
      revenue: '-45.50', // Negative decimal
      transaction_count: 2500000, // Number
      discount_amount: null, // Null value in nullable column
      optional_note: null, // Null in string column
      is_active: false,
      report_date: '2026-10-25'
    }
  ];

  const input1 = {
    schema: schema1,
    rows: rows1,
    source: {
      sourceId: 'node_sales_agg',
      jobId: 'job_20261025_001',
      state: 'current'
    },
    coverage: {
      kind: 'complete',
      sourceRowCount: 2,
      resultRowCount: 2,
      transferredRows: 2
    },
    columnHints: {
      revenue: { unit: 'RON' },
      discount_amount: { unit: 'RON' }
    }
  };

  const snapshot1 = AnalysisToChartsAdapter.transform(input1);

  // Assertions on Output Structure & Types
  assert('schemaVersion is siren.chart-data/1', snapshot1.schemaVersion === 'siren.chart-data/1');
  assert('snapshotId is generated non-empty string', Boolean(snapshot1.snapshotId && snapshot1.snapshotId.length > 5));
  assert('resultVersion has content-sha256 prefix when omitted', snapshot1.source.resultVersion.startsWith('content-sha256:'));
  assert('channel_id preserved leading zeros as string "0042"', snapshot1.rows[0].values.channel_id === '0042' && typeof snapshot1.rows[0].values.channel_id === 'string');
  assert('numeric_code preserved as string "42"', snapshot1.rows[0].values.numeric_code === '42' && typeof snapshot1.rows[0].values.numeric_code === 'string');
  assert('numeric_code preserved as string "1.20"', snapshot1.rows[1].values.numeric_code === '1.20' && typeof snapshot1.rows[1].values.numeric_code === 'string');
  assert('revenue preserved as decimal string "225.25"', snapshot1.rows[0].values.revenue === '225.25');
  assert('BigInt converted to safe number', snapshot1.rows[0].values.transaction_count === 1000 && typeof snapshot1.rows[0].values.transaction_count === 'number');
  assert('numeric zero discount_amount preserved as number 0', snapshot1.rows[0].values.discount_amount === 0);
  assert('empty string optional_note preserved as ""', snapshot1.rows[0].values.optional_note === '');
  assert('null discount_amount preserved as null', snapshot1.rows[1].values.discount_amount === null);
  assert('unit preserved on revenue column as "RON"', snapshot1.columns.find(c => c.id === 'revenue').unit === 'RON');
  assert('unit null on un-annotated column', snapshot1.columns.find(c => c.id === 'channel_id').unit === null);

  // Validation with Charts Core
  let coreValid1 = false;
  try {
    chartsCore.validateSnapshot(snapshot1);
    coreValid1 = true;
  } catch (e) {
    console.error('Validation error:', e);
  }
  assert('Snapshot passes Charts app/core.js validateSnapshot', coreValid1);

  // Test 2: Bounded Aggregate from 120M source rows
  const schema2 = [
    { name: 'channel', type: 'VARCHAR', nullable: false },
    { name: 'total_revenue', type: 'DECIMAL(18,2)', nullable: false },
    { name: 'txn_count', type: 'BIGINT', nullable: false }
  ];
  const rows2 = [
    { channel: 'Gold', total_revenue: '52500000.00', txn_count: 50000000 },
    { channel: 'Platinum', total_revenue: '41200000.50', txn_count: 40000000 },
    { channel: 'Silver', total_revenue: '20100000.25', txn_count: 20000000 },
    { channel: 'Bronze', total_revenue: '10000000.00', txn_count: 10000000 }
  ];
  const input2 = {
    schema: schema2,
    rows: rows2,
    source: {
      sourceId: 'node_120m_agg',
      jobId: 'job_120m_analysis_001',
      resultVersion: 'engine-rev-42',
      state: 'current'
    },
    coverage: {
      kind: 'aggregate',
      sourceRowCount: 120000000,
      resultRowCount: 4,
      transferredRows: 4,
      aggregation: {
        description: 'GROUP BY channel with SUM(amount) and COUNT(*)',
        type: 'SUM'
      }
    },
    columnHints: {
      total_revenue: { unit: 'RON', role: 'measure' },
      txn_count: { unit: 'count', role: 'measure' }
    }
  };

  const snapshot2 = AnalysisToChartsAdapter.transform(input2);
  assert('Aggregate coverage: sourceRowCount is 120,000,000', snapshot2.coverage.sourceRowCount === 120000000);
  assert('Aggregate coverage: resultRowCount is 4', snapshot2.coverage.resultRowCount === 4);
  assert('Aggregate coverage: transferredRows is 4', snapshot2.coverage.transferredRows === 4);
  assert('Aggregate coverage: aggregation description present', Boolean(snapshot2.coverage.aggregation?.description));
  assert('Aggregate snapshot validated by Charts core', Boolean(chartsCore.validateSnapshot(snapshot2)));

  // Test 3: Explicit Sampled Dataset
  const input3 = {
    schema: [
      { name: 'customer_id', type: 'VARCHAR', nullable: false },
      { name: 'score', type: 'DOUBLE', nullable: false }
    ],
    rows: [
      { customer_id: 'CUST-001', score: 88.5 },
      { customer_id: 'CUST-002', score: 92.1 }
    ],
    source: {
      sourceId: 'node_scoring',
      jobId: 'job_sample_01'
    },
    coverage: {
      kind: 'sampled',
      sourceRowCount: 500000,
      resultRowCount: 50000,
      transferredRows: 2,
      selection: {
        method: 'stratified_random_sample',
        description: 'Random sample of 2 representative records from 50,000 computed scores'
      }
    }
  };

  const snapshot3 = AnalysisToChartsAdapter.transform(input3);
  assert('Sampled coverage: resultRowCount > transferredRows', snapshot3.coverage.resultRowCount > snapshot3.coverage.transferredRows);
  assert('Sampled coverage: selection method preserved', snapshot3.coverage.selection.method === 'stratified_random_sample');
  assert('Sampled snapshot validated by Charts core', Boolean(chartsCore.validateSnapshot(snapshot3)));

  // Test 4: ECharts Projection Test via chartsCore.project
  const def = chartsCore.defaultDefinition(snapshot2);
  // Charts requires a common Y unit for multi-series bar charts.
  // We specify a single Y measure 'total_revenue' with matching yUnitLabel 'RON'
  def.y = ['total_revenue'];
  def.yUnitLabel = 'RON';
  let projected = null;
  try {
    projected = chartsCore.project(snapshot2, def);
  } catch (e) {
    console.error('Projection error:', e);
  }
  assert('Charts core project() succeeds on aggregated snapshot', Boolean(projected && projected.series.length > 0));
  assert('Charts project notices include aggregate description', projected?.notices?.some(n => n.includes('aggregate: GROUP BY channel')));

  console.log(`\nAdapter Unit Tests Finished: ${passCount} passed, ${failCount} failed.\n`);
  return { passCount, failCount, results };
}

if (process.argv[1] && process.argv[1].endsWith('test_adapter_unit.mjs')) {
  runUnitTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
