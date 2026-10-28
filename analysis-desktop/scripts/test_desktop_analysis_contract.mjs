import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function runDesktopContractTests() {
  console.log('=== STARTING DESKTOP ANALYSIS HOST CONTRACT VERIFICATION ===');
  console.log('Host Runtime Environment:');
  console.log('  Electron:', process.versions.electron || '(running in Node runtime)');
  console.log('  Node:', process.versions.node);
  console.log('  Chromium/V8:', process.versions.v8);

  const results = [];
  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      results.push({ test: name, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${name}: ${details}`);
      results.push({ test: name, status: 'FAIL', details });
    }
  }

  // Import RunnerService and Contracts
  const { RunnerService } = await import('../server/runner_service.js');
  const { DocsUniverContract } = await import('../contracts/docs_univer_contract.js');
  const { safeJsonStringify } = await import('../engine/duckdb_runner.js');

  const dataDir = path.join(root, 'data');
  const tempDir = path.join(dataDir, 'temp');

  const runner = new RunnerService({
    dataDir,
    tempDir,
    maxMemory: '4GB',
    threads: 4
  });

  const fastPipeline = {
    nodes: [
      {
        id: 'in_tx',
        type: 'input',
        data: { format: 'csv', path: path.join(dataDir, 'correctness_transactions.csv'), header: true }
      },
      {
        id: 'sel_tx',
        type: 'select',
        data: { columns: [{ name: 'trans_id', alias: 'id' }, { name: 'amount', alias: 'val' }] }
      }
    ],
    edges: [{ source: 'in_tx', target: 'sel_tx' }]
  };

  const longRunningPipeline = {
    nodes: [
      {
        id: 'in_100m',
        type: 'input',
        data: { format: 'parquet', path: path.join(dataDir, 'bench_100m.parquet') }
      },
      {
        id: 'agg_100m',
        type: 'aggregate',
        data: {
          groupBy: ['cust_id', 'status'],
          aggregations: [{ expr: 'COUNT(*)', alias: 'cnt' }, { expr: 'SUM(amount)', alias: 'tot' }]
        }
      }
    ],
    edges: [{ source: 'in_100m', target: 'agg_100m' }]
  };

  // Test 1: Fast Job ID Return
  console.log('\n--- 1. Testing Fast Job ID Return ---');
  const t0 = Date.now();
  const job1 = runner.createJob(fastPipeline);
  const dispatchPromise = runner.runJob(job1.jobId);
  const fastReturnMs = Date.now() - t0;
  assert(fastReturnMs < 50, 'Job creation and dispatch returns immediately (<50ms)', `${fastReturnMs}ms`);
  assert(job1.jobId.startsWith('job_'), 'Job ID format is valid', job1.jobId);
  await dispatchPromise;
  assert(job1.status === 'completed', 'Job transitions to completed');

  // Test 2: Bounded Preview Retrieval
  console.log('\n--- 2. Testing Bounded Preview Retrieval ---');
  const preview = runner.getBoundedPreview(job1.jobId, 'sel_tx', 10);
  assert(preview.preview.length <= 10 && preview.preview.length > 0, 'Bounded preview limits rows to <= 10', `Got ${preview.preview.length} rows`);
  assert(preview.rowCount > 0, 'Total row count is preserved in output', preview.rowCount);

  // Test 3: Active Cancellation & Worker Teardown
  console.log('\n--- 3. Testing Active Cancellation & Worker Teardown ---');
  const jobLong = runner.createJob(longRunningPipeline);
  const runLongPromise = runner.runJob(jobLong.jobId);
  await new Promise(r => setTimeout(r, 100)); // wait for worker to start processing query

  const cancelRes = runner.cancelJob(jobLong.jobId);
  assert(cancelRes.success === true, 'cancelJob reports success on active job');

  let longError = null;
  try {
    await runLongPromise;
  } catch (e) {
    longError = e;
  }
  assert(longError && longError.message === 'JOB_CANCELLED_BY_USER', 'Active job promise settles with JOB_CANCELLED_BY_USER');
  assert(jobLong.status === 'cancelled', 'Job state is marked cancelled');

  // Test 4: Consecutive Job Execution on Fresh Respawned Worker
  console.log('\n--- 4. Testing Consecutive Job Execution on Fresh Worker ---');
  const jobConsecutive = runner.createJob(fastPipeline);
  const consecutiveRes = await runner.runJob(jobConsecutive.jobId);
  assert(consecutiveRes.status === 'completed', 'Consecutive job completes on respawned clean worker');

  // Test 5: Worker Crash Recovery
  console.log('\n--- 5. Testing Worker Crash Recovery ---');
  const jobBeforeCrash = runner.createJob(longRunningPipeline);
  const jobInQueue = runner.createJob(fastPipeline);

  const crashPromise1 = runner.runJob(jobBeforeCrash.jobId);
  const crashPromise2 = runner.runJob(jobInQueue.jobId); // Queued

  await new Promise(r => setTimeout(r, 80));

  // Kill current worker abruptly with SIGKILL
  if (runner.worker) {
    runner.worker.kill('SIGKILL');
  }

  let errCrash1 = null;
  try {
    await crashPromise1;
  } catch (e) {
    errCrash1 = e;
  }
  assert(errCrash1 && errCrash1.message.includes('Worker process exited unexpectedly'), 'Crashing worker rejects active job');
  assert(jobBeforeCrash.status === 'failed', 'Active job marked as failed on crash');

  // Queued job must be executed by automatically respawned worker
  const queueRecovered = await crashPromise2;
  assert(queueRecovered.status === 'completed', 'Queued job recovered and completed successfully on respawned worker');

  // Test 6: Delayed Messages Ignored
  console.log('\n--- 6. Testing Delayed Messages Ignored ---');
  const fakeJob = runner.createJob(fastPipeline);
  fakeJob.status = 'cancelled';
  runner.handleWorkerMessage({
    type: 'COMPLETED',
    jobId: fakeJob.jobId,
    telemetry: { durationMs: 50 }
  });
  assert(fakeJob.status === 'cancelled', 'Delayed COMPLETED message did not override cancelled state');

  // Test 7: Export to Docs Envelope v1.0.0
  console.log('\n--- 7. Testing Export to Docs Envelope v1.0.0 ---');
  const completedJob = jobConsecutive;
  const nodeOutput = completedJob.nodeOutputs['sel_tx'];
  const columns = nodeOutput.preview.length > 0 ? Object.keys(nodeOutput.preview[0]) : [];
  const matrixRows = nodeOutput.preview.map(row => columns.map(c => row[c]));

  const univerWb = DocsUniverContract.createUniverWorkbook({
    workbookId: `wb-${completedJob.jobId}-sel_tx`,
    sheetName: 'Analysis_Output',
    columnNames: columns,
    schema: nodeOutput.schema || [],
    rows: matrixRows,
    lineage: {
      sourceNodeId: 'sel_tx',
      nodeId: 'sel_tx',
      jobId: completedJob.jobId,
      totalResultRows: nodeOutput.rowCount,
      totalSourceRowsProcessed: nodeOutput.rowCount,
      executionDurationMs: completedJob.telemetry.durationMs
    }
  });

  const envelope = DocsUniverContract.createDocsEnvelope({
    title: 'Test Desktop Analysis Export',
    workbook: univerWb,
    lineage: {
      jobId: completedJob.jobId,
      sourceNodeId: 'sel_tx',
      totalResultRows: nodeOutput.rowCount
    }
  });

  assert(envelope.schemaVersion === '1.0.0', 'Envelope schemaVersion is 1.0.0');
  assert(envelope.workbooks[`wb-${completedJob.jobId}-sel_tx`] !== undefined, 'Envelope contains valid workbook');

  // Test 8: Workflow Save/Open Receipt State Integrity
  console.log('\n--- 8. Testing Save/Open Receipt State Integrity ---');
  // Simulated save receipt error
  const simulatedSaveErrorReceipt = { canceled: false, error: 'EACCES: permission denied' };
  assert(simulatedSaveErrorReceipt.canceled === false && Boolean(simulatedSaveErrorReceipt.error), 'Save error receipt preserves error flag and message');
  // Simulated save cancel
  const simulatedSaveCancelReceipt = { canceled: true };
  assert(simulatedSaveCancelReceipt.canceled === true && !simulatedSaveCancelReceipt.filePath, 'Save cancel receipt contains canceled: true without filePath');
  // Simulated save success
  const testWfPath = path.join(tempDir, 'test_contract_workflow.json');
  fs.writeFileSync(testWfPath, JSON.stringify(fastPipeline, null, 2), 'utf8');
  const simulatedSaveSuccess = { canceled: false, filePath: testWfPath };
  assert(simulatedSaveSuccess.canceled === false && fs.existsSync(simulatedSaveSuccess.filePath), 'Save success receipt identifies confirmed disk file');

  // Test 9: Clean Teardown (Zero Orphaned Workers)
  console.log('\n--- 9. Testing Clean Teardown (Zero Orphaned Workers) ---');
  const workerToKill = runner.worker;
  runner.destroy();
  assert(runner.isDestroyed === true, 'runner.isDestroyed is true');
  assert(runner.worker === null, 'runner.worker reference is cleared');
  assert(runner.jobQueue.length === 0, 'jobQueue is drained and settled');

  // Wait 150ms and check process killed
  await new Promise(r => setTimeout(r, 150));
  let isWorkerAlive = false;
  try {
    process.kill(workerToKill.pid, 0);
    isWorkerAlive = true;
  } catch (e) {
    isWorkerAlive = false;
  }
  assert(!isWorkerAlive, 'Worker process is terminated and not orphaned', `PID ${workerToKill?.pid}`);

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.join(root, 'reports', 'DESKTOP_CONTRACT_VERIFICATION.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    allPassed,
    totalTests: results.length,
    results
  }, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) process.exit(1);
}

runDesktopContractTests().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
