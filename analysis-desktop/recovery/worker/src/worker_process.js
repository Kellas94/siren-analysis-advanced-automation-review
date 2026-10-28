/**
 * SIREN Analysis Dedicated Child Worker Process
 *
 * Runs DuckDB queries in a dedicated isolated process.
 * Communicates with parent over Node IPC channel.
 * Binds every execution to (jobId, attemptId, sessionToken).
 * Reports real runtime version and real process PID.
 */

import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// Native DuckDB Node API from verified candidate environment
import { DuckDBInstance } from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/histogram-workflow-ui-v1/analysis/node_modules/@duckdb/node-api/lib/duckdb.js';

import {
  createExecutionReceipt,
  canonicalJson,
  quoteSqlIdentifier,
  buildTableReaderExpr,
  recompileQuery,
  normalizeReaderOptions,
  computeFileSha256,
  SnapshotError,
  ErrorCodes
} from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/index.js';

import { MessageTypes, validateSessionBinding } from './worker_protocol.js';

let duckdbInstance = null;
let duckdbConnection = null;
let currentEngineVersion = null;
let isExecuting = false;
let currentAbortSignal = false;
let activeStamp=null;
function ensureNotCancelled(){if(currentAbortSignal)throw new SnapshotError(ErrorCodes.EXECUTION_CANCELLED,'Execution cancelled');}
async function verifyInputFiles(inputs){for(const input of inputs){const disk=await computeFileSha256(input.snapshotPath);if(disk.sha256!==input.contentSha256||disk.byteCount!==input.byteCount)throw Error('SNAPSHOT_INTEGRITY_MISMATCH');ensureNotCancelled();}}

async function getDuckDBConnection(tempDir) {
  if (!duckdbConnection) {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const config = {
      max_memory: '2GB',
      threads: '4',
      temp_directory: tempDir.replace(/\\/g, '/')
    };
    duckdbInstance = await DuckDBInstance.create(':memory:', config);
    duckdbConnection = await duckdbInstance.connect();
    const verRes = await duckdbConnection.run('SELECT version()');
    const verRows = await verRes.getRows();
    currentEngineVersion = verRows[0][0];
  }
  return duckdbConnection;
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case MessageTypes.EXECUTE_REQUEST:
      await handleExecute(msg);
      break;

    case MessageTypes.CANCEL_REQUEST:
      handleCancel(msg);
      break;

    case MessageTypes.CRASH_INJECT:
      handleCrashInject(msg);
      break;

    case MessageTypes.SHUTDOWN_REQUEST:
      await handleShutdown(msg);
      break;
  }
});

