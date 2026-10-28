import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RecoveryOrchestrator } from './worker/src/recovery_orchestrator.js';
import { compileSingleInputQuery, normalizeReaderOptions } from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/query_compiler.js';
import { ReceiptVerifier } from 'file:///C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate/src/receipt_verifier.js';
import { validateBinEdges, quoteIdentifier, normalizeEngineBins, createHistogramDefinition, sha } from './assets/histogram.js';

const C = createRequire(import.meta.url)('./assets/chart-core.cjs');

const INTEGER_OR_DECIMAL_REGEX = /^(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|DECIMAL\(\d+,\s*\d+\))$/;

function expressions(measure, edges) {
  validateBinEdges(edges);
  if (edges.length > 21) throw Error('COMPOSITION_MAX_20_BINS');
  const c = quoteIdentifier(measure);
  return [
    ['COUNT(*)', 'total_count'],
    [`COUNT(${c})`, 'non_null_count'],
    [`COUNT(*)-COUNT(${c})`, 'null_count'],
    [`COUNT(CASE WHEN ${c}<${edges[0]} OR ${c}>${edges.at(-1)} THEN 1 END)`, 'out_of_range_count'],
    [`CAST(MIN(${c}) AS VARCHAR)`, 'min_observed'],
    [`CAST(MAX(${c}) AS VARCHAR)`, 'max_observed'],
    ...edges.slice(1).map((v, i) => [
      `COUNT(CASE WHEN ${c}>=${edges[i]} AND ${c}${i === edges.length - 2 ? '<=' : '<'}${v} THEN 1 END)`,
      'bin_' + i
    ])
  ].map(([expr, alias]) => expr + ' AS ' + quoteIdentifier(alias)).join(', ');
}

function validateSnapshotAndOptions(snapshot, rawOptions = {}) {
  if (!snapshot) throw Error('SNAPSHOT_NOT_FOUND');
  const ext = path.extname(snapshot.snapshotPath || '').toLowerCase();
  const format = (snapshot.format || '').toLowerCase();

  if (format === 'parquet') {
    if (ext !== '.parquet') throw Error('UNSUPPORTED_INPUT_FORMAT');
    const normalized = normalizeReaderOptions(rawOptions);
    if (Object.keys(normalized).length > 0) throw Error('PARQUET_DOES_NOT_ACCEPT_CSV_OPTIONS');
    return normalized;
  }

  if (format === 'csv') {
    if (ext !== '.csv') throw Error('UNSUPPORTED_INPUT_FORMAT');
    return normalizeReaderOptions(rawOptions);
  }

  throw Error('UNSUPPORTED_INPUT_FORMAT');
}

export class DurableHistogramBridge {
  constructor({ baseDir, exportDir }) {
    if (!path.isAbsolute(exportDir)) throw Error('EXPLICIT_EXPORT_DIR');
    this.exportDir = exportDir;
    this.engine = new RecoveryOrchestrator({ baseDir });
    this.ready = false;
    this.busy = false;
    this.stopping = false;
    this.operationDone = null;
  }

  async open() {
    if (this.busy || this.ready || this.stopping) throw Error('BRIDGE_STATE');
    this.busy = true;
    try {
      const r = await this.engine.recover();
      this.ready = true;
      return r;
    } finally {
      this.busy = false;
    }
  }

  async operation(fn) {
    if (!this.ready || this.busy || this.stopping) throw Error('BRIDGE_STATE');
    this.busy = true;
    let finish;
    this.operationDone = new Promise(r => { finish = r; });
    try {
      return await fn();
    } finally {
      this.busy = false;
      finish();
    }
  }

  async capture(file, options) {
    return await this.operation(() => this.engine.captureInput(file, options));
  }

