/**
 * SIREN Analysis & Advanced Automation — Dedicated Worker Process
 *
 * Runs DuckDB native engine in an isolated child process.
 * Communicates with the main server process exclusively via structured IPC messages.
 */

import { DuckDBRunner, safeJsonStringify } from './duckdb_runner.js';
import { PipelineCompiler } from './pipeline_compiler.js';
import {assertFilterSchema} from './filter-binding.js';
import {assertDerivedSchema} from './derived-binding.js';
import {assertFunctionSchema} from './conditional-binding.js';
import {prepareExport,publishProducedExport} from './export_identity.js';
import fs from 'node:fs';
import path from 'node:path';

let activeRunner = null;
let currentJobId = null;
let isCancelled = false;

// Continuous background resource monitor
let peakWorkerRssMB = 0;
let peakWorkerSpillBytes = 0;
let resourceInterval = null;

function startResourceTracking(tempDir) {
  peakWorkerRssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
  peakWorkerSpillBytes = 0;

  if (resourceInterval) clearInterval(resourceInterval);
  resourceInterval = setInterval(() => {
    const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (rss > peakWorkerRssMB) peakWorkerRssMB = rss;

    try {
      if (fs.existsSync(tempDir)) {
        let b = 0;
        const files = fs.readdirSync(tempDir);
        for (const f of files) {
          try {
            b += fs.statSync(path.join(tempDir, f)).size;
          } catch (e) {}
        }
        if (b > peakWorkerSpillBytes) peakWorkerSpillBytes = b;
      }
    } catch (e) {}
  }, 25);
}

function stopResourceTracking() {
  if (resourceInterval) {
    clearInterval(resourceInterval);
    resourceInterval = null;
  }
}

