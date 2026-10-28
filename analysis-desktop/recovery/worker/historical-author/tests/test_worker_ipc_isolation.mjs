/**
 * Test Suite 2: Dedicated Child Worker Process, Runtime Attribution & Stale Reply Isolation
 *
 * Verifies:
 *   1. DuckDB executes in an isolated dedicated child process (child PID !== parent PID).
 *   2. Real DuckDB engine version and owning child PID recorded in receipt.
 *   3. Enforces contract 'siren.analysis.execution-receipt/2'.
 *   4. Bounded 50-row transfer preview with full outputRowCount and nullCounts.
 *   5. Strict session binding: delayed / reversed replies from Job A cannot modify Job B.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { WorkerClient } from '../src/worker_client.js';
import { MessageTypes } from '../src/worker_protocol.js';
import {
  compileSingleInputQuery,
  ReceiptVerifier,
  RECEIPT_CONTRACT_VERSION
} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testBaseDir = path.resolve(__dirname, '../storage/test_ipc');
const fixturesDir = path.join(testBaseDir, 'fixtures');

export async function runWorkerIpcIsolationTests() {
  console.log('\n=== SUITE 2: CHILD WORKER PROCESS & STALE REPLY ISOLATION ===\n');

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

  // Create synthetic fixture with 75 rows to verify 50-row bounded capture & full count
  const fixturePath = path.join(fixturesDir, 'records_75.csv');
  let csvData = 'id,value,category\n';
  for (let i = 1; i <= 75; i++) {
    const cat = i % 5 === 0 ? '' : `cat_${i % 3}`;
    csvData += `${String(i).padStart(5, '0')},${(i * 10.5).toFixed(2)},${cat}\n`;
  }
  fs.writeFileSync(fixturePath, csvData, 'utf-8');
  const fixtureSha = crypto.createHash('sha256').update(csvData).digest('hex');

  const inputBinding = {
    snapshotId: 'snap_records_75',
    snapshotPath: fixturePath,
    contentSha256: fixtureSha,
    byteCount: Buffer.byteLength(csvData),
    format: 'csv',
    capturedAt: new Date().toISOString(),
    options: { header: true, delimiter: ',' }
  };

  const compiledQuery = compileSingleInputQuery(inputBinding, {
    orderByClause: 'id ASC'
  });

  console.log('1. Executing Job A via Dedicated Child Process...');
  const sessionTokenA = crypto.randomUUID();
  const resA = await client.execute({
    jobId: 'job_A_bounded',
    attemptId: 'attempt_1',
    sessionToken: sessionTokenA,
    inputs: [inputBinding],
    compiledQuery
  });

  assert('Job A returned success receipt', resA.receipt.status === 'SUCCESS');
  assert('Receipt contract is receipt/2', resA.receipt.contract === RECEIPT_CONTRACT_VERSION);
  assert('Execution ran in dedicated child process (child PID !== parent PID)', resA.workerPid !== process.pid);
  assert('Receipt records child PID in workerId', resA.receipt.compiledExecution.workerId.includes(String(resA.workerPid)));
  assert('Receipt records real DuckDB engine version', typeof resA.engineVersion === 'string' && resA.engineVersion.length > 0);

  console.log('\n2. Verifying Bounded 50-Row Transfer Scope & Full Counts...');
  assert('Captured rows array is bounded to exactly 50 rows', resA.capturedRows.length === 50);
  assert('Total full output row count is 75', resA.receipt.metrics.outputRowCount === '75');
  assert('Transfer status is TRUNCATED for >50 rows', resA.receipt.metrics.transferStatus === 'TRUNCATED');
  assert('Captured rows metric is 50', resA.receipt.metrics.capturedRows === 50);
  assert('Result digest scope is captured-rows', resA.receipt.resultDigestScope === 'captured-rows');

  // Verify receipt with ReceiptVerifier
  const verifierA = await ReceiptVerifier.verifyReceipt(resA.receipt, {
    capturedRows: resA.capturedRows,
    verifyDiskSnapshots: false
  });
  assert('ReceiptVerifier accepts Job A receipt + captured rows', verifierA.valid === true);

  console.log('\n3. Testing Delayed / Reversed Stale Reply Non-Interference...');
  // Start Job B
  const sessionTokenB = crypto.randomUUID();
  const execBPromise = client.execute({
    jobId: 'job_B_current',
    attemptId: 'attempt_1',
    sessionToken: sessionTokenB,
    inputs: [inputBinding],
    compiledQuery
  });

  // Inject a delayed stale message simulating old Job A replying during Job B execution
  const staleMsgFromA = {
    type: MessageTypes.EXECUTE_SUCCESS,
    id: 'msg_old_delayed_A',
    jobId: 'job_A_bounded',
    attemptId: 'attempt_1',
    sessionToken: sessionTokenA, // STALE TOKEN!
    workerPid: resA.workerPid,
    engineVersion: resA.engineVersion,
    receipt: { ...resA.receipt, metrics: { ...resA.receipt.metrics, outputRowCount: '99999' } },
    capturedRows: []
  };

  client.handleMessage(staleMsgFromA);

  assert('Stale reply from Job A was discarded by client', client.staleRepliesDropped > 0);

  const resB = await execBPromise;
  assert('Job B completed successfully without being corrupted by stale Job A', resB.receipt.status === 'SUCCESS');
  assert('Job B receipt maintains correct jobId', resB.receipt.jobId === 'job_B_current');
  assert('Job B output row count is still 75 (not corrupted by A)', resB.receipt.metrics.outputRowCount === '75');

  await client.shutdown();

  console.log(`\nChild Worker IPC Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Child Worker IPC & Stale Reply Isolation', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkerIpcIsolationTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
