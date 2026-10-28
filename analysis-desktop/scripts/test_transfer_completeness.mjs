import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DocsUniverContract } from '../contracts/docs_univer_contract.js';

console.log('=== TEST: TRANSFER COMPLETENESS & STATUS SEPARATION (0, 3, 50, 51, 1001, 1M ROWS) ===\n');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

const colNames = ['id', 'name', 'value'];

// 1. Case 0 rows
test('Case 0 rows: COMPLETE, transferredRows=0, totalResultRows=0', () => {
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows: [],
    lineage: { totalResultRows: 0, totalSourceRowsProcessed: 0 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'COMPLETE');
  assert.strictEqual(wb.lineage.transferredRows, 0);
  assert.strictEqual(wb.lineage.totalResultRows, 0);
});

// 2. Case 3 rows
test('Case 3 rows: COMPLETE, transferredRows=3, totalResultRows=3', () => {
  const rows = [
    [1, 'Alfa', 10],
    [2, 'Beta', 20],
    [3, 'Gamma', 30]
  ];
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows,
    lineage: { totalResultRows: 3, totalSourceRowsProcessed: 100 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'COMPLETE');
  assert.strictEqual(wb.lineage.transferredRows, 3);
  assert.strictEqual(wb.lineage.totalResultRows, 3);
  assert.strictEqual(wb.lineage.totalSourceRowsProcessed, 100);
});

// 3. Case 50 rows (where total rows is 50)
test('Case 50 rows out of 50 total: COMPLETE, transferredRows=50, totalResultRows=50', () => {
  const rows = Array.from({ length: 50 }, (_, i) => [i + 1, `Item_${i}`, i * 2]);
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows,
    lineage: { totalResultRows: 50, totalSourceRowsProcessed: 500 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'COMPLETE');
  assert.strictEqual(wb.lineage.transferredRows, 50);
  assert.strictEqual(wb.lineage.totalResultRows, 50);
});

// 4. Case 51 rows (where preview is 50 rows, total is 51)
test('Case 50 preview rows out of 51 total: SAMPLED (never falsely declared COMPLETE)', () => {
  const rows = Array.from({ length: 50 }, (_, i) => [i + 1, `Item_${i}`, i * 2]);
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows,
    lineage: { totalResultRows: 51, totalSourceRowsProcessed: 500 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'SAMPLED');
  assert.strictEqual(wb.lineage.transferredRows, 50);
  assert.strictEqual(wb.lineage.totalResultRows, 51);
  // Verify notice banner
  const bannerCell = wb.sheets['sheet-01'].cellData[1][0];
  assert.ok(bannerCell.v.includes('SAMPLED'), 'Notice row must include SAMPLED banner');
});

// 5. Case 1,001 rows (capped at 1,000 for Univer presentation)
test('Case 1,001 rows: TRUNCATED, transferredRows=1000, totalResultRows=1001', () => {
  const rows = Array.from({ length: 1001 }, (_, i) => [i + 1, `Item_${i}`, i * 2]);
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows,
    lineage: { totalResultRows: 1001, totalSourceRowsProcessed: 10000 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'TRUNCATED');
  assert.strictEqual(wb.lineage.transferredRows, 1000);
  assert.strictEqual(wb.lineage.totalResultRows, 1001);
  const bannerCell = wb.sheets['sheet-01'].cellData[1][0];
  assert.ok(bannerCell.v.includes('TRUNCATED'), 'Notice row must include TRUNCATED banner');
});

// 6. Case 1,000,000 rows (preview of 50 rows transferred)
test('Case 50 preview rows out of 1,000,000 total: SAMPLED, totalResultRows=1000000', () => {
  const rows = Array.from({ length: 50 }, (_, i) => [i + 1, `Item_${i}`, i * 2]);
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows,
    lineage: { totalResultRows: 1000000, totalSourceRowsProcessed: 120000000 }
  });
  assert.strictEqual(wb.lineage.transferStatus, 'SAMPLED');
  assert.strictEqual(wb.lineage.transferredRows, 50);
  assert.strictEqual(wb.lineage.totalResultRows, 1000000);
  assert.strictEqual(wb.lineage.totalSourceRowsProcessed, 120000000);
});

// 7. Physical file export verification (never true from unverified string)
test('Full file export availability: FALSE when file does not exist', () => {
  const wb = DocsUniverContract.createUniverWorkbook({
    columnNames: colNames,
    rows: [[1, 'A', 1]],
    lineage: {
      totalResultRows: 100,
      fullExportPath: 'data/ghost_nonexistent_file.parquet'
    }
  });
  assert.strictEqual(wb.lineage.fullFileExportAvailable, false);
  assert.strictEqual(wb.lineage.fullExportPath, null);
});

test('Full file export availability: TRUE when physical file exists on disk with size > 0', () => {
  const tempPath = path.resolve('data', 'test_verified_export.parquet');
  fs.writeFileSync(tempPath, 'PAR1_TEST_MOCK_PARQUET_BYTES_HEADER', 'utf8');

  try {
    const wb = DocsUniverContract.createUniverWorkbook({
      columnNames: colNames,
      rows: [[1, 'A', 1]],
      lineage: {
        totalResultRows: 100,
        fullExportPath: tempPath
      }
    });
    assert.strictEqual(wb.lineage.fullFileExportAvailable, true);
    assert.strictEqual(wb.lineage.fullExportPath, tempPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

console.log(`\nTransfer Completeness Tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
