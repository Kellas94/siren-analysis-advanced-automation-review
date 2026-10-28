import { RunnerService } from '../server/runner_service.js';
import { DuckDBRunner } from '../engine/duckdb_runner.js';
import fs from 'node:fs';
import path from 'node:path';

async function runDeepLifecycleTests() {
  console.log('=== STARTING DEEP LIFECYCLE & CANCELLATION TESTS ===');
  const results = [];
  const dataDir = path.resolve('data');

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      results.push({ test: testName, status: 'PASS', details });
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      results.push({ test: testName, status: 'FAIL', details });
    }
  }

  // --- TEST 1: DuckDBRunner.close() native connection teardown ---
  console.log('\n--- 1. Testing DuckDBRunner.close() teardown ---');
  try {
    const runner = new DuckDBRunner({ dbPath: ':memory:' });
    await runner.initialize();
    const rows = await runner.queryRows('SELECT 1 AS num');
    assert(rows[0][0] === 1, 'DuckDB query succeeds before close', `Got: ${rows[0][0]}`);

    const nativeConn = runner.connection;
    await runner.close();
    assert(runner.connection === null, 'DuckDBRunner sets connection to null after close');
    assert(runner.instance === null, 'DuckDBRunner sets instance to null after close');

    // Attempting to run via runner throws
    let threwOnClosed = false;
    try {
      await runner.run('SELECT 1');
    } catch (e) {
      threwOnClosed = true;
    }
    assert(threwOnClosed, 'Runner.run throws when closed');

    // Attempting to run on native connection throws because closeSync was invoked
    let nativeConnFailed = false;
    try {
      await nativeConn.run('SELECT 1');
    } catch (e) {
      nativeConnFailed = true;
    }
    assert(nativeConnFailed, 'Native connection is closed and rejects queries');
  } catch (err) {
    assert(false, 'DuckDBRunner.close() teardown', err.message);
  }

  // Real pipelines
  // Long running pipeline against bench_100m.parquet
  const longRunningPipeline = {
    nodes: [
      {
        id: 'in_bench',
        type: 'input',
        data: { path: path.join(dataDir, 'bench_100m.parquet'), format: 'parquet' }
      },
      {
        id: 'agg_bench',
        type: 'aggregate',
        data: {
          groupBy: ['customer_id', 'status'],
          aggregations: [
            { expr: 'COUNT(*)', alias: 'cnt' },
            { expr: 'SUM(amount)', alias: 'total_amount' }
          ]
        }
      }
    ],
    edges: [
      { source: 'in_bench', target: 'agg_bench' }
    ]
  };

  // Fast pipeline against correctness_transactions.csv
  const fastPipeline = {
    nodes: [
      {
        id: 'in_fast',
        type: 'input',
        data: { path: path.join(dataDir, 'correctness_transactions.csv'), format: 'csv', header: true }
      },
      {
        id: 'sel_fast',
        type: 'select',
        data: { columns: [{ name: 'trans_id', alias: 'id' }] }
      }
    ],
    edges: [
      { source: 'in_fast', target: 'sel_fast' }
    ]
  };

  // --- TEST 2: Cancel during active query ---
  console.log('\n--- 2. Testing cancel during active query ---');
  let service = new RunnerService();
  try {
    const jobActive = service.createJob(longRunningPipeline);
    const runPromise = service.runJob(jobActive.jobId);

    // Wait a brief moment to ensure worker starts query
    await new Promise(r => setTimeout(r, 120));

    assert(jobActive.status === 'running', 'Active job is running');
    const cancelRes = service.cancelJob(jobActive.jobId);
    assert(cancelRes.success === true, 'cancelJob returned success for active job');

    let errorCaught = null;
    try {
      await runPromise;
    } catch (err) {
      errorCaught = err;
    }
    assert(errorCaught !== null && errorCaught.message === 'JOB_CANCELLED_BY_USER',
      'Active job promise rejects with JOB_CANCELLED_BY_USER',
      errorCaught ? errorCaught.message : 'No error'
    );
    assert(jobActive.status === 'cancelled', 'Active job status is cancelled');

    // Verify fresh worker is ready and can execute next job
    const jobAfter = service.createJob(fastPipeline);
    const afterRes = await service.runJob(jobAfter.jobId);
    assert(afterRes.status === 'completed', 'Subsequent job on fresh worker completes successfully');
  } catch (err) {
    assert(false, 'Cancel during active query test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 3: Job A active, B in queue, cancel B ---
  console.log('\n--- 3. Testing Job A active, B in queue, cancel B ---');
  service = new RunnerService();
  try {
    const jobA = service.createJob(longRunningPipeline);
    const jobB = service.createJob(fastPipeline);

    const promiseA = service.runJob(jobA.jobId);
    const promiseB = service.runJob(jobB.jobId); // Queued

    assert(jobA.status === 'running', 'Job A is running');
    assert(jobB.status === 'queued', 'Job B is queued');
    assert(service.jobQueue.length === 1, 'Job queue length is 1');

    // Cancel queued job B
    const cancelBRes = service.cancelJob(jobB.jobId);
    assert(cancelBRes.success === true, 'cancelJob returned success for queued job B');
    assert(service.jobQueue.length === 0, 'Job queue length is 0 after cancelling B');

    let errB = null;
    try {
      await promiseB;
    } catch (err) {
      errB = err;
    }
    assert(errB !== null && errB.message === 'JOB_CANCELLED_IN_QUEUE',
      'Queued job B promise rejects immediately with JOB_CANCELLED_IN_QUEUE',
      errB ? errB.message : 'No error'
    );
    assert(jobB.status === 'cancelled', 'Job B status is cancelled');

    // Now cancel A
    service.cancelJob(jobA.jobId);
    try { await promiseA; } catch (e) {}
  } catch (err) {
    assert(false, 'A active, B in queue, cancel B test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 4: Cancel A followed by B executing on fresh worker ---
  console.log('\n--- 4. Testing Cancel A followed by B executing on fresh worker ---');
  service = new RunnerService();
  try {
    const jobA = service.createJob(longRunningPipeline);
    const jobB = service.createJob(fastPipeline);

    const promiseA = service.runJob(jobA.jobId);
    const promiseB = service.runJob(jobB.jobId);

    await new Promise(r => setTimeout(r, 100));

    // Cancel A
    service.cancelJob(jobA.jobId);

    let errA = null;
    try {
      await promiseA;
    } catch (e) {
      errA = e;
    }
    assert(errA !== null && errA.message === 'JOB_CANCELLED_BY_USER', 'Job A rejects with JOB_CANCELLED_BY_USER');

    // B should automatically run on the fresh worker and resolve
    const resB = await promiseB;
    assert(resB.status === 'completed', 'Job B automatically ran and completed on fresh worker');
    assert(jobB.status === 'completed', 'Job B status is completed');
  } catch (err) {
    assert(false, 'Cancel A followed by B test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 5: Crash A with B in queue ---
  console.log('\n--- 5. Testing Crash A with B in queue ---');
  service = new RunnerService();
  try {
    const jobA = service.createJob(longRunningPipeline);
    const jobB = service.createJob(fastPipeline);

    const promiseA = service.runJob(jobA.jobId);
    const promiseB = service.runJob(jobB.jobId);

    await new Promise(r => setTimeout(r, 100));

    // Simulate unexpected crash of worker running A
    if (service.worker) {
      service.worker.kill('SIGKILL');
    }

    let errA = null;
    try {
      await promiseA;
    } catch (e) {
      errA = e;
    }
    assert(errA !== null && errA.message.includes('Worker process exited unexpectedly'),
      'Job A rejects due to unexpected worker exit', errA ? errA.message : 'No error');
    assert(jobA.status === 'failed', 'Job A marked as failed');

    // Job B should still be picked up by the respawned worker and complete!
    const resB = await promiseB;
    assert(resB.status === 'completed', 'Job B in queue recovered and completed on respawned worker');
  } catch (err) {
    assert(false, 'Crash A with B in queue test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 6: Multiple cancellations on same job ---
  console.log('\n--- 6. Testing multiple cancellations on same job ---');
  service = new RunnerService();
  try {
    const job = service.createJob(fastPipeline);
    const promise = service.runJob(job.jobId);
    
    // First cancel
    const c1 = service.cancelJob(job.jobId);
    assert(c1.success === true, 'First cancel succeeds');

    // Second cancel on now terminal job
    const c2 = service.cancelJob(job.jobId);
    assert(c2.success === false, 'Second cancel returns false because job is terminal');

    try { await promise; } catch (e) {}
  } catch (err) {
    assert(false, 'Multiple cancellations test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 7: Delayed worker messages ignored after cancellation ---
  console.log('\n--- 7. Testing delayed messages ignored ---');
  service = new RunnerService();
  try {
    const job = service.createJob(fastPipeline);
    job.status = 'cancelled'; // simulate already cancelled

    // Send fake completed message
    service.handleWorkerMessage({
      type: 'COMPLETED',
      jobId: job.jobId,
      telemetry: { durationMs: 10 }
    });

    assert(job.status === 'cancelled', 'Job remains cancelled despite delayed COMPLETED message');
  } catch (err) {
    assert(false, 'Delayed messages test failed', err.message);
  } finally {
    service.destroy();
  }

  // --- TEST 8: destroy() without accidental respawn ---
  console.log('\n--- 8. Testing destroy() without accidental respawn ---');
  service = new RunnerService();
  try {
    const job1 = service.createJob(longRunningPipeline);
    const job2 = service.createJob(fastPipeline);

    const p1 = service.runJob(job1.jobId);
    const p2 = service.runJob(job2.jobId);

    await new Promise(r => setTimeout(r, 100));

    service.destroy();

    assert(service.isDestroyed === true, 'service.isDestroyed is true');
    assert(service.worker === null, 'service.worker is null');
    assert(service.activeJobId === null, 'service.activeJobId is null');
    assert(service.jobQueue.length === 0, 'service.jobQueue is empty');

    let err1 = null;
    let err2 = null;
    try { await p1; } catch (e) { err1 = e; }
    try { await p2; } catch (e) { err2 = e; }

    assert(err1 !== null && err1.message === 'RUNNER_SERVICE_DESTROYED', 'Active job rejected with RUNNER_SERVICE_DESTROYED');
    assert(err2 !== null && err2.message === 'RUNNER_SERVICE_DESTROYED', 'Queued job rejected with RUNNER_SERVICE_DESTROYED');

    // Wait 250ms to ensure no worker process respawns
    await new Promise(r => setTimeout(r, 250));
    assert(service.worker === null, 'No worker respawned after destroy()');
  } catch (err) {
    assert(false, 'destroy() test failed', err.message);
  }

  const allPassed = results.every(r => r.status === 'PASS');
  console.log(`\n=== RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);

  const reportPath = path.resolve('reports/LIFECYCLE_CANCELLATION_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    allPassed,
    totalTests: results.length,
    results
  }, null, 2));
  console.log(`Report written to ${reportPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runDeepLifecycleTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
