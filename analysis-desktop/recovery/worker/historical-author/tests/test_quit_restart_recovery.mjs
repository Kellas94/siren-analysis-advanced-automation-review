/**
 * Test Suite 5: Normal Quit, Restart, Cold Recovery & Stale Lease Reconciliation
 *
 * Demonstrates:
 *   1. save → normalQuit → new parent process → reopen & cold discovery.
 *   2. Re-hashes sealed copies and confirms physical disk integrity.
 *   3. Restores exact saved receipts and captured rows.
 *   4. Original file modified after capture does NOT affect restored state.
 *   5. Incomplete jobs interrupted by crash are reconciled to INTERRUPTED (never SUCCESS).
 *   6. Stale leases are cleared on restart.
 *   7. Restored receipt passes ReceiptVerifier with captured rows scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecoveryOrchestrator } from '../src/recovery_orchestrator.js';
import {
  compileSingleInputQuery,
  ReceiptVerifier
} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testBaseDir = path.resolve(__dirname, '../storage/test_recovery');
const fixturesDir = path.join(testBaseDir, 'fixtures');

export async function runQuitRestartRecoveryTests() {
  console.log('\n=== SUITE 5: NORMAL QUIT, RESTART & COLD RECOVERY ===\n');

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

  console.log('1. Setting Up and Running Initial Job in Session 1...');
  const originalSourcePath = path.join(fixturesDir, 'account_balances.csv');
  const sourceContent = 'account_id,balance\nACC_001,1500.50\nACC_002,2500.75\nACC_003,500.00\n';
  fs.writeFileSync(originalSourcePath, sourceContent, 'utf-8');

  let orchestrator1 = new RecoveryOrchestrator({ baseDir: testBaseDir });

  const snapshot = await orchestrator1.captureInput(originalSourcePath, { nodeId: 'node_accounts' });
  assert('Snapshot captured in Session 1', snapshot.snapshotId.startsWith('snap_'));

  const compiledQuery = compileSingleInputQuery(snapshot, {
    orderByClause: 'account_id ASC'
  });

  const job1Result = await orchestrator1.executeJob({
    jobId: 'job_accounts_01',
    inputs: [snapshot],
    compiledQuery
  });

  assert('Job accounts 01 succeeded in Session 1', job1Result.receipt.status === 'SUCCESS');
  assert('Captured rows length is 3', job1Result.capturedRows.length === 3);

  // Invalidate a dummy job by putting it into RUNNING state to simulate an in-flight crash
  await orchestrator1.catalog.recordJobAttemptStart('job_crashed_midflight', {
    attemptId: 'attempt_1',
    sessionToken: 'sess_lost',
    workerPid: 99999,
    inputs: [snapshot]
  });
  // Add a dummy stale lease
  orchestrator1.catalog.acquireLease(snapshot.snapshotId, 'job_crashed_midflight:attempt_1:sess_lost');
  assert('Snapshot is reported as leased before shutdown', orchestrator1.catalog.isLeased(snapshot.snapshotId) === true);

  console.log('\n2. Executing Normal Quit in Session 1...');
  await orchestrator1.shutdown();
  orchestrator1 = null; // Session 1 terminates completely

  console.log('\n3. Mutating Original Source File on Disk (Post-Quit)...');
  fs.appendFileSync(originalSourcePath, 'ACC_004,9999.99\nACC_005,8888.88\n');

  console.log('\n4. Starting Session 2 (New Parent Process / Reopen)...');
  const orchestrator2 = new RecoveryOrchestrator({ baseDir: testBaseDir });
  const recoveryReport = await orchestrator2.recover();

  assert('Cold recovery reported recovered: true', recoveryReport.recovered === true);
  assert('Recovered snapshot count is 1', recoveryReport.snapshotCount === 1);
  assert('Snapshot was re-hashed and verified intact on disk', recoveryReport.snapshotVerificationResults[0].intact === true);

  console.log('\n5. Verifying Reconciled State in Session 2...');
  const restoredJob1 = orchestrator2.catalog.jobs.get('job_accounts_01');
  assert('Restored Job 1 status is SUCCESS', restoredJob1.status === 'SUCCESS');
  assert('Restored Job 1 receipt is valid', restoredJob1.receiptValid === true);
  assert('Restored Job 1 capturedRows length is 3 (unaffected by original file mutation)', restoredJob1.capturedRows.length === 3);

  // Interrupted job check
  const interruptedJob = orchestrator2.catalog.jobs.get('job_crashed_midflight');
  assert('In-flight crash job reconciled to INTERRUPTED (never SUCCESS)', interruptedJob.status === 'INTERRUPTED');

  // Stale lease check
  assert('Stale lease from dead worker session was cleared', orchestrator2.catalog.isLeased(snapshot.snapshotId) === false);

  // Independent verification on restored receipt + captured rows
  const verifierRestored = await ReceiptVerifier.verifyReceipt(restoredJob1.receipt, {
    capturedRows: restoredJob1.capturedRows,
    verifyDiskSnapshots: true
  });
  assert('ReceiptVerifier verifies restored receipt and disk snapshot', verifierRestored.valid === true);

  await orchestrator2.shutdown();

  console.log(`\nQuit, Restart & Recovery Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Quit, Restart & Cold Recovery', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runQuitRestartRecoveryTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
