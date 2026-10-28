import { RunnerService } from '../server/runner_service.js';
import { server, runnerService } from '../server/index.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('===============================================================');
  console.log('   Testing Analysis Prototype Consolidations & Repairs        ');
  console.log('===============================================================');

  const tests = [];
  function record(id, desc, pass, details = {}) {
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${id}: ${desc}`);
    if (!pass) console.error('    Details:', details);
    tests.push({ id, desc, pass, details });
  }

  const PORT = 3001;

  function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, ...options }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    });
  }

  async function waitForJob(jobId, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await httpRequest({ path: `/api/jobs/${jobId}`, method: 'GET' });
      if (res.body && (res.body.status === 'completed' || res.body.status === 'failed' || res.body.status === 'cancelled')) {
        return res.body;
      }
      await new Promise(r => setTimeout(r, 60));
    }
    throw new Error(`Timeout waiting for job ${jobId}`);
  }

  try {
    // 1. Loopback and Origin Security (Section 3)
    console.log('\n[Phase 1] Security: Loopback and Origin Controls...');
    const forbiddenRes = await httpRequest({
      path: '/api/status',
      method: 'GET',
      headers: { 'Origin': 'http://malicious-external-site.com' }
    });
    record('SEC-01', 'Server rejects unauthorized external origin with HTTP 403 Forbidden', forbiddenRes.status === 403, forbiddenRes);

    const allowedRes = await httpRequest({
      path: '/api/status',
      method: 'GET',
      headers: { 'Origin': 'http://localhost:3001' }
    });
    record('SEC-02', 'Server permits local loopback origin with HTTP 200', allowedRes.status === 200 && allowedRes.body.status === 'ONLINE');

    // 2. Error Handling & Missing File / Bad SQL (Section 1)
    console.log('\n[Phase 2] Strict Error Handling & Zero Simulated Success...');
    const missingFileDef = {
      nodes: [{ id: 'in_bad', type: 'input', data: { path: 'data/file_does_not_exist_9999.csv', format: 'csv' } }],
      edges: []
    };
    const missingFileRes = await httpRequest({
      path: '/api/run',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pipelineDef: missingFileDef });
    const missingJob = await waitForJob(missingFileRes.body.jobId);
    record('ERR-01', 'Missing file request fails with failed status and descriptive error (never success)', missingJob.status === 'failed' && Boolean(missingJob.error), missingJob);

    const badSqlDef = {
      nodes: [
        { id: 'in_1', type: 'input', data: { path: 'data/correctness_transactions.csv', format: 'csv' } },
        { id: 'filt_bad', type: 'filter', data: { condition: 'INVALID_SQL_COLUMN_xyz >>>> 999' } }
      ],
      edges: [{ source: 'in_1', target: 'filt_bad' }]
    };
    const badSqlRes = await httpRequest({
      path: '/api/run',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pipelineDef: badSqlDef });
    const badSqlJob = await waitForJob(badSqlRes.body.jobId);
    record('ERR-02', 'SQL syntax error transitions to failed status with DuckDB error details (never success)', badSqlJob.status === 'failed' && Boolean(badSqlJob.error), badSqlJob);

    // 3. Normal Pipeline Execution & Addressing by jobId (Sections 2 & 3)
    console.log('\n[Phase 3] Dedicated Worker Execution & Real Output Addressing...');
    const validPipeline = {
      nodes: [
        { id: 'tx_in', type: 'input', data: { path: 'data/correctness_transactions.csv', format: 'csv', header: true } },
        { id: 'tx_sel', type: 'select', data: {
          columns: [
            { name: 'trans_id', alias: 'id', castType: 'BIGINT' },
            { name: 'cust_code', alias: 'customer_code' },
            { name: 'amount', alias: 'val', castType: 'DECIMAL(12,2)' },
            { name: 'status', alias: 'tx_status' }
          ]
        }},
        { id: 'tx_agg', type: 'aggregate', data: {
          groupBy: ['customer_code'],
          aggregations: [
            { expr: 'COUNT(*)', alias: 'orders' },
            { expr: 'SUM(val)', alias: 'total_spent' }
          ]
        }}
      ],
      edges: [
        { source: 'tx_in', target: 'tx_sel' },
        { source: 'tx_sel', target: 'tx_agg' }
      ]
    };

    const runRes = await httpRequest({
      path: '/api/run',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { pipelineDef: validPipeline });

    const job = await waitForJob(runRes.body.jobId);
    record('RUN-01', 'Pipeline executes on dedicated worker child process and returns completed job', job.status === 'completed' && job.jobId !== undefined, job);
    record('RUN-02', 'Job outputs contain real row count and bounded previews without BigInt serialization crash', job.nodeOutputs?.['tx_agg']?.rowCount > 0 && Array.isArray(job.nodeOutputs?.['tx_agg']?.preview), job.nodeOutputs?.['tx_agg']);

    // Poll by jobId
    const jobPollRes = await httpRequest({
      path: `/api/jobs/${job.jobId}`,
      method: 'GET'
    });
    record('RUN-03', 'Job is individually addressable via /api/jobs/:jobId', jobPollRes.status === 200 && jobPollRes.body.jobId === job.jobId);

    // Preview by jobId and nodeId
    const previewRes = await httpRequest({
      path: `/api/preview?jobId=${job.jobId}&nodeId=tx_agg&limit=10`,
      method: 'GET'
    });
    record('RUN-04', 'Bounded preview retrieved by explicit jobId and nodeId', previewRes.status === 200 && previewRes.body.rowCount > 0 && previewRes.body.preview.length > 0);
    record('RUN-04', 'Bounded preview retrieved by explicit jobId and nodeId', previewRes.status === 200 && previewRes.body.preview.length > 0 && previewRes.body.preview.length <= 10, previewRes.body);

    // 4. Invalidation of Downstream Dependent Nodes (Section 3)
    console.log('\n[Phase 4] Downstream Dependent Invalidation...');
    const localRunner = new RunnerService();
    const testJob = localRunner.createJob(validPipeline);
    testJob.nodeOutputs = {
      tx_in: { rowCount: 10, isOutdated: false },
      tx_sel: { rowCount: 10, isOutdated: false },
      tx_agg: { rowCount: 6, isOutdated: false }
    };
    const affected = localRunner.invalidateDownstream(testJob.jobId, 'tx_sel');
    record('INV-01', 'Downstream nodes (tx_sel, tx_agg) identified as affected', affected.includes('tx_sel') && affected.includes('tx_agg') && !affected.includes('tx_in'), affected);
    record('INV-02', 'Downstream node outputs marked isOutdated: true', testJob.nodeOutputs.tx_agg.isOutdated === true && testJob.nodeOutputs.tx_in.isOutdated === false);
    localRunner.destroy();

    // 5. Active Query Cancellation & Worker Teardown (Section 3)
    console.log('\n[Phase 5] Active Worker Query Cancellation...');
    const cancelRunner = new RunnerService();
    const heavyPipeline = {
      nodes: [
        { id: 'in_10m', type: 'input', data: { path: 'data/bench_10m.parquet', format: 'parquet' } },
        { id: 'agg_heavy', type: 'aggregate', data: {
          groupBy: ['cust_id'],
          aggregations: [{ expr: 'COUNT(*)', alias: 'cnt' }, { expr: 'SUM(amount)', alias: 'tot' }]
        }}
      ],
      edges: [{ source: 'in_10m', target: 'agg_heavy' }]
    };
    const cancelJob = cancelRunner.createJob(heavyPipeline);
    const runPromise = cancelRunner.runJob(cancelJob.jobId).catch(err => err);

    await new Promise(r => setTimeout(r, 100)); // Let it start
    const cancelResult = cancelRunner.cancelJob(cancelJob.jobId);
    record('CANC-01', 'Cancellation signal accepted for active running job', cancelResult.success && cancelJob.status === 'cancelled');

    const errorResult = await runPromise;
    record('CANC-02', 'Cancelled running job rejects with cancellation error (never completes as success)', cancelJob.status === 'cancelled' && errorResult.message === 'JOB_CANCELLED_BY_USER', { err: errorResult.message });
    cancelRunner.destroy();

    // 6. Worker Crash Recovery (Section 3)
    console.log('\n[Phase 6] Worker Process Crash & Recovery...');
    const crashRunner = new RunnerService();
    const crashJob = crashRunner.createJob(validPipeline);
    const crashPromise = crashRunner.runJob(crashJob.jobId).catch(err => err);
    await new Promise(r => setTimeout(r, 50));
    if (crashRunner.worker) crashRunner.worker.kill('SIGTERM');

    const crashErr = await crashPromise;
    record('CRASH-01', 'Worker process exit transitions job cleanly to failed state', crashJob.status === 'failed', { error: crashJob.error });

    const recoverJob = crashRunner.createJob(validPipeline);
    const recoverResult = await crashRunner.runJob(recoverJob.jobId);
    record('CRASH-02', 'Subsequent job executes cleanly after worker crash without server restart', recoverResult.status === 'completed');
    crashRunner.destroy();

    // 7. SIREN Docs Export Rejection & Real Export (Section 2)
    console.log('\n[Phase 7] Real Export to Docs & Strict Rejections...');
    const noJobExport = await httpRequest({
      path: '/api/export-docs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { nodeId: 'tx_agg' });
    record('EXP-01', 'Export rejected when jobId is missing (HTTP 400)', noJobExport.status === 400);

    // Register a job with outdated node to test rejection
    const dummyJob = runnerService.createJob(validPipeline);
    dummyJob.status = 'completed';
    dummyJob.nodeOutputs['tx_agg'] = { rowCount: 10, preview: [{ id: 1 }], isOutdated: true };
    runnerService.jobs.set(dummyJob.jobId, dummyJob);

    const outdatedExport = await httpRequest({
      path: '/api/export-docs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { jobId: dummyJob.jobId, nodeId: 'tx_agg' });
    record('EXP-02', 'Export rejected with HTTP 409 when node output is marked outdated', outdatedExport.status === 409);

    // Valid Real Export from the real executed job
    const validExport = await httpRequest({
      path: '/api/export-docs',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { jobId: job.jobId, nodeId: 'tx_agg' });
    record('EXP-03', 'Export succeeds for completed, valid node with real row count and lineage', validExport.status === 200 && (validExport.body.transferredRows > 0 || validExport.body.rowsTransferred > 0) && validExport.body.filePath !== undefined, validExport.body);

    const allPassed = tests.every(t => t.pass);
    console.log(`\nAnalysis repair tests: ${tests.filter(t => t.pass).length}/${tests.length} passed.`);

    if (!allPassed) process.exit(1);
  } finally {
    server.close();
    runnerService.destroy();
  }
}

main().catch(err => {
  console.error('Fatal error in repair test suite:', err);
  process.exit(1);
});
