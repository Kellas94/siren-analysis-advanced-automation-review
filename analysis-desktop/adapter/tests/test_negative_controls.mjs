/**
 * Negative Controls Test Suite for Analysis -> Charts Adapter
 *
 * Verifies rejection of:
 *   - Corrupted values (invalid dates, invalid decimals, >15 significant digits, unsafe BigInt)
 *   - Mismatched identity (missing sourceId, missing jobId)
 *   - Incompatible types & units (non-numeric measures, prototype pollution, duplicate column IDs, missing measures)
 *   - Incorrect row counts & coverage (TRUNCATED refusal, row count mismatches, missing sample/aggregate metadata)
 *   - Hard limit breaches (>32 columns, >5000 rows)
 *
 * All failures and exact thrown error messages are recorded and preserved.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AnalysisToChartsAdapter } from '../src/analysis_to_charts_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const chartsCore = require('C:/Claude/SIREN_WORK/charts-visual-analytics-parallel-20261025/app/core.js');

let passCount = 0;
let failCount = 0;
const failureLogs = [];

function recordNegativeControl(id, category, description, expectedCode, fn) {
  try {
    fn();
    // If we reach here, the negative control did not throw!
    failCount++;
    console.error(`  [FAIL] ${id}: Expected error containing '${expectedCode}', but operation succeeded unexpectedly.`);
    failureLogs.push({
      id,
      category,
      description,
      status: 'UNEXPECTED_SUCCESS',
      expectedCode,
      actualError: null
    });
  } catch (err) {
    const errMsg = err.message || String(err);
    const matched = errMsg.includes(expectedCode);
    if (matched) {
      passCount++;
      console.log(`  [PASS] ${id} (${category}): Correctly caught expected error '${expectedCode}'`);
      failureLogs.push({
        id,
        category,
        description,
        status: 'CORRECTLY_REJECTED',
        expectedCode,
        actualError: errMsg
      });
    } else {
      failCount++;
      console.error(`  [FAIL] ${id}: Error thrown but did not match expected code '${expectedCode}'. Got: ${errMsg}`);
      failureLogs.push({
        id,
        category,
        description,
        status: 'MISMATCHED_ERROR_CODE',
        expectedCode,
        actualError: errMsg
      });
    }
  }
}

export async function runNegativeControls() {
  console.log('\n=== RUNNING ADAPTER NEGATIVE CONTROLS ===\n');

  // --- CATEGORY 1: VALORI CORUPTE (CORRUPTED VALUES) ---
  console.log('--- Category 1: Corrupted Values ---');

  recordNegativeControl(
    'NEG-01',
    'Corrupted Values',
    'Invalid calendar date "2026-02-30" in DATE column',
    'INVALID_DATE',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'd', type: 'DATE' }],
        rows: [{ d: '2026-02-30' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-02',
    'Corrupted Values',
    'Invalid month "2026-13" in MONTH column',
    'INVALID_MONTH',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'm', type: 'MONTH' }],
        rows: [{ m: '2026-13' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-03',
    'Corrupted Values',
    'Corrupted decimal string "12.34.56"',
    'INVALID_DECIMAL',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'amt', type: 'DECIMAL(18,2)' }],
        rows: [{ amt: '12.34.56' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-04',
    'Corrupted Values',
    'Extreme decimal coordinate with 18 significant digits (>15 limit)',
    'UNSAFE_COORDINATE',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'extreme_dec', type: 'DECIMAL(38,4)' }],
        rows: [{ extreme_dec: '9007199254740993.01' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-05',
    'Corrupted Values',
    'Unsafe BigInt coordinate exceeding Number.MAX_SAFE_INTEGER as measure',
    'UNSAFE_COORDINATE',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'huge_id', type: 'BIGINT' }],
        rows: [{ huge_id: 9007199254740995n }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        columnHints: { huge_id: { role: 'measure' } }
      });
    }
  );

  recordNegativeControl(
    'NEG-06',
    'Corrupted Values',
    'NULL in non-nullable column',
    'NULL_VIOLATION',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'required_col', type: 'VARCHAR', nullable: false }],
        rows: [{ required_col: null }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-07',
    'Corrupted Values',
    'String coordinate exceeding 1024 characters',
    'STRING_TOO_LONG',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'long_text', type: 'VARCHAR' }],
        rows: [{ long_text: 'A'.repeat(1025) }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  // --- CATEGORY 2: IDENTITATE NEPOTRIVITĂ (MISMATCHED IDENTITY) ---
  console.log('\n--- Category 2: Mismatched Identity ---');

  recordNegativeControl(
    'NEG-08',
    'Mismatched Identity',
    'Missing sourceId and nodeId in source',
    'IDENTITY_ERROR',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'val', type: 'VARCHAR' }],
        rows: [{ val: 'test' }],
        coverage: {kind:'complete',sourceRowCount:1,resultRowCount:1,transferredRows:1},
        source: { jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-09',
    'Mismatched Identity',
    'Missing jobId in source',
    'IDENTITY_ERROR',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'val', type: 'VARCHAR' }],
        rows: [{ val: 'test' }],
        coverage: {kind:'complete',sourceRowCount:1,resultRowCount:1,transferredRows:1},
        source: { sourceId: 'src_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-10',
    'Mismatched Identity',
    'Charts core rejects invalid schemaVersion in snapshot',
    'VERSION',
    () => {
      const snap = {
        schemaVersion: 'siren.chart-data/999',
        snapshotId: 'snap_1',
        columns: [{ id: 'c1', label: 'C1', type: 'string', role: 'dimension', unit: null, nullable: false }],
        rows: [{ id: 'r1', values: { c1: 'hello' } }],
        source: { sourceId: 's1', jobId: 'j1', resultVersion: 'v1', capturedAt: new Date().toISOString(), state: 'current' },
        coverage: { kind: 'complete', sourceRowCount: 1, resultRowCount: 1, transferredRows: 1, aggregation: null, selection: null }
      };
      chartsCore.validateSnapshot(snap);
    }
  );

  // --- CATEGORY 3: TIPURI ȘI UNITĂȚI INCOMPATIBILE (INCOMPATIBLE TYPES & UNITS) ---
  console.log('\n--- Category 3: Incompatible Types & Units ---');

  recordNegativeControl(
    'NEG-11',
    'Incompatible Types',
    'Measure column with non-numeric type "string"',
    'MEASURE_TYPE_INVALID',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'name', type: 'VARCHAR' }],
        rows: [{ name: 'Alpha' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        columnHints: { name: { role: 'measure', type: 'string' } }
      });
    }
  );

  recordNegativeControl(
    'NEG-12',
    'Incompatible Types',
    'Forbidden column ID "__proto__" (prototype pollution defense)',
    'COLUMN_ID_FORBIDDEN',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: '__proto__', type: 'VARCHAR' }],
        rows: [{ __proto__: 'bad' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-13',
    'Incompatible Types',
    'Duplicate column IDs in schema',
    'COLUMN_ID_DUPLICATE',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [
          { name: 'col_a', type: 'VARCHAR' },
          { name: 'col_a', type: 'INTEGER' }
        ],
        rows: [{ col_a: '1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-14',
    'Incompatible Types',
    'Missing required measure column in row values',
    'MISSING_MEASURE',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [
          { name: 'dim', type: 'VARCHAR' },
          { name: 'rev', type: 'DECIMAL(18,2)' }
        ],
        rows: [{ dim: 'Gold' }], // 'rev' measure is missing!
        source: { sourceId: 'src_1', jobId: 'job_1' },
        columnHints: { rev: { role: 'measure' } }
      });
    }
  );

  recordNegativeControl(
    'NEG-15',
    'Incompatible Units',
    'Charts core refuses multi-series chart with mixed units ("RON" vs "EUR")',
    'MIXED_UNITS',
    () => {
      const snap = AnalysisToChartsAdapter.transform({
        schema: [
          { name: 'cat', type: 'VARCHAR' },
          { name: 'rev_ron', type: 'DECIMAL(18,2)' },
          { name: 'rev_eur', type: 'DECIMAL(18,2)' }
        ],
        rows: [{ cat: 'A', rev_ron: '100.00', rev_eur: '20.00' }],
        coverage: {kind:'complete',sourceRowCount:1,resultRowCount:1,transferredRows:1},
        source: { sourceId: 'src_1', jobId: 'job_1' },
        columnHints: {
          rev_ron: { unit: 'RON', role: 'measure' },
          rev_eur: { unit: 'EUR', role: 'measure' }
        }
      });
      const def = chartsCore.defaultDefinition(snap);
      def.y = ['rev_ron', 'rev_eur'];
      chartsCore.validateDefinition(snap, def);
    }
  );

  // --- CATEGORY 4: NUMĂR INCORECT DE RÂNDURI ȘI ACOPERIRE (INCORRECT ROW COUNT & COVERAGE) ---
  console.log('\n--- Category 4: Incorrect Row Count & Coverage ---');

  recordNegativeControl(
    'NEG-16',
    'Coverage Policy',
    'Refusal of TRUNCATED coverage kind with actionable explanation',
    'TRUNCATION_REFUSED',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'truncated',
          sourceRowCount: 100,
          resultRowCount: 100,
          transferredRows: 1
        }
      });
    }
  );

  recordNegativeControl(
    'NEG-17',
    'Coverage Policy',
    'transferredRows count does not match actual row array length',
    'ROW_COUNT_MISMATCH',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'complete',
          sourceRowCount: 1,
          resultRowCount: 1,
          transferredRows: 99 // Actual is 1!
        }
      });
    }
  );

  recordNegativeControl(
    'NEG-18',
    'Coverage Policy',
    'resultRowCount is smaller than transferredRows',
    'ROW_COUNT_INCONSISTENT',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }, { x: 'item2' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'complete',
          sourceRowCount: 2,
          resultRowCount: 1, // smaller than transferredRows (2)
          transferredRows: 2
        }
      });
    }
  );

  recordNegativeControl(
    'NEG-19',
    'Coverage Policy',
    'Complete coverage transfers only partial result rows without being marked sampled',
    'ROW_COUNT_INCONSISTENT',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'complete',
          sourceRowCount: 10,
          resultRowCount: 10,
          transferredRows: 1 // only 1 transferred!
        }
      });
    }
  );

  recordNegativeControl(
    'NEG-20',
    'Coverage Policy',
    'Sampled coverage missing required selection method/description',
    'SELECTION_METADATA_REQUIRED',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'sampled',
          sourceRowCount: 100,
          resultRowCount: 10,
          transferredRows: 1
          // selection is missing!
        }
      });
    }
  );

  recordNegativeControl(
    'NEG-21',
    'Coverage Policy',
    'Aggregate coverage missing required aggregation description',
    'AGGREGATION_METADATA_REQUIRED',
    () => {
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: [{ x: 'item1' }],
        source: { sourceId: 'src_1', jobId: 'job_1' },
        coverage: {
          kind: 'aggregate',
          sourceRowCount: 100,
          resultRowCount: 1,
          transferredRows: 1
          // aggregation is missing!
        }
      });
    }
  );

  // --- CATEGORY 5: HARD ADMISSION LIMITS BREACHES ---
  console.log('\n--- Category 5: Hard Admission Limits ---');

  recordNegativeControl(
    'NEG-22',
    'Admission Limits',
    'Exceeding 32 columns limit (33 columns provided)',
    'COLUMNS_LIMIT_EXCEEDED',
    () => {
      const largeSchema = [];
      for (let i = 0; i < 33; i++) {
        largeSchema.push({ name: `col_${i}`, type: 'VARCHAR' });
      }
      AnalysisToChartsAdapter.transform({
        schema: largeSchema,
        rows: [{ col_0: 'val' }],
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  recordNegativeControl(
    'NEG-23',
    'Admission Limits',
    'Exceeding 5000 rows limit (5001 rows provided)',
    'ROWS_LIMIT_EXCEEDED',
    () => {
      const largeRows = [];
      for (let i = 0; i < 5001; i++) {
        largeRows.push({ id: `r_${i}`, x: 'val' });
      }
      AnalysisToChartsAdapter.transform({
        schema: [{ name: 'x', type: 'VARCHAR' }],
        rows: largeRows,
        source: { sourceId: 'src_1', jobId: 'job_1' }
      });
    }
  );

  // Save detailed negative controls report to evidence
  const evidenceDir = path.resolve(__dirname, '../evidence');
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'negative_controls_report.json');
  const reportPayload = {
    timestamp: new Date().toISOString(),
    suite: 'ANALYSIS_TO_CHARTS_NEGATIVE_CONTROLS',
    totalControls: failureLogs.length,
    passedControls: passCount,
    failedControls: failCount,
    status: failCount === 0 ? 'ALL_NEGATIVE_CONTROLS_VERIFIED' : 'DEFECTS_DETECTED',
    controls: failureLogs
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  console.log(`\nSaved Negative Controls Audit Report to: ${reportPath}`);
  console.log(`Summary: ${passCount} correctly rejected, ${failCount} failed.\n`);

  return { passCount, failCount, failureLogs, reportPath };
}

if (process.argv[1] && process.argv[1].endsWith('test_negative_controls.mjs')) {
  runNegativeControls().catch(err => {
    console.error('Fatal negative control runner error:', err);
    process.exit(1);
  });
}
