/**
 * SIREN Analysis & Advanced Automation — Local Process API Server
 *
 * Exposes a loopback-only REST API for the visual editor.
 * Uses RunnerService with an isolated worker child process.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { RunnerService } from './runner_service.js';
import { DocsUniverContract } from '../contracts/docs_univer_contract.js';

const PORT = process.env.PORT || 3001;
const distDir = path.resolve('dist');
const dataDir = path.resolve('data');
const evidenceDir = path.resolve('evidence');

if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

const runnerService = new RunnerService({
  dataDir,
  tempDir: path.join(dataDir, 'temp'),
  maxMemory: '4GB',
  threads: 8
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.parquet': 'application/octet-stream'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Security: Strict Origin Restriction (Loopback Only, No Universal CORS)
  const origin = req.headers['origin'];
  if (origin) {
    const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: unauthorized external origin' }));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Routes ---
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      engine: 'DuckDB v2.0.0 (Native Node API in Isolated Worker Process)',
      host: {
        cpus: os.cpus().length,
        model: os.cpus()[0]?.model,
        totalRamGB: (os.totalmem() / (1024 ** 3)).toFixed(2),
        freeRamGB: (os.freemem() / (1024 ** 3)).toFixed(2)
      }
    }));
    return;
  }

  // POST /api/run — Creates and initiates execution of a visual pipeline
  // POST /api/run — Submits pipeline, immediately returns accepted jobId, and tracks execution in background
  if (pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const pipelineDef = payload.pipelineDef || payload;
        if (!pipelineDef || !Array.isArray(pipelineDef.nodes)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid pipelineDef in request payload' }));
          return;
        }

        const job = runnerService.createJob(pipelineDef);

        // If client explicitly requests synchronous waiting:
        if (payload.sync === true) {
          const completedJob = await runnerService.runJob(job.jobId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(completedJob));
          return;
        }

        // Fast acceptance: Start job in worker process asynchronously and return jobId immediately
        runnerService.runJob(job.jobId).catch(err => {
          console.error(`[Job ${job.jobId} Background Error]:`, err.message);
        });

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          jobId: job.jobId,
          status: job.status,
          createdAt: job.createdAt
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, status: 'failed' }));
      }
    });
    return;
  }

  // GET /api/jobs/:jobId — Poll status of a specific job
  if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
    const jobId = pathname.replace('/api/jobs/', '');
    const job = runnerService.getJob(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Job "${jobId}" not found` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(job));
    return;
  }

  // POST /api/jobs/:jobId/cancel or POST /api/cancel — Cancels a specific job by jobId
  if ((pathname.endsWith('/cancel') || pathname === '/api/cancel') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        let jobId = payload.jobId;
        if (!jobId && pathname.startsWith('/api/jobs/')) {
          jobId = pathname.replace('/api/jobs/', '').replace('/cancel', '');
        }

        if (!jobId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing jobId in cancellation request' }));
          return;
        }

        const job = runnerService.getJob(jobId);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Job "${jobId}" not found` }));
          return;
        }

        const cancelRes = runnerService.cancelJob(jobId);
        if (cancelRes.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cancelRes));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cancelRes));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/preview?jobId=...&nodeId=...&limit=50 — Bounded preview for a specific job & node
  if (pathname === '/api/preview' && req.method === 'GET') {
    const jobId = parsedUrl.searchParams.get('jobId') || runnerService.activeJobId;
    const nodeId = parsedUrl.searchParams.get('nodeId');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);

    if (!jobId || !nodeId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required query parameters: jobId and nodeId' }));
      return;
    }

    try {
      const preview = runnerService.getBoundedPreview(jobId, nodeId, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(preview));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/export-docs — Exports a completed, non-outdated node result to SIREN Docs v1.0.0
  if (pathname === '/api/export-docs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const jobId = payload.jobId;
        const nodeId = payload.nodeId;

        if (!jobId || !nodeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Export requires explicit "jobId" and "nodeId" parameters' }));
          return;
        }

        const job = runnerService.getJob(jobId);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Job "${jobId}" not found` }));
          return;
        }

        if (job.status !== 'completed') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Cannot export: job "${jobId}" is not in "completed" state (current: "${job.status}")` }));
          return;
        }

        const nodeOutput = job.nodeOutputs[nodeId];
        if (!nodeOutput) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Node "${nodeId}" has no computed output in job "${jobId}"` }));
          return;
        }

        if (nodeOutput.isOutdated) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Cannot export: output of node "${nodeId}" is marked outdated because upstream configuration changed` }));
          return;
        }

        // Extract real preview records (never fall back to hardcoded data!)
        const previewRows = nodeOutput.preview || [];
        if (previewRows.length === 0 && nodeOutput.rowCount > 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Node output has rowCount > 0 but preview is empty' }));
          return;
        }

        const colNames = (nodeOutput.schema || []).map(c => c.columnName || c.name);
  if (!colNames.length || colNames.some(c => typeof c !== 'string' || !c)) throw new Error('Exact result schema is required for Docs export');
        const matrixRows = previewRows.map(row => colNames.map(c => row[c]));

        // Check if an actual full export file exists on disk (never invent a path!)
        let verifiedExportPath = null;
        const candidateExportPath = path.join(dataDir, `${nodeId}_full.parquet`);
        if (fs.existsSync(candidateExportPath) && fs.statSync(candidateExportPath).size > 0) {
          verifiedExportPath = candidateExportPath.replace(/\\/g, '/');
        }

        const totalSourceRows = (job.telemetry?.totalSourceRows !== undefined && job.telemetry?.totalSourceRows !== null)
          ? job.telemetry.totalSourceRows
          : (nodeOutput.nodeType === 'input' ? nodeOutput.rowCount : null);
        const rowsAfterFilter = (job.telemetry?.rowsAfterFilter !== undefined && job.telemetry?.rowsAfterFilter !== null)
          ? job.telemetry.rowsAfterFilter
          : null;

        const univerWb = DocsUniverContract.createUniverWorkbook({
          workbookId: `wb-${jobId}-${nodeId}`,
          sheetName: `Output: ${nodeId}`,
          columnNames: colNames,
          schema: nodeOutput.schema || [],
          rows: matrixRows,
          lineage: {
            jobId: job.jobId,
            sourceNodeId: nodeId,
            totalResultRows: nodeOutput.rowCount,
            totalSourceRows,
            rowsAfterFilter,
            executionDurationMs: job.telemetry?.durationMs || 0,
            fullExportPath: verifiedExportPath
          }
        });

        const docsEnvelope = DocsUniverContract.createDocsEnvelope({
          title: `SIREN Analysis Export — Node [${nodeId}]`,
          description: `Analysis workflow job "${job.jobId}" processed ${nodeOutput.rowCount.toLocaleString()} records in native DuckDB. Output transferred to SIREN Docs v1.0.0 format.`,
          workbook: univerWb,
          lineage: {
            jobId: job.jobId,
            sourceNodeId: nodeId,
            totalResultRows: nodeOutput.rowCount,
            totalSourceRows,
            rowsAfterFilter,
            executionDurationMs: job.telemetry?.durationMs || 0,
            fullExportPath: verifiedExportPath
          }
        });

        const outFilePath = path.join(evidenceDir, 'exported_analysis.sirendoc.json');
        fs.writeFileSync(outFilePath, JSON.stringify(docsEnvelope, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          jobId: job.jobId,
          nodeId,
          filePath: 'evidence/exported_analysis.sirendoc.json',
          schemaVersion: '1.0.0',
          transferredRows: matrixRows.length,
          totalResultRows: nodeOutput.rowCount,
          transferStatus: univerWb.lineage.transferStatus,
          fullFileExportAvailable: univerWb.lineage.fullFileExportAvailable,
          transferStatus: univerWb.lineage.transferStatus
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Static File Serving (dist/) ---
  let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// Bind exclusively to 127.0.0.1 (Loopback only)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`SIREN Analysis & Automation local service running at: http://127.0.0.1:${PORT}`);
  console.log(`Bound strictly to loopback interface 127.0.0.1`);
});

export { server, runnerService };