  async histogram(raw) {
    const spec = JSON.parse(JSON.stringify(raw));
    return await this.operation(async () => {
      const { jobId, snapshotId, measure, edges, options = {} } = spec;
      const baseSnapshot = this.engine.catalog.getSnapshot(snapshotId);
      const normalizedOptions = validateSnapshotAndOptions(baseSnapshot, options);
      const input = { ...baseSnapshot, options: normalizedOptions };
      const selectExpr = expressions(measure, edges);

      const schema = await this.engine.executeJob({
        jobId: jobId + '_schema',
        inputs: [input],
        compiledQuery: compileSingleInputQuery(input)
      });
      if (schema.receipt.status !== 'SUCCESS') throw Error('SCHEMA_EXECUTION_FAILED: ' + (schema.error || schema.receipt?.error || ''));

      const type = schema.receipt.schema.find(c => c.name === measure)?.type;
      if (!INTEGER_OR_DECIMAL_REGEX.test(type || '')) throw Error('EXACT_INTEGER_DECIMAL_MEASURE_REQUIRED');

      const r = await this.engine.executeJob({
        jobId,
        inputs: [input],
        compiledQuery: compileSingleInputQuery(input, { selectExpr })
      });
      if (r.receipt.status !== 'SUCCESS') throw Error('HISTOGRAM_EXECUTION_FAILED: ' + (r.error || r.receipt?.error || ''));

      return await this._packSaved({
        ...spec,
        options: normalizedOptions,
        expectedReceiptDigest: r.receipt.receiptDigest
      });
    });
  }

  async packSaved(raw) {
    const spec = JSON.parse(JSON.stringify(raw));
    return await this.operation(() => this._packSaved(spec));
  }

  async _packSaved(raw) {
    const { jobId, measure, edges, unit = null, options, expectedReceiptDigest } = JSON.parse(JSON.stringify(raw));
    const job = this.engine.catalog.jobs.get(jobId);
    const schema = this.engine.catalog.jobs.get(jobId + '_schema');

    if (!this.ready || this.stopping || job?.status !== 'SUCCESS' || !job.receiptValid || !expectedReceiptDigest || job.receipt.receiptDigest !== expectedReceiptDigest) {
      throw Error('SAVED_RESULT_VERSION_REQUIRED');
    }

    const r = job.receipt;
    const rows = job.capturedRows;
    await ReceiptVerifier.verifyReceipt(r, { capturedRows: rows, verifyDiskHashes: true });

    if (
      r.metrics.transferStatus !== 'COMPLETE' ||
      r.metrics.outputRowCount !== '1' ||
      rows.length !== 1 ||
      r.inputs.length !== 1 ||
      r.compiledExecution.queryPlan.kind !== 'single' ||
      JSON.stringify(r.compiledExecution.queryPlan.options) !== JSON.stringify({ selectExpr: expressions(measure, edges) })
    ) {
      throw Error('COMPLETE_HISTOGRAM_REQUEST_REQUIRED');
    }

    if (
      schema?.status !== 'SUCCESS' ||
      !schema.receiptValid ||
      schema.receipt.inputs[0].snapshotSha256 !== r.inputs[0].snapshotSha256 ||
      schema.receipt.inputs[0].snapshotId !== r.inputs[0].snapshotId
    ) {
      throw Error('SCHEMA_INPUT_BINDING');
    }

    await ReceiptVerifier.verifyReceipt(schema.receipt, { capturedRows: schema.capturedRows, verifyDiskHashes: true });

    const schemaReceipt = schema.receipt;
    const plain = compileSingleInputQuery(schemaReceipt.inputs[0]);

    if (
      schemaReceipt.inputs.length !== 1 ||
      schemaReceipt.compiledExecution.queryPlan.kind !== 'single' ||
      JSON.stringify(schemaReceipt.compiledExecution.queryPlan.options) !== '{}' ||
      JSON.stringify(schemaReceipt.compiledExecution.queryPlan.inputIds) !== JSON.stringify([r.inputs[0].snapshotId]) ||
      schemaReceipt.compiledExecution.sql !== plain.sql ||
      schemaReceipt.compiledExecution.sqlDigest !== plain.sqlDigest ||
      sha(schemaReceipt.inputs[0].options) !== sha(r.inputs[0].options) ||
      schemaReceipt.metrics.outputRowCount !== r.inputs[0].sourceRowCount ||
      schemaReceipt.inputs[0].sourceRowCount !== r.inputs[0].sourceRowCount
    ) {
      throw Error('DIRECT_SOURCE_SCHEMA_QUERY_REQUIRED');
    }

    if (options !== undefined && sha(normalizeReaderOptions(options)) !== sha(r.inputs[0].options)) {
      throw Error('INPUT_OPTIONS_MISMATCH');
    }

    const type = schema.receipt.schema.find(c => c.name === measure)?.type;
    if (!INTEGER_OR_DECIMAL_REGEX.test(type || '')) throw Error('EXACT_INTEGER_DECIMAL_MEASURE_REQUIRED');
    if (String(rows[0].total_count) !== r.inputs[0].sourceRowCount) throw Error('SOURCE_POPULATION_BINDING');

    const version = 'receipt-sha256:' + r.receiptDigest;
    const base = normalizeEngineBins({
      wideRow: rows[0],
      edges,
      measureColumn: measure,
      unit,
      source: {
        sourceId: r.inputs[0].nodeId || r.inputs[0].snapshotId,
        jobId,
        resultVersion: version,
        state: 'unknown',
        capturedAt: r.executionTiming.completedAt
      },
      coverageMeta: {
        sourceSemantic: 'direct-observation-distribution',
        initialSourceRowCount: r.inputs[0].sourceRowCount
      }
    });

    const snapshot = {
      ...base,
      source: {
        ...base.source,
        origin: {
          executionMode: 'recovered-catalog-child-execution',
          receiptDigest: r.receiptDigest,
          schemaReceiptDigest: schemaReceipt.receiptDigest,
          schemaSqlDigest: schemaReceipt.compiledExecution.sqlDigest,
          workerId: r.compiledExecution.workerId,
          engineVersion: r.compiledExecution.engineVersion,
          attemptId: job.currentAttemptId,
          sessionToken: job.currentSessionToken,
          inputSnapshots: r.inputs,
          measureType: type,
          unitOrigin: unit === null ? 'none' : 'explicit-caller-supplied',
          originalCurrentState: 'unknown'
        }
      },
      coverage: {
        ...base.coverage,
        aggregation: {
          ...base.coverage.aggregation,
          populationBasis: 'complete-captured-input-rows',
          weighting: 'none'
        }
      }
    };

    const definition = createHistogramDefinition(snapshot);
    definition.appearance = 'light';
    const file = await C.pack(snapshot, definition);
    await C.unpack(JSON.stringify(file));

    if (
      this.stopping ||
      job.currentSessionToken !== this.engine.catalog.jobs.get(jobId)?.currentSessionToken ||
      job.receipt?.receiptDigest !== r.receiptDigest
    ) {
      throw Error('BRIDGE_STOPPED_OR_RESULT_CHANGED');
    }

    fs.mkdirSync(this.exportDir, { recursive: true });
    const destination = path.join(this.exportDir, sha({ jobId, version }) + '.sirenchart.json');
    fs.writeFileSync(destination, JSON.stringify(file, null, 2), { flag: 'wx' });
    return { filePath: destination, file, receiptDigest: r.receiptDigest, resultVersion: version };
  }

