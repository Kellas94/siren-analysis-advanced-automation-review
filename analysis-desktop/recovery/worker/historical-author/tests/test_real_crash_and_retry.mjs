/**
 * Test Suite 3: Real Worker Process Crash & Fresh Retry
 *
 * Verifies:
 *   1. Real child worker process crash (NOT simulateCrash: true).
 *   2. Violent process termination (SIGKILL / exit 137) is accurately detected by parent.
 *   3. Job attempt 1 is settled as CRASHED with real child PID and exit status.
 *   4. Leases are released after crash.
 *   5. Retry uses fresh attempt (attempt_2) with new session token and fresh worker process.
 *   6. Retry uses the exact same reverified sealed snapshot from catalog (does NOT recapture original).
 *   7. Retry completes with SUCCESS status and retryCount: 1.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RecoveryOrchestrator } from '../src/recovery_orchestrator.js';
import { compileSingleInputQuery } from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testBaseDir = path.resolve(__dirname, '../storage/test_crash_retry');
const fixturesDir = path.join(testBaseDir, 'fixtures');

export async function runRealCrashAndRetryTests() {
  console.log('\n=== SUITE 3: REAL WORKER PROCESS CRASH & FRESH RETRY ===\n');

  let passCount = 0;
  let failCount = 0;
  const testResults = [];

  function assert(name, condition, extra = '') {
    if (condition) {
      passCount++;
      testResults.push({ name, status: 'PASS' });
      console.log(`  [PASS] ${name}`);
    } else {
      failCount++;
      testResults.push({ name, status: 'FAIL', extra });
      console.error(`  [FAIL] ${name} ${extra}`);
    }
  }

  if (fs.existsSync(testBaseDir)) {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(fixturesDir, { recursive: true });

  const orchestrator = new RecoveryOrchestrator({
    baseDir: testBaseDir
  });

  // Create synthetic fixture
  const fixturePath = path.join(fixturesDir, 'crash_test_data.csv');
  const csvContent = 'id,value\n001,10.5\n002,20.5\n003,30.5\n';
  fs.writeFileSync(fixturePath, csvContent, 'utf-8');

  console.log('1. Capturing Input Snapshot...');
  const snapshot = await orchestrator.captureInput(fixturePath, { nodeId: 'node_source' });
  assert('Snapshot captured and registered in catalog', snapshot.snapshotId.startsWith('snap_'));
  assert('Snapshot is in sealed storage', fs.existsSync(snapshot.snapshotPath));

  const compiledQuery = compileSingleInputQuery(snapshot, {
    orderByClause: 'id ASC'
  });

  console.log('\n2. Triggering Real Worker Process Kill (SIGKILL)...');
  // Spawn worker
  orchestrator.workerClient.ensureWorker();
  const originalWorkerPid = orchestrator.workerClient.workerPid;
  assert('Child worker process is alive with real PID', typeof originalWorkerPid === 'number' && originalWorkerPid > 0);

  // Start execution and inject crash concurrently
  let crashError = null;
  const execPromise = orchestrator.executeJob({
    jobId: 'job_crashed_test',
    inputs: [snapshot],
    compiledQuery
  }).catch((err) => {
    crashError = err;
  });

  // Await until activeRequest is established on the worker
  while (!orchestrator.workerClient.activeRequest) {
    await new Promise((r) => setImmediate(r));
  }
  const workerPidToKill = orchestrator.workerClient.workerPid;

  // Immediately kill worker process violently with SIGKILL
  await orchestrator.workerClient.killWorkerProcess('SIGKILL');
  await execPromise;

  assert('Job execution was rejected due to real worker exit', crashError !== null);
  assert('Error code is JOB_CRASHED', crashError?.code === 'JOB_CRASHED');
  assert('Error records crashed worker PID', crashError?.workerPid === workerPidToKill);

  // Check catalog record
  const catalogJob = orchestrator.catalog.jobs.get('job_crashed_test');
  assert('Catalog records job status as CRASHED', catalogJob?.status === 'CRASHED');
  assert('Catalog records attempt 1 as CRASHED', catalogJob?.attempts[0]?.status === 'CRASHED');
  assert('Lease on snapshot was released after crash', orchestrator.catalog.isLeased(snapshot.snapshotId) === false);

  console.log('\n3. Executing Fresh Retry for job_crashed_test...');
  // Original file is mutated on disk to prove retry uses the SAME snapshot, not live original!
  fs.appendFileSync(fixturePath, '004,999.9\n005,999.9\n');

  const retryResult = await orchestrator.retryJob('job_crashed_test', compiledQuery, [snapshot]);

  assert('Retry succeeded with SUCCESS status', retryResult.receipt.status === 'SUCCESS');
  assert('Retry spawned fresh worker process with new PID', retryResult.workerPid !== originalWorkerPid);
  assert('Retry receipt records retryCount: 1', retryResult.receipt.lifecycle.retryCount === 1);
  assert('Output row count is 3 (unaffected by appended rows in original)', retryResult.capturedRows.length === 3);

  // Check catalog after retry
  const updatedJob = orchestrator.catalog.jobs.get('job_crashed_test');
  assert('Catalog job status updated to SUCCESS', updatedJob.status === 'SUCCESS');
  assert('Catalog records 2 attempts total', updatedJob.attempts.length === 2);
  assert('Catalog attempt 2 status is SUCCESS', updatedJob.attempts[1].status === 'SUCCESS');

  await orchestrator.shutdown();

  console.log(`\nReal Crash & Retry Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Real Worker Crash & Fresh Retry', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRealCrashAndRetryTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