async function handleExecute(msg) {
  const { id, jobId, attemptId, sessionToken, inputs, compiledQuery, tempDir, retryCount = 0 } = msg;
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  if(isExecuting)return;
  activeStamp={id,jobId,attemptId,sessionToken};
  isExecuting = true;
  currentAbortSignal = false;

  try {
    const conn = await getDuckDBConnection(tempDir || path.resolve('./temp'));

    // Recompile query and check plan binding
    const normalizedInputs = inputs.map((inp) => ({
      ...inp,
      options: normalizeReaderOptions(inp.options || {})
    }));

    const expected = recompileQuery(normalizedInputs, compiledQuery.queryPlan);
    if (expected.sql !== compiledQuery.sql || expected.sqlDigest !== compiledQuery.sqlDigest) {
      throw new Error('QUERY_INPUT_BINDING');
    }

    if (currentAbortSignal) {
      throw new SnapshotError(ErrorCodes.EXECUTION_CANCELLED, 'Execution was cancelled before starting');
    }

    await verifyInputFiles(normalizedInputs);ensureNotCancelled();
    // Execute query with bounded 50 row capture
    const boundedSql = `SELECT * FROM (${compiledQuery.sql}) AS captured_result LIMIT 50`;
    const queryRes = await conn.run(boundedSql);
    const rows = await queryRes.getRowObjectsJson();

    if (currentAbortSignal) {
      throw new SnapshotError(ErrorCodes.EXECUTION_CANCELLED, 'Execution was cancelled after row capture');
    }

    // Describe schema
    const describeRes = await conn.run(`DESCRIBE ${compiledQuery.sql}`);
    const describeRows = await describeRes.getRows();ensureNotCancelled();
    const schema = describeRows.map((r) => ({
      name: r[0],
      type: r[1],
      nullable: r[2] === 'YES'
    }));

    if (new Set(schema.map((c) => c.name)).size !== schema.length) {
      throw new Error('AMBIGUOUS_RESULT_SCHEMA');
    }

    // Full population count & null counts
    const fullSQL = `SELECT COUNT(*)::VARCHAR AS output_count${schema
      .map((c, i) => `, COUNT(*) FILTER (WHERE ${quoteSqlIdentifier(c.name)} IS NULL)::VARCHAR AS null_${i}`)
      .join('')} FROM (${compiledQuery.sql}) AS full_result`;

    const fullRes = await conn.run(fullSQL);
    const fullRows = await fullRes.getRowObjectsJson();ensureNotCancelled();
    const full = fullRows[0];

    // Source row counts per input
    const inputRowCounts = {};
    const enrichedInputs = [];
    for (let i = 0; i < normalizedInputs.length; i++) {
      const inp = normalizedInputs[i];
      const readerExpr = buildTableReaderExpr(inp);
      const countRes = await conn.run(`SELECT COUNT(*)::BIGINT AS cnt FROM ${readerExpr}`);
      const countRows = await countRes.getRows();ensureNotCancelled();
      const sourceRowCount = countRows[0][0];

      inputRowCounts[inp.snapshotId] = String(sourceRowCount);
      enrichedInputs.push({
        ...inp,
        inputIndex: i,
        sourceRowCount: String(sourceRowCount)
      });
    }

    await verifyInputFiles(normalizedInputs);ensureNotCancelled();
    const nullCounts = Object.fromEntries(schema.map((c, i) => [c.name, full['null_' + i]]));
    const resultDigest = crypto.createHash('sha256').update(canonicalJson(rows)).digest('hex');

    const durationMs = Math.round(performance.now() - t0);
    const completedAt = new Date().toISOString();

    const receipt = createExecutionReceipt({
      jobId,
      status: 'SUCCESS',
      inputs: enrichedInputs,
      sql: compiledQuery.sql,
      sqlDigest: compiledQuery.sqlDigest,
      engineVersion: currentEngineVersion,
      workerId: `worker_pid_${process.pid}`,
      queryPlan: compiledQuery.queryPlan,
      schema,
      metrics: {
        inputRowCounts,
        outputRowCount: full.output_count,
        capturedRows: rows.length,
        transferStatus: BigInt(full.output_count) > BigInt(rows.length) ? 'TRUNCATED' : 'COMPLETE',
        nullCounts
      },
      resultDigest,
      timing: { startedAt, completedAt, durationMs },
      retryCount
    });

    ensureNotCancelled();
    if (process.send) {
      process.send({
        type: MessageTypes.EXECUTE_SUCCESS,
        id,
        jobId,
        attemptId,
        sessionToken,
        workerPid: process.pid,
        engineVersion: currentEngineVersion,
        receipt,
        capturedRows: rows
      });
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - t0);
    const completedAt = new Date().toISOString();
    const isCancelled = err.code === ErrorCodes.EXECUTION_CANCELLED || currentAbortSignal;

    const receipt = createExecutionReceipt({
      jobId,
      status: isCancelled ? 'CANCELLED' : 'FAILED',
      inputs,
      sql: compiledQuery.sql,
      sqlDigest: compiledQuery.sqlDigest,
      engineVersion: currentEngineVersion || 'unknown',
      workerId: `worker_pid_${process.pid}`,
      queryPlan: compiledQuery.queryPlan,
      timing: { startedAt, completedAt, durationMs },
      retryCount,
      error: err.message
    });

    if (process.send) {
      process.send({
        type: MessageTypes.EXECUTE_FAILURE,
        id,
        jobId,
        attemptId,
        sessionToken,
        workerPid: process.pid,
        status: isCancelled ? 'CANCELLED' : 'FAILED',
        error: err.message,
        receipt
      });
    }
  } finally {
    isExecuting = false;activeStamp=null;
  }
}

function handleCancel(msg) {
  if(!isExecuting||!validateSessionBinding(msg,activeStamp)||(msg.id&&msg.id!==activeStamp.id))return;
  currentAbortSignal = true;
  if (duckdbConnection) {
    try {
      duckdbConnection.interrupt();
    } catch (e) {}
  }
  if (process.send) {
    process.send({
      type: MessageTypes.CANCEL_ACK,
      jobId: msg.jobId,
      attemptId: msg.attemptId,
      sessionToken: msg.sessionToken,
      workerPid: process.pid
    });
  }
}

function handleCrashInject(msg) {
  if(isExecuting&&!validateSessionBinding(msg,activeStamp))return;
  // Real child process termination (hard kill / abort)
  console.error(`[Worker ${process.pid}] CRASH INJECTION TRIGGERED for Job ${msg.jobId}`);
  // Terminate immediately with non-zero exit code to simulate violent crash
  process.exit(137);
}

async function handleShutdown(msg) {
  if (duckdbConnection && duckdbConnection.closeSync) {
    try {
      duckdbConnection.closeSync();
    } catch (e) {}
  }
  duckdbConnection = null;
  duckdbInstance = null;
  if (process.send) {
    process.send({
      type: MessageTypes.SHUTDOWN_ACK,
      workerPid: process.pid
    });
  }
  process.exit(0);
}

process.once('disconnect',()=>{currentAbortSignal=true;try{duckdbConnection?.interrupt();}catch{}process.exit(1);});
