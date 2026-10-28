/**
 * SIREN Analysis Snapshot Worker Recovery — Master Test Runner
 *
 * Runs all verification suites:
 *   0. Baseline Candidate Pin Verification (49 files, roster SHA 04f2...)
 *   1. Persistent Catalog Durability, Monotonic Revisions & Recovery
 *   2. Dedicated Child Worker Process, Runtime Attribution & Stale Reply Isolation
 *   3. Real Worker Process Crash & Fresh Retry
 *   4. Real Cancellation & Graceful Shutdown Without Orphans
 *   5. Normal Quit, Restart, Cold Recovery & Stale Lease Reconciliation
 *   6. Negative Rejection Controls & Adverse Gates
 *
 * Emits reports:
 *   - reports/VERIFICATION_REPORT.json
 *   - reports/NEGATIVE_CONTROLS_REPORT.json
 *
 * Exits with code 1 if any test fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { runBaselinePinTests } from './test_baseline_pin.mjs';
import { runPersistentCatalogTests } from './test_persistent_catalog.mjs';
import { runWorkerIpcIsolationTests } from './test_worker_ipc_isolation.mjs';
import { runRealCrashAndRetryTests } from './test_real_crash_and_retry.mjs';
import { runCancellationShutdownTests } from './test_cancellation_shutdown.mjs';
import { runQuitRestartRecoveryTests } from './test_quit_restart_recovery.mjs';
import { runNegativeRejectionTests } from './test_negative_rejection.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports');

async function runAll() {
  console.log('========================================================================');
  console.log('  SIREN ANALYSIS SNAPSHOT WORKER RECOVERY & PERSISTENT CATALOG');
  console.log('  Status: Candidat pentru verificare independentă');
  console.log('  Notă: Testele proprii nu constituie review independent.');
  console.log('========================================================================');

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const tStart = performance.now();
  const suites = [];

  suites.push(await runBaselinePinTests());
  suites.push(await runPersistentCatalogTests());
  suites.push(await runWorkerIpcIsolationTests());
  suites.push(await runRealCrashAndRetryTests());
  suites.push(await runCancellationShutdownTests());
  suites.push(await runQuitRestartRecoveryTests());
  suites.push(await runNegativeRejectionTests());

  const totalTimeMs = Math.round(performance.now() - tStart);

  let totalPass = 0;
  let totalFail = 0;
  for (const s of suites) {
    totalPass += s.passCount;
    totalFail += s.failCount;
  }

  console.log('\n========================================================================');
  console.log(`  VERIFICATION SUMMARY: ${totalPass} PASSED, ${totalFail} FAILED (${totalTimeMs}ms)`);
  console.log('  Review Status: CANDIDAT_PENTRU_VERIFICARE_INDEPENDENTA');
  console.log('  Notă: Testele proprii nu constituie review independent.');
  console.log('========================================================================\n');

  // Generate VERIFICATION_REPORT.json
  const verificationReport = {
    title: 'SIREN Analysis Snapshot Worker Recovery Verification Report',
    timestamp: new Date().toISOString(),
    reviewStatus: 'CANDIDAT_PENTRU_VERIFICARE_INDEPENDENTA',
    independentReviewNote: 'Testele proprii nu constituie review independent.',
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    },
    summary: {
      totalSuites: suites.length,
      totalTests: totalPass + totalFail,
      totalPassed: totalPass,
      totalFailed: totalFail,
      executionDurationMs: totalTimeMs
    },
    suites: suites.map((s) => ({
      name: s.suite,
      passed: s.passCount,
      failed: s.failCount,
      tests: s.testResults
    }))
  };

  const verificationReportPath = path.join(reportsDir, 'VERIFICATION_REPORT.json');
  fs.writeFileSync(verificationReportPath, JSON.stringify(verificationReport, null, 2), 'utf-8');
  console.log(`Verification report written to ${verificationReportPath}`);

  // Generate NEGATIVE_CONTROLS_REPORT.json
  const negativeSuite = suites.find((s) => s.suite === 'Negative Rejection Controls & Adverse Gates');
  const negativeControlsReport = {
    title: 'SIREN Analysis Snapshot Worker Recovery Negative Controls Report',
    timestamp: new Date().toISOString(),
    reviewStatus: 'CANDIDAT_PENTRU_VERIFICARE_INDEPENDENTA',
    description: 'Adverse control gates and rejection verification',
    totalNegativeControls: negativeSuite?.testResults?.length || 0,
    allPassed: (negativeSuite?.failCount || 0) === 0,
    controls: negativeSuite?.testResults || []
  };

  const negativeControlsReportPath = path.join(reportsDir, 'NEGATIVE_CONTROLS_REPORT.json');
  fs.writeFileSync(negativeControlsReportPath, JSON.stringify(negativeControlsReport, null, 2), 'utf-8');
  console.log(`Negative controls report written to ${negativeControlsReportPath}`);

  if (totalFail > 0) {
    console.error(`\nFAILED: ${totalFail} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nSUCCESS: All test suites passed completely.');
  }
}

runAll().catch((err) => {
  console.error('Fatal error running master test suite:', err);
  process.exit(1);
});
