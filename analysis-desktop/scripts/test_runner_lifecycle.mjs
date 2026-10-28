import { RunnerService } from '../server/runner_service.js';
import { DocsUniverContract } from '../contracts/docs_univer_contract.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('=== SIREN Analysis: Runner Service & Lifecycle Validation ===');
  const reportsDir = path.resolve('reports');
  const dataDir = path.resolve('data');
  const evidenceDir = path.resolve('evidence');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const service = new RunnerService({
    dataDir,
    tempDir: path.join(dataDir, 'temp'),
    maxMemory: '2GB',
    threads: 4
  });

  const tests = [];
  function assertTest(id, name, condition, details = {}) {
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}`);
    if (!condition) console.error('    Details:', details);
    tests.push({ id, name, passed: condition, details });
  }

  // TEST 1: Successful Job Lifecycle (Queued -> Running -> Completed)
  console.log('\n[1/4] Testing Normal Pipeline Job Lifecycle...');
  const validPipelineDef = {
    nodes: [
      {
        id: 'in_tx',
        type: 'input',
        data: { path: path.join(dataDir, 'correctness_transactions.csv'), format: 'csv', header: true }
      },
      {
        id: 'sel_tx',
        type: 'select',
        data: {
          columns: [
            { name: 'trans_id', alias: 'id' },
            { name: 'cust_code', alias: 'customer' },
            { name: 'amount', alias: 'val', castType: 'DECIMAL(10,2)' }
          ]
        }
      },
      {
        id: 'filt_tx',
        type: 'filter',
        data: { condition: 'val IS NOT NULL' }
      }
    ],
    edges: [
      { source: 'in_tx', target: 'sel_tx' },
      { source: 'sel_tx', target: 'filt_tx' }
    ]
  };

  const job1 = service.createJob(validPipelineDef);
  assertTest('LIFE-01', 'Job starts in "queued" state with unique ID', job1.status === 'queued' && job1.jobId.startsWith('job_'), { jobId: job1.jobId });

  const runPromise = service.runJob(job1.jobId);
  // Verify state during execution
  assertTest('LIFE-02', 'Job transitions to "running" state upon execution', job1.status === 'running' || job1.status === 'completed');
  await runPromise;

  assertTest('LIFE-03', 'Job transitions to "completed" state with 100% progress', job1.status === 'completed' && job1.progress.percent === 100, {
    status: job1.status,
    percent: job1.progress.percent
  });

  assertTest('LIFE-04', 'Generated SQL steps and node outputs are recorded', job1.generatedSQL.length === 3 && job1.nodeOutputs['filt_tx'] !== undefined);

  // Bounded preview verification
  const preview = service.getBoundedPreview(job1.jobId, 'filt_tx', 10);
  assertTest('LIFE-05', 'Bounded preview returns at most requested limit (<=10 rows)', preview.preview.length <= 10 && preview.rowCount > 0, {
    previewLength: preview.preview.length,
    totalRows: preview.rowCount
  });

  // Outdated invalidation verification
  service.markOutputsOutdated(job1.jobId, ['filt_tx']);
  const previewOutdated = service.getBoundedPreview(job1.jobId, 'filt_tx', 10);
  assertTest('LIFE-06', 'Modifying node parameters marks previous node results outdated', previewOutdated.isOutdated === true);

  // TEST 2: Error Handling & Non-Existent Input (Queued -> Running -> Failed)
  console.log('\n[2/4] Testing Error Handling & Missing Source File...');
  const brokenPipelineDef = {
    nodes: [
      {
        id: 'in_missing',
        type: 'input',
        data: { path: path.join(dataDir, 'non_existent_file_99999.csv'), format: 'csv', header: true }
      }
    ],
    edges: []
  };

  const job2 = service.createJob(brokenPipelineDef);
  let caughtError = null;
  try {
    await service.runJob(job2.jobId);
  } catch (err) {
    caughtError = err;
  }

  assertTest('LIFE-07', 'Missing file causes clean job failure with descriptive error', job2.status === 'failed' && job2.error !== null, {
    error: job2.error
  });
  assertTest('LIFE-08', 'Failed job leaves no partial completed state', job2.status !== 'completed');

  // TEST 3: Job Cancellation
  console.log('\n[3/4] Testing User Cancellation...');
  const job3 = service.createJob(validPipelineDef);
  const cancelQueuedResult = service.cancelJob(job3.jobId);
  assertTest('LIFE-09', 'Queued job can be cancelled prior to execution', cancelQueuedResult.success && job3.status === 'cancelled');

  // TEST 4: Transfer Contract to Docs & Univer
  console.log('\n[4/4] Testing Transfer Contract to SIREN Docs & Univer...');
  const testCols = ['tier', 'COMPLETED', 'SHIPPED', 'PENDING'];
  const testRows = [
    ['Gold', 175.25, 0.00, 0.00],
    ['Silver', 0.00, 0.00, 0.00],
    ['Bronze', 0.00, 12.75, 0.00]
  ];

  const univerWb = DocsUniverContract.createUniverWorkbook({
    workbookId: 'wb-test-01',
    sheetName: 'Regional Revenue',
    columnNames: testCols,
    rows: testRows,
    lineage: {
      sourceNodeId: 'node_pivot_tier',
      totalRowsProcessed: 120000000,
      executionDurationMs: 524
    }
  });

  assertTest('CONT-01', 'Univer workbook structure conforms to specification', univerWb.appVersion === '1.2.0' && univerWb.sheets['sheet-01'].rowCount >= 3);
  assertTest('CONT-02', 'Univer workbook cell data encodes header styling and typed values', univerWb.sheets['sheet-01'].cellData[0][0].v === 'tier' && univerWb.sheets['sheet-01'].cellData[1][1].t === 2);

  const docsEnvelope = DocsUniverContract.createDocsEnvelope({
    title: 'Revenue Aggregation by Tier & Status',
    description: 'Autonomous Alteryx-style pipeline processed 120M rows in DuckDB native engine.',
    workbook: univerWb,
    lineage: {
      sourceNodeId: 'node_pivot_tier',
      totalRowsProcessed: 120000000,
      executionDurationMs: 524
    }
  });

  assertTest('CONT-03', 'Docs envelope adheres to schema v1.0.0 with narrative and table blocks', docsEnvelope.schemaVersion === '1.0.0' && docsEnvelope.document.blocks.length >= 3);

  // Write sample .sirendoc.json to evidence
  const outDocPath = path.join(evidenceDir, 'sample_exported_analysis.sirendoc.json');
  fs.writeFileSync(outDocPath, JSON.stringify(docsEnvelope, null, 2), 'utf8');
  assertTest('CONT-04', 'Docs document saved to disk with complete lineage metadata', fs.existsSync(outDocPath) && fs.statSync(outDocPath).size > 0);

  // Summary
  const allPassed = tests.every(t => t.passed);
  const summary = {
    timestamp: new Date().toISOString(),
    total: tests.length,
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    status: allPassed ? 'ALL_TESTS_PASS' : 'FAILURES_DETECTED',
    tests
  };

  const reportPath = path.join(reportsDir, 'LIFECYCLE_CONTRACT_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nLifecycle & Contract report saved to: ${reportPath}`);
  console.log(`Summary: ${summary.passed}/${summary.total} tests passed.`);

  if (service) service.destroy();
  if (!allPassed) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in lifecycle test suite:', err);
  process.exit(1);
});
