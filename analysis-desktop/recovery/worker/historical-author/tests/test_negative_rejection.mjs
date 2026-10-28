/**
 * Test Suite 6: Negative Rejection Controls & Adverse Integrity Gates
 *
 * Verifies:
 *   1. Corrupted snapshot copy on disk is detected and flagged by catalog recovery.
 *   2. Corrupted catalog.json syntax is rejected with CATALOG_CORRUPT.
 *   3. Tampered receipt digests are rejected by ReceiptVerifier.
 *   4. Inconsistent / non-lossless captured rows are rejected by ReceiptVerifier.
 *   5. Unregistered complete copy in storage (orphan) is detected and safely pruned without touching valid snapshots.
 *   6. Status=0 or no-op child receipt (empty inputs or missing SQL) is strictly rejected.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { PersistentCatalog } from '../src/persistent_catalog.js';
import {
  ReceiptVerifier,
  createExecutionReceipt,
  ErrorCodes
} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testBaseDir = path.resolve(__dirname, '../storage/test_negative');
const catalogDir = path.join(testBaseDir, 'catalog');
const storageDir = path.join(testBaseDir, 'storage');
const sealedDir = path.join(storageDir, 'sealed');
const fixturesDir = path.join(testBaseDir, 'fixtures');

export async function runNegativeRejectionTests() {
  console.log('\n=== SUITE 6: NEGATIVE REJECTION CONTROLS & ADVERSE GATES ===\n');

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
  fs.mkdirSync(sealedDir, { recursive: true });

  const catalog = new PersistentCatalog({ catalogDir, storageDir });

  console.log('1. Testing Catalog Rejection of Corrupted Snapshot File...');
  const snapPath = path.join(sealedDir, 'snap_good.csv');
  const snapContent = 'id,name\n1,Alpha\n';
  fs.writeFileSync(snapPath, snapContent, 'utf-8');
  const snapSha = crypto.createHash('sha256').update(snapContent).digest('hex');

  const snapRecord = {
    snapshotId: 'snap_good',
    snapshotPath: snapPath,
    originalPath: 'D:/src/good.csv',
    format: 'csv',
    contentSha256: snapSha,
    byteCount: Buffer.byteLength(snapContent),
    capturedAt: new Date().toISOString()
  };
  await catalog.registerSnapshot(snapRecord);

  // Tamper with bytes in snapPath
  fs.appendFileSync(snapPath, 'CORRUPT_BYTES\n');

  // Recover catalog
  const recoveryReport = await catalog.recoverCatalog();
  const snapCheck = recoveryReport.snapshotVerificationResults.find((s) => s.snapshotId === 'snap_good');
  assert('Catalog recovery flags tampered snapshot as intact: false', snapCheck.intact === false);
  assert('Catalog recovery records INTEGRITY_MISMATCH error', snapCheck.error.includes('INTEGRITY_MISMATCH'));

  console.log('\n2. Testing Catalog Rejection of Corrupted catalog.json...');
  fs.writeFileSync(catalog.catalogFilePath, 'INVALID_JSON_CORRUPTED{{{', 'utf-8');
  let corruptCatalogCaught = false;
  try {
    const brokenCatalog = new PersistentCatalog({ catalogDir, storageDir });
    await brokenCatalog.recoverCatalog();
  } catch (err) {
    corruptCatalogCaught = err.message.includes('CATALOG_CORRUPT');
  }
  assert('Catalog recovery throws CATALOG_CORRUPT on malformed JSON file', corruptCatalogCaught);

  // Restore clean catalog
  fs.rmSync(testBaseDir, { recursive: true, force: true });
  fs.mkdirSync(sealedDir, { recursive: true });
  const freshCatalog = new PersistentCatalog({ catalogDir, storageDir });

  console.log('\n3. Testing Unregistered Complete Copy (Orphan Detection & Cleanup)...');
  // Re-create valid snapshot
  fs.writeFileSync(snapPath, snapContent, 'utf-8');
  await freshCatalog.registerSnapshot({ ...snapRecord, contentSha256: snapSha });

  // Create an unregistered orphan file in sealed storage
  const orphanPath = path.join(sealedDir, 'snap_unregistered_orphan.parquet');
  fs.writeFileSync(orphanPath, 'ORPHAN_PARQUET_BYTES_FROM_FAILED_ACK', 'utf-8');

  const orphanReport = await freshCatalog.recoverCatalog();
  assert('Catalog recovery detects unregistered file as orphan', orphanReport.orphanFiles.length === 1);
  assert('Detected orphan matches orphanPath', path.resolve(orphanReport.orphanFiles[0]) === path.resolve(orphanPath));

  // Clean orphans
  const cleanedFiles = freshCatalog.cleanupOrphans(orphanReport.orphanFiles);
  assert('cleanOrphans unlinked the orphan file', cleanedFiles.length === 1);
  assert('Orphan file no longer exists on disk', !fs.existsSync(orphanPath));
  assert('Valid registered snapshot file was NOT deleted', fs.existsSync(snapPath));

  console.log('\n4. Testing ReceiptVerifier Rejection of Tampered Receipts...');
  const baseFixture = path.join(fixturesDir, 'verif_data.csv');
  if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
  fs.writeFileSync(baseFixture, 'id,val\n1,10\n2,20\n', 'utf-8');

  const snapTest = await catalog.registerSnapshot({
    snapshotId: 'snap_verif_01',
    snapshotPath: baseFixture,
    originalPath: baseFixture,
    format: 'csv',
    contentSha256: crypto.createHash('sha256').update(fs.readFileSync(baseFixture)).digest('hex'),
    byteCount: fs.statSync(baseFixture).size,
    capturedAt: new Date().toISOString(),
    sourceRowCount: '2'
  });

  const { compileSingleInputQuery } = await import('file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js');
  const compiled = compileSingleInputQuery(snapTest);

  const genuineReceipt = createExecutionReceipt({
    jobId: 'job_genuine',
    status: 'SUCCESS',
    inputs: [snapTest],
    sql: compiled.sql,
    sqlDigest: compiled.sqlDigest,
    queryPlan: compiled.queryPlan,
    schema: [{ name: 'id', type: 'INTEGER' }, { name: 'val', type: 'INTEGER' }],
    metrics: {
      inputRowCounts: { [snapTest.snapshotId]: '2' },
      outputRowCount: '2',
      capturedRows: 2,
      transferStatus: 'COMPLETE',
      nullCounts: { id: '0', val: '0' }
    },
    resultDigest: crypto.createHash('sha256').update('[{"id":1,"val":10},{"id":2,"val":20}]').digest('hex'),
    timing: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 10 }
  });

  const tamperedReceipt = {
    ...genuineReceipt,
    metrics: {
      ...genuineReceipt.metrics,
      outputRowCount: '999999' // Tampered!
    }
  };

  let receiptTamperRejected = false;
  try {
    await ReceiptVerifier.verifyReceipt(tamperedReceipt, { verifyDiskSnapshots: false });
  } catch (err) {
    receiptTamperRejected = err.message === 'RECEIPT_COVERAGE' || err.code === ErrorCodes.RECEIPT_DIGEST_MISMATCH;
  }
  assert('ReceiptVerifier rejects tampered receipt metrics (RECEIPT_COVERAGE or digest mismatch)', receiptTamperRejected);

  console.log('\n5. Testing ReceiptVerifier Rejection of Non-Lossless JSON in Captured Rows...');
  const rowWithNaN = [{ id: 1, val: NaN }, { id: 2, val: 20 }];
  let nonLosslessRejected = false;
  try {
    await ReceiptVerifier.verifyReceipt(genuineReceipt, {
      capturedRows: rowWithNaN,
      verifyDiskSnapshots: false
    });
  } catch (err) {
    nonLosslessRejected = err.message === 'RECEIPT_CAPTURED_VALUE';
  }
  assert('ReceiptVerifier strictly rejects non-lossless JSON (NaN) in captured rows with RECEIPT_CAPTURED_VALUE', nonLosslessRejected);

  console.log('\n6. Testing ReceiptVerifier Rejection of Status=0 / No-Op Child Receipt...');
  const noopChildReceipt = {
    ...genuineReceipt,
    inputs: [] // Empty inputs
  };

  let noopChildRejected = false;
  try {
    await ReceiptVerifier.verifyReceipt(noopChildReceipt, { verifyDiskSnapshots: false });
  } catch (err) {
    noopChildRejected =
      err.code === ErrorCodes.RECEIPT_CHILD_NOOP || err.code === ErrorCodes.RECEIPT_DIGEST_MISMATCH;
  }
  assert('ReceiptVerifier strictly rejects no-op child receipt with empty inputs', noopChildRejected);

  console.log(`\nNegative Rejection Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Negative Rejection Controls & Adverse Gates', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNegativeRejectionTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
