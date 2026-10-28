/**
 * Master Test Runner for Siren Analysis -> Charts Adapter
 *
 * Runs all suites:
 *   1. Adapter Unit Tests
 *   2. Real DuckDB Pipeline Execution
 *   3. Negative Controls & Boundary Audit
 *
 * Emits comprehensive verification report in reports/VERIFICATION_REPORT.json.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runUnitTests } from './test_adapter_unit.mjs';
import { runDuckDBPipelineTest } from './test_duckdb_worker_pipeline.mjs';
import { runNegativeControls } from './test_negative_controls.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('========================================================================');
  console.log('  SIREN ANALYSIS -> CHARTS ADAPTER: COMPLETE VERIFICATION SUITE');
  console.log('========================================================================\n');

  const startTime = Date.now();

  const unitRes = await runUnitTests();
  const pipelineRes = await runDuckDBPipelineTest();
  const negativeRes = await runNegativeControls();

  const totalPassed = unitRes.passCount + pipelineRes.passCount + negativeRes.passCount;
  const totalFailed = unitRes.failCount + pipelineRes.failCount + negativeRes.failCount;
  const totalTests = totalPassed + totalFailed;
  const durationMs = Date.now() - startTime;

  const reportPayload = {
    timestamp: new Date().toISOString(),
    suite: 'SIREN_ANALYSIS_CHARTS_ADAPTER_VERIFICATION',
    overallStatus: totalFailed === 0 ? 'ALL_TESTS_PASS' : 'FAILURES_DETECTED',
    durationMs,
    totals: {
      total: totalTests,
      passed: totalPassed,
      failed: totalFailed
    },
    suites: [
      {
        name: 'ADAPTER_UNIT_TESTS',
        passed: unitRes.passCount,
        failed: unitRes.failCount,
        results: unitRes.results
      },
      {
        name: 'DUCKDB_PIPELINE_REAL_EXECUTION',
        passed: pipelineRes.passCount,
        failed: pipelineRes.failCount,
        snapshotFile: pipelineRes.snapshotPath,
        chartFile: pipelineRes.chartPackagePath,
        results: pipelineRes.results
      },
      {
        name: 'NEGATIVE_CONTROLS_AUDIT',
        passed: negativeRes.passCount,
        failed: negativeRes.failCount,
        reportFile: negativeRes.reportPath,
        controls: negativeRes.failureLogs
      }
    ]
  };

  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const reportPath = path.join(reportsDir, 'VERIFICATION_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');

  console.log('========================================================================');
  console.log(`Verification Complete: ${totalPassed}/${totalTests} tests passed (${totalFailed} failed) in ${durationMs}ms`);
  console.log(`Full Verification Report written to: ${reportPath}`);
  console.log('========================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal master test runner error:', err);
  process.exit(1);
});