async function handleStartJob(msg) {
  const { jobId, pipelineDef, config = {} } = msg;
  currentJobId = jobId;
  isCancelled = false;

  const t0 = Date.now();
  const tempDir = config.tempDirectory || path.resolve('data/temp');
  startResourceTracking(tempDir);

  try {
    // 1. Compile DAG to SQL sequence
    process.send({
      type: 'PROGRESS',
      jobId,
      stepIndex: 0,
      totalSteps: 1,
      stepName: 'Compiling DAG to SQL views',
      percent: 5
    });

    const compiler = new PipelineCompiler(pipelineDef, { dataDir: config.dataDir });
    const sqlSteps = compiler.compileToSQL();
    const totalSteps = sqlSteps.length;

    // Send compiled SQL back to parent
    process.send({
      type: 'COMPILED_SQL',
      jobId,
      sqlSteps
    });

    // 2. Initialize native DuckDB instance in this worker process
    activeRunner = new DuckDBRunner({
      dbPath: config.dbPath || ':memory:',
      maxMemory: config.maxMemory || '4GB',
      threads: config.threads || 4,
      tempDirectory: tempDir
    });
    await activeRunner.initialize();

    // 3. Step-by-step execution
    let stepIndex = 0;
    const producedOutputs = new Map();
    for (const step of sqlSteps) {
      if (isCancelled) {
        throw new Error('JOB_CANCELLED_BY_USER');
      }

      stepIndex++;
      const percent = Math.round((stepIndex / totalSteps) * 95);
      process.send({
        type: 'PROGRESS',
        jobId,
        stepIndex,
        totalSteps,
        stepName: `Executing [${step.nodeId}] (${step.nodeType})`,
        percent
      });

      if(step.functionSchemaChecks){
        for(const check of step.functionSchemaChecks){const actual=await activeRunner.getTableSchema(check.viewName);assertFunctionSchema(check,actual);}
      }
      if(step.derivedSchemaCheck){
        const actual=await activeRunner.getTableSchema(step.derivedSchemaCheck.viewName);
        assertDerivedSchema(step.derivedSchemaCheck.columns,actual);
      }
      if(step.filterSchemaCheck){
        const actual=await activeRunner.getTableSchema(step.filterSchemaCheck.viewName);
        assertFilterSchema(step.filterSchemaCheck.columns,actual);
      }

      // Each COPY writes a unique sibling file; public destination is published only after producer identity capture.
      let preparedExport = null;
      if (step.nodeType === 'export') {
        const inputEdge = pipelineDef.edges.find(edge => edge.target === step.nodeId);
        preparedExport = prepareExport(step, producedOutputs.get(inputEdge?.source));
        step.sql = preparedExport.sql;
        step.exportDestination = preparedExport.filePath;
        process.send({ type: 'COMPILED_SQL', jobId, sqlSteps });
      }
      await activeRunner.run(step.sql);
      if (isCancelled) throw new Error('JOB_CANCELLED_BY_USER');

      // Inspect output if not export
      if (step.nodeType !== 'export') {
        const count = await activeRunner.getTableRowCount(step.viewName);
        const preview = await activeRunner.getPreview(step.viewName, 50, 0);
        let schema = [];
        try {
          schema = await activeRunner.getTableSchema(step.viewName);
        } catch (e) {}

        producedOutputs.set(step.nodeId, {nodeId:step.nodeId,viewName:step.viewName,rowCount:count});
        process.send({
          type: 'STEP_RESULT',
          jobId,
          nodeId: step.nodeId,
          nodeType: step.nodeType,
          viewName: step.viewName,
          rowCount: count,
          schema,
          preview
        });
      } else {
        const producerExport = publishProducedExport(preparedExport, {jobId,exportNodeId:step.nodeId});
        process.send({
          type: 'STEP_RESULT',
          jobId,
          nodeId: step.nodeId,
          nodeType: step.nodeType,
          exported: true,
          producerExport,
          rowCount: 0,
          schema: [],
          preview: []
        });
      }
    }

    if (isCancelled) {
      throw new Error('JOB_CANCELLED_BY_USER');
    }

    // 4. Job Completed
    stopResourceTracking();
    const durationMs = Date.now() - t0;
    process.send({
      type: 'COMPLETED',
      jobId,
      telemetry: {
        durationMs,
        peakRssMB: peakWorkerRssMB,
        tempDiskSpillBytes: peakWorkerSpillBytes
      }
    });
  } catch (err) {
    stopResourceTracking();
    const durationMs = Date.now() - t0;
    if (isCancelled || err.message === 'JOB_CANCELLED_BY_USER') {
      process.send({
        type: 'CANCELLED',
        jobId,
        telemetry: {
          durationMs,
          peakRssMB: peakWorkerRssMB,
          tempDiskSpillBytes: peakWorkerSpillBytes
        }
      });
    } else {
      process.send({
        type: 'FAILED',
        jobId,
        error: err.message,
        telemetry: {
          durationMs,
          peakRssMB: peakWorkerRssMB,
          tempDiskSpillBytes: peakWorkerSpillBytes
        }
      });
    }
  } finally {
    if (activeRunner) {
      try {
        await activeRunner.close();
      } catch (e) {}
      activeRunner = null;
    }
    currentJobId = null;
    isCancelled = false;
  }
}

async function handleCancelJob(msg) {
  const { jobId } = msg;
  if (currentJobId === jobId) {
    isCancelled = true;
    if (activeRunner) {
      try {
        await activeRunner.close();
      } catch (e) {}
      activeRunner = null;
    }
  }
}

// IPC listener from parent process
process.on('message', async (msg) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'START_JOB':
      await handleStartJob(msg);
      break;

    case 'CANCEL_JOB':
      await handleCancelJob(msg);
      break;

    case 'PING':
      process.send({ type: 'PONG', pid: process.pid });
      break;

    case 'SHUTDOWN':
      if (activeRunner) {
        try {
          await activeRunner.close();
        } catch (e) {}
      }
      process.exit(0);
      break;

    default:
      console.warn(`[Worker ${process.pid}] Unknown message type:`, msg.type);
  }
});

// Clean shutdown on signals
process.on('SIGTERM', async () => {
  if (activeRunner) {
    try {
      await activeRunner.close();
    } catch (e) {}
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (activeRunner) {
    try {
      await activeRunner.close();
    } catch (e) {}
  }
  process.exit(0);
});