  async retryJob(jobId, compiledQuery, inputs) {
    return await this.operation(() => this.engine.retryJob(jobId, compiledQuery, inputs));
  }

  async retry(raw) {
    if (typeof raw === 'string') {
      return await this.retryJob(raw);
    }
    const spec = JSON.parse(JSON.stringify(raw));
    return await this.operation(async () => {
      const { jobId, snapshotId, measure, edges, options = {} } = spec;

      let schemaJob = this.engine.catalog.jobs.get(jobId + '_schema');
      const retainedInput = this.engine.catalog.jobs.get(jobId)?.attempts?.at(-1)?.inputs?.[0] || schemaJob?.attempts?.at(-1)?.inputs?.[0];
      if (retainedInput && snapshotId !== undefined && snapshotId !== retainedInput.snapshotId) throw Error('INPUT_SNAPSHOT_MISMATCH');
      const baseSnapshot = this.engine.catalog.getSnapshot(retainedInput?.snapshotId || snapshotId);
      const retainedOptions = retainedInput?.options || options;
      const normalizedOptions = validateSnapshotAndOptions(baseSnapshot, retainedOptions);
      // Omission restores the retained reader. An explicit caller claim must
      // agree before any schema retry, worker dispatch or saved-result export.
      if (Object.hasOwn(spec, 'options') && sha(validateSnapshotAndOptions(baseSnapshot, spec.options)) !== sha(normalizedOptions)) throw Error('INPUT_OPTIONS_MISMATCH');
      const input = { ...baseSnapshot, options: normalizedOptions };

      if (!schemaJob || ['FAILED', 'CRASHED', 'CANCELLED', 'INTERRUPTED'].includes(schemaJob.status)) {
        if (schemaJob) {
          await this.engine.retryJob(jobId + '_schema', compileSingleInputQuery(input), [input]);
        } else {
          await this.engine.executeJob({
            jobId: jobId + '_schema',
            inputs: [input],
            compiledQuery: compileSingleInputQuery(input)
          });
        }
        schemaJob = this.engine.catalog.jobs.get(jobId + '_schema');
      }
      if (schemaJob?.status !== 'SUCCESS') throw Error('SCHEMA_EXECUTION_FAILED: ' + (schemaJob?.error || ''));

      // A later public histogram call can replace the companion schema while
      // leaving the retained histogram failed. Never dispatch that retry using
      // a schema from another input, reader or derived query.
      if (!schemaJob.receiptValid || schemaJob.receipt.inputs.length !== 1 ||
          schemaJob.receipt.inputs[0].snapshotId !== input.snapshotId ||
          schemaJob.receipt.inputs[0].snapshotSha256 !== input.contentSha256) throw Error('SCHEMA_INPUT_BINDING');
      await ReceiptVerifier.verifyReceipt(schemaJob.receipt, { capturedRows: schemaJob.capturedRows, verifyDiskHashes: true });
      const schemaReceipt = schemaJob.receipt, plain = compileSingleInputQuery(input);
      if (sha(schemaReceipt.inputs[0].options) !== sha(normalizedOptions) ||
          schemaReceipt.compiledExecution.queryPlan.kind !== 'single' ||
          JSON.stringify(schemaReceipt.compiledExecution.queryPlan.options) !== '{}' ||
          JSON.stringify(schemaReceipt.compiledExecution.queryPlan.inputIds) !== JSON.stringify([input.snapshotId]) ||
          schemaReceipt.compiledExecution.sql !== plain.sql ||
          schemaReceipt.compiledExecution.sqlDigest !== plain.sqlDigest ||
          schemaReceipt.metrics.outputRowCount !== schemaReceipt.inputs[0].sourceRowCount) throw Error('DIRECT_SOURCE_SCHEMA_QUERY_REQUIRED');

      const type = schemaJob.receipt.schema.find(c => c.name === measure)?.type;
      if (!INTEGER_OR_DECIMAL_REGEX.test(type || '')) throw Error('EXACT_INTEGER_DECIMAL_MEASURE_REQUIRED');

      const selectExpr = expressions(measure, edges);
      const compiledHist = compileSingleInputQuery(input, { selectExpr });

      let histJob = this.engine.catalog.jobs.get(jobId);
      let r;
      if (!histJob || ['FAILED', 'CRASHED', 'CANCELLED', 'INTERRUPTED'].includes(histJob.status)) {
        if (histJob) {
          r = await this.engine.retryJob(jobId, compiledHist, [input]);
        } else {
          r = await this.engine.executeJob({
            jobId,
            inputs: [input],
            compiledQuery: compiledHist
          });
        }
      } else if (histJob.status === 'SUCCESS') {
        r = { receipt: histJob.receipt, capturedRows: histJob.capturedRows };
      } else {
        throw Error('JOB_NOT_RETRYABLE');
      }

      if (r.receipt.status !== 'SUCCESS') throw Error('HISTOGRAM_EXECUTION_FAILED: ' + (r.error || r.receipt?.error || ''));
      return await this._packSaved({
        ...spec,
        options: normalizedOptions,
        expectedReceiptDigest: r.receipt.receiptDigest
      });
    });
  }

  async killWorker() {
    return await this.engine.killWorker();
  }

  async crashWorkerViaIPC() {
    return await this.engine.crashWorkerViaIPC();
  }

  async close() {
    this.stopping = true;
    const pending = this.operationDone;
    await this.engine.shutdown();
    if (pending) await pending;
    this.ready = false;
  }
}
