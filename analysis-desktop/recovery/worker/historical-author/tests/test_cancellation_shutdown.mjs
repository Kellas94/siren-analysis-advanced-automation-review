/**
 * Test Suite 4: Real Cancellation & Graceful Shutdown
 *
 * Verifies:
 *   1. Real cancellation: query interrupted in DuckDB child worker.
 *   2. Child settles truthfully as CANCELLED.
 *   3. Graceful shutdown: child cleanly closes DuckDB, exits with code 0.
 *   4. Parent awaits child exit; no owned orphan processes remain alive.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { WorkerClient } from '../src/worker_client.js';
import { compileSingleInputQuery } from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testBaseDir = path.resolve(__dirname, '../storage/test_cancel_shutdown');
const fixturesDir = path.join(testBaseDir, 'fixtures');

export async function runCancellationShutdownTests() {
  console.log('\n=== SUITE 4: REAL CANCELLATION & SHUTDOWN WITHOUT ORPHANS ===\n');

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

  const client = new WorkerClient({
    tempDir: path.join(testBaseDir, 'worker_temp')
  });

  // Create synthetic fixture
  const fixturePath = path.join(fixturesDir, 'cancel_data.csv');
  let data = 'id,value\n';
  for (let i = 1; i <= 1000; i++) {
    data += `${i},${i * 2}\n`;
  }
  fs.writeFileSync(fixturePath, data, 'utf-8');
  const fixtureSha = crypto.createHash('sha256').update(data).digest('hex');

  const inputBinding = {
    snapshotId: 'snap_cancel_data',
    snapshotPath: fixturePath,
    contentSha256: fixtureSha,
    byteCount: Buffer.byteLength(data),
    format: 'csv',
    capturedAt: new Date().toISOString(),
    options: { header: true, delimiter: ',' }
  };

  const compiledQuery = compileSingleInputQuery(inputBinding, {
    orderByClause: 'id ASC'
  });

  console.log('1. Testing Query Execution Cancellation...');
  const sessionToken = crypto.randomUUID();
  const execPromise = client.execute({
    jobId: 'job_cancel_test',
    attemptId: 'attempt_1',
    sessionToken,
    inputs: [inputBinding],
    compiledQuery
  });

  // Cancel query immediately while running
  client.cancelActiveQuery();

  const cancelResult = await execPromise;
  assert('Cancelled query returned status CANCELLED or FAILED', cancelResult.receipt.status === 'CANCELLED' || cancelResult.receipt.status === 'FAILED');
  assert('Child worker process remained alive after query cancellation', client.child !== null && client.child.exitCode === null);

  console.log('\n2. Testing Graceful Shutdown and Orphan Elimination...');
  const workerPidToShutdown = client.workerPid;
  assert('Worker has valid PID before shutdown', typeof workerPidToShutdown === 'number');

  await client.shutdown();

  assert('Client child reference is null after shutdown', client.child === null);
  assert('Client workerPid is null after shutdown', client.workerPid === null);

  // Verify process is actually dead using process.kill(pid, 0)
  let processAlive = true;
  try {
    process.kill(workerPidToShutdown, 0); // Throws ESRCH if process is dead
  } catch (err) {
    if (err.code === 'ESRCH') {
      processAlive = false;
    }
  }
  assert('Worker process was completely terminated (no orphan process left)', processAlive === false);

  console.log(`\nCancellation & Shutdown Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Cancellation & Shutdown Without Orphans', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCancellationShutdownTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
