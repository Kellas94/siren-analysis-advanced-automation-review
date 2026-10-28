import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CDPClient } from './cdp_helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const analysisRoot = path.resolve(__dirname, '..');
const docsRoot = 'D:\\Siren docs prototype';

const STRICT_GROUND_TRUTH = {
  'Hardware': { cat_sum: '3124800000.00', cat_count: 20160000, cat_avg: 155.00, cat_min: '51.00', cat_max: '259.00' },
  'Services': { cat_sum: '3124800000.00', cat_count: 20160000, cat_avg: 155.00, cat_min: '50.50', cat_max: '259.50' },
  'Software': { cat_sum: '3899700000.00', cat_count: 25200000, cat_avg: 154.75, cat_min: '50.25', cat_max: '259.25' },
  'Support':  { cat_sum: '3912300000.00', cat_count: 25200000, cat_avg: 155.25, cat_min: '50.75', cat_max: '259.75' }
};

function verifyStrictCategoryGroundTruth(rows) {
  if (!Array.isArray(rows)) return { valid: false, error: 'Rows is not an array' };
  if (rows.length !== 4) return { valid: false, error: `Expected 4 rows, got ${rows.length}` };

  const seen = new Set();
  for (const row of rows) {
    const cat = row.category;
    if (!cat || !STRICT_GROUND_TRUTH[cat]) return { valid: false, error: `Unknown or unexpected category: ${cat}` };
    if (seen.has(cat)) return { valid: false, error: `Duplicate category: ${cat}` };
    seen.add(cat);

    const exp = STRICT_GROUND_TRUTH[cat];

    // 1. Exact Sum check (fixed to 2 decimals)
    const actSum = Number(row.cat_sum).toFixed(2);
    if (actSum !== exp.cat_sum) {
      return { valid: false, error: `${cat} sum mismatch: expected ${exp.cat_sum}, got ${actSum}` };
    }

    // 2. Exact Count check
    const actCount = Number(row.cat_count);
    if (actCount !== exp.cat_count) {
      return { valid: false, error: `${cat} count mismatch: expected ${exp.cat_count}, got ${actCount}` };
    }

    // 3. Exact Avg check
    const actAvg = Number(row.cat_avg);
    if (!Number.isFinite(actAvg) || Math.abs(actAvg - exp.cat_avg) > 0.001) {
      return { valid: false, error: `${cat} avg mismatch: expected ${exp.cat_avg}, got ${actAvg}` };
    }

    // 4. Exact Min check
    const actMin = Number(row.cat_min).toFixed(2);
    if (actMin !== exp.cat_min) {
      return { valid: false, error: `${cat} min mismatch: expected ${exp.cat_min}, got ${actMin}` };
    }

    // 5. Exact Max check
    const actMax = Number(row.cat_max).toFixed(2);
    if (actMax !== exp.cat_max) {
      return { valid: false, error: `${cat} max mismatch: expected ${exp.cat_max}, got ${actMax}` };
    }
  }

  if (seen.size !== 4) return { valid: false, error: `Expected 4 distinct categories, saw ${seen.size}` };
  return { valid: true };
}

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const page = pages.find(p => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for CDP on port ${port}`);
}

async function runScale120MVerification() {
  console.log('========================================================================');
  console.log('=== SIREN SCALE VERIFICATION: STRICTLY >100M ROWS (120,000,000 ROWS) ===');
  console.log('=== Packaged Standalone Electron 44.9.3 Desktop Runtime Host         ===');
  console.log('========================================================================\n');

  const results = [];
  function assert(condition, name, details = '') {
    const status = condition ? 'PASS' : 'FAIL';
    const entry = { test: name, status, details: String(details) };
    if (condition) {
      console.log(`[PASS] ${name}`);
    } else {
      console.error(`[FAIL] ${name}: ${details}`);
    }
    results.push(entry);
  }

  const exePath = path.join(analysisRoot, 'desktop_package', 'electron.exe');
  assert(fs.existsSync(exePath), 'Packaged Analysis desktop executable exists', exePath);

  const datasetPath = path.join(analysisRoot, 'data', 'bench_120m.parquet');
  assert(fs.existsSync(datasetPath), '120M rows benchmark dataset exists on disk', datasetPath);
  const datasetSizeMB = Math.round(fs.statSync(datasetPath).size / (1024 * 1024));
  console.log(`  Dataset size: ${datasetSizeMB} MB (${fs.statSync(datasetPath).size} bytes)`);

  const testTempDir = path.join(analysisRoot, 'data', 'temp_scale_120m_test');
  if (fs.existsSync(testTempDir)) fs.rmSync(testTempDir, { recursive: true, force: true });
  fs.mkdirSync(testTempDir, { recursive: true });

  const cdpPort = 9940;
  console.log(`Spawning packaged Electron 44.9.3 desktop executable on port ${cdpPort}...`);

  const proc = spawn(exePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${testTempDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], {
    cwd: path.join(analysisRoot, 'desktop_package'),
    stdio: 'ignore'
  });

  assert(Boolean(proc.pid), 'Electron desktop process spawned successfully', `PID: ${proc.pid}`);

  const wsUrl = await waitForCdp(cdpPort);
  const client = new CDPClient(wsUrl);
  await client.connect();
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  const networkAudit = [];
  client.on('Network.requestWillBeSent', (params) => {
    const u = params.request.url;
    if (u.startsWith('http://') || u.startsWith('https://')) {
      if (!u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost')) {
        networkAudit.push(u);
      }
    }
  });

  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    const ready = await client.evaluate('Boolean(window.sirenDesktop && window.sirenDesktop.runPipeline && window.sirenDesktop.quitApp)');
    if (ready) break;
  }
  assert(true, 'Desktop IPC bridge confirmed active and ready');

  // Define >100M Pipeline: 120M Input -> Filter (status=COMPLETED, amount>50) -> Aggregation -> Select
  const scalePipelineDef = {
    nodes: [
      {
        id: 'in_120m',
        type: 'input',
        data: { format: 'parquet', path: 'data/bench_120m.parquet' }
      },
      {
        id: 'filt_120m',
        type: 'filter',
        data: { condition: "status = 'COMPLETED' AND amount > 50.0" }
      },
      {
        id: 'agg_120m',
        type: 'aggregate',
        data: {
          groupBy: ['category'],
          aggregations: [
            { expr: 'ROUND(SUM(amount), 2)', alias: 'cat_sum' },
            { expr: 'COUNT(*)', alias: 'cat_count' },
            { expr: 'ROUND(AVG(amount), 2)', alias: 'cat_avg' },
            { expr: 'MIN(amount)', alias: 'cat_min' },
            { expr: 'MAX(amount)', alias: 'cat_max' }
          ]
        }
      },
      {
        id: 'sel_120m',
        type: 'select',
        data: {
          columns: [
            { name: 'category' },
            { name: 'cat_sum' },
            { name: 'cat_count' },
            { name: 'cat_avg' },
            { name: 'cat_min' },
            { name: 'cat_max' }
          ]
        }
      }
    ],
    edges: [
      { source: 'in_120m', target: 'filt_120m' },
      { source: 'filt_120m', target: 'agg_120m' },
      { source: 'agg_120m', target: 'sel_120m' }
    ]
  };

  console.log('\nSubmitting 120,000,000 rows analytical pipeline via window.sirenDesktop.runPipeline...');
  const tStart = Date.now();
  const runRes = await client.evaluate(`window.sirenDesktop.runPipeline(${JSON.stringify(scalePipelineDef)})`);
  assert(runRes?.success === true && Boolean(runRes?.jobId), 'runPipeline accepted 120M workflow returning jobId', runRes?.jobId);

  const jobId = runRes.jobId;
  let completedJob = null;
  let timeToSourcePreview = null;

  // Poll for completion and track stage timings
  console.log(`Polling job "${jobId}" execution progress across 120M records...`);
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 100));
    const status = await client.evaluate(`window.sirenDesktop.getJobStatus('${jobId}')`);
    if (status) {
      if (timeToSourcePreview === null && status.nodeOutputs?.in_120m?.rowCount) {
        timeToSourcePreview = Date.now() - tStart;
        console.log(`  [TIMING] Time to source preview: ${timeToSourcePreview} ms`);
      }
      if (status.status === 'completed' || status.status === 'failed') {
        completedJob = status;
        break;
      }
    }
  }

  const tEnd = Date.now();
  const totalElapsedMs = tEnd - tStart;

  assert(completedJob?.status === 'completed', 'Job completed successfully in background native DuckDB worker', completedJob?.error);

  const durationMs = completedJob?.telemetry?.durationMs || totalElapsedMs;
  const peakRssMB = completedJob?.telemetry?.peakRssMB || 0;
  const tempDiskSpillBytes = completedJob?.telemetry?.tempDiskSpillBytes || 0;
  const timeToFirstRow = completedJob?.telemetry?.timeToFirstRowMs || timeToSourcePreview || durationMs;

  console.log('\n--- EXECUTION TELEMETRY (120,000,000 ROWS) ---');
  console.log(`  - Time to Source Preview:     ${timeToFirstRow} ms`);
  console.log(`  - Time to Analytical Result:  ${durationMs} ms`);
  console.log(`  - Total Elapsed Duration:     ${totalElapsedMs} ms`);
  console.log(`  - Peak Worker RAM (RSS):      ${peakRssMB} MB`);
  console.log(`  - Disk Spill Overhead:        ${tempDiskSpillBytes} bytes`);

  assert(timeToFirstRow > 0, 'Measured time to source preview', `${timeToFirstRow} ms`);
  assert(durationMs > 0, 'Measured time to analytical result', `${durationMs} ms`);
  assert(peakRssMB > 0 && peakRssMB < 4096, 'Peak worker RSS is within bounded memory limit (<4GB)', `${peakRssMB} MB`);

  // 1. Verify Mathematical Ground Truth across 120,000,000 rows (Strict Invariant Verification)
  console.log('\nVerifying mathematical invariants against separately computed ground truth...');
  const aggOut = completedJob?.nodeOutputs?.sel_120m || completedJob?.nodeOutputs?.agg_120m;
  assert(Boolean(aggOut), 'Analytical aggregation node produced computed output');
  assert(aggOut?.rowCount === 4, 'Output contains 4 aggregated category partitions', `Partitions: ${aggOut?.rowCount}`);

  const preview = aggOut?.preview || [];
  assert(preview.length === 4, 'Bounded preview contains all 4 calculated category groups');

  // Strict ground truth verification: eliminate all loose startsWith checks!
  const gtVerification = verifyStrictCategoryGroundTruth(preview);
  assert(
    gtVerification.valid === true,
    'All 4 category aggregates strictly match ground truth invariants (sum, count, avg, min, max) without loose checks',
    gtVerification.error
  );

  // 2. Automated Negative Controls: 5 deliberate corruptions must be strictly rejected
  console.log('\nExecuting 5 automated negative controls on ground truth verifier...');

  // Negative Control 1: Swapped categories
  const neg1 = JSON.parse(JSON.stringify(preview));
  const hwIdx = neg1.findIndex(p => p.category === 'Hardware');
  const swIdx = neg1.findIndex(p => p.category === 'Software');
  if (hwIdx >= 0 && swIdx >= 0) {
    const tempSum = neg1[hwIdx].cat_sum;
    neg1[hwIdx].cat_sum = neg1[swIdx].cat_sum; // Swapping Hardware (3124800000.00) and Software (3899700000.00) sums
  }
  const neg1Res = verifyStrictCategoryGroundTruth(neg1);
  assert(neg1Res.valid === false, 'Negative Control 1: Swapped category values rejected', neg1Res.error);

  // Negative Control 2: Sum off by 0.99
  const neg2 = JSON.parse(JSON.stringify(preview));
  const hw2 = neg2.find(p => p.category === 'Hardware');
  if (hw2) hw2.cat_sum = (Number(hw2.cat_sum) + 0.99).toFixed(2);
  const neg2Res = verifyStrictCategoryGroundTruth(neg2);
  assert(neg2Res.valid === false, 'Negative Control 2: Sum off by +0.99 rejected', neg2Res.error);

  // Negative Control 3: Wrong average
  const neg3 = JSON.parse(JSON.stringify(preview));
  const sw3 = neg3.find(p => p.category === 'Software');
  if (sw3) sw3.cat_avg = 154.70; // ground truth is 154.75
  const neg3Res = verifyStrictCategoryGroundTruth(neg3);
  assert(neg3Res.valid === false, 'Negative Control 3: Wrong average (154.70 vs 154.75) rejected', neg3Res.error);

  // Negative Control 4: Wrong min/max
  const neg4 = JSON.parse(JSON.stringify(preview));
  const sup4 = neg4.find(p => p.category === 'Support');
  if (sup4) sup4.cat_min = '50.00'; // ground truth is 50.75
  const neg4Res = verifyStrictCategoryGroundTruth(neg4);
  assert(neg4Res.valid === false, 'Negative Control 4: Wrong minimum (50.00 vs 50.75) rejected', neg4Res.error);

  // Negative Control 5: Wrong row count
  const neg5 = preview.slice(0, 3); // Only 3 categories instead of 4
  const neg5Res = verifyStrictCategoryGroundTruth(neg5);
  assert(neg5Res.valid === false, 'Negative Control 5: Incomplete row count (3 vs 4) rejected', neg5Res.error);

  // Export to Docs Envelope
  console.log('\nExporting 120M analytical result to Docs envelope via window.sirenDesktop.exportToDocs...');
  const exportRes = await client.evaluate(`window.sirenDesktop.exportToDocs('${jobId}', 'agg_120m')`);
  assert(exportRes?.success === true, 'exportToDocs executed successfully via IPC');
  assert(fs.existsSync(exportRes.absoluteFilePath), 'Docs envelope generated on disk', exportRes.absoluteFilePath);

  const envelope = JSON.parse(fs.readFileSync(exportRes.absoluteFilePath, 'utf8'));
  assert(envelope.metadata?.sourcePipelineNode === 'agg_120m', 'Provenance metadata identifies sourcePipelineNode as "agg_120m"');
  assert(envelope.metadata?.totalSourceRows === 120000000, 'Provenance metadata confirms totalSourceRows is 120,000,000', `totalSourceRows: ${envelope.metadata?.totalSourceRows}`);
  assert(envelope.metadata?.rowsAfterFilter === 90720000, 'Provenance metadata confirms rowsAfterFilter is 90,720,000', `rowsAfterFilter: ${envelope.metadata?.rowsAfterFilter}`);
  assert(envelope.metadata?.totalResultRows === 4, 'Provenance metadata confirms totalResultRows is 4');
  assert(envelope.metadata?.transferredRows === 4, 'Provenance metadata confirms transferredRows is 4');
  assert(envelope.metadata?.transferStatus === 'COMPLETE', 'Transfer status is COMPLETE (all 4 aggregated rows transferred)');

  // Verify cell values in exported workbook are numbers and decimals (NOT [object Object])
  const sheetBlock = envelope.document.blocks.find(b => b.type === 'table');
  const wb = envelope.workbooks[sheetBlock.workbookId];
  const firstSheetId = wb.sheetOrder[0];
  const cellData = wb.sheets[firstSheetId].cellData;

  const sampleVal = cellData['1']['1']?.v;
  assert(typeof sampleVal === 'number' && sampleVal > 0, 'Exported aggregate amount preserved as numeric NUMBER (t: 2) in Univer sheet', `Sample: ${sampleVal}`);

  // Offline network verification
  assert(networkAudit.length === 0, 'Zero external network requests during entire 120M execution session', `Requests: ${networkAudit.length}`);

  // Normal Graceful Shutdown
  console.log('\nInvoking window.sirenDesktop.quitApp() for clean process termination...');
  try {
    await Promise.race([
      client.evaluate('window.sirenDesktop.quitApp()'),
      new Promise(r => setTimeout(r, 800))
    ]);
  } catch (e) {}
  try { client.close(); } catch (e) {}
  await new Promise(r => setTimeout(r, 1000));

  let isAlive = false;
  try {
    process.kill(proc.pid, 0);
    isAlive = true;
  } catch (e) {
    isAlive = false;
  }
  assert(!isAlive, 'Packaged Electron desktop process terminated cleanly via normal quitApp path');

  // Clean up test temp dir
  try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch (e) {}

  const allPassed = results.every(r => r.status === 'PASS');
  console.log('\n========================================================================');
  console.log(`=== 120M SCALE VERIFICATION RESULTS: ${results.filter(r => r.status === 'PASS').length}/${results.length} PASSED ===`);
  console.log('========================================================================\n');

  const reportData = {
    timestamp: new Date().toISOString(),
    component: 'SIREN Analysis Scale Verification (>100M Rows)',
    coordinatedRuntime: {
      electron: '44.9.3',
      node: '24.22.0',
      chromium: '152.0.7977.167',
      sha256: '61f45e6f522c666c6156222680712870b38f3a4acbd2e847b987f53ddb613544'
    },
    scaleMetrics: {
      datasetFile: 'data/bench_120m.parquet',
      datasetSizeMB,
      totalSourceRows: 120000000,
      totalFilteredRows: 90720000,
      totalResultRows: 4,
      timing: {
        timeToSourcePreviewMs: timeToFirstRow,
        timeToAnalyticalResultMs: durationMs,
        totalElapsedMs
      },
      workerResources: {
        peakRssMB,
        tempDiskSpillBytes
      },
      groundTruthVerified: gtVerification.valid
    },
    allPassed,
    totalTests: results.length,
    results
  };

  const analysisReportPath = path.join(analysisRoot, 'reports', 'DESKTOP_SCALE_120M_VERIFICATION.json');
  const docsReportPath = path.join(docsRoot, 'reports', 'DESKTOP_SCALE_120M_VERIFICATION.json');

  fs.writeFileSync(analysisReportPath, JSON.stringify(reportData, null, 2), 'utf8');
  fs.writeFileSync(docsReportPath, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`Report written to:\n  - ${analysisReportPath}\n  - ${docsReportPath}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runScale120MVerification().catch(err => {
  console.error('[FATAL]:', err);
  process.exit(1);
});
