/**
 * SIREN Analysis & Advanced Automation — Runner Service (Process-Isolated)
 *
 * Manages dedicated DuckDB worker child process, queued job scheduling,
 * cancellation token propagation, worker identity tracking, and bounded preview retrieval.
 */

import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class RunnerService {
  constructor(options = {}) {
    this.options = {
      dataDir: options.dataDir || path.resolve('data'),
      tempDir: options.tempDir || path.resolve('data/temp'),
      maxMemory: options.maxMemory || '4GB',
      threads: options.threads || 4,
      ...options
    };

    this.jobs = new Map();
    this.jobQueue = [];
    this.activeJobId = null;
    this.worker = null;
    this.currentWorkerId = null;
    this.workerCounter = 0;
    this.activeJobPromiseResolvers = null;
    this.retiringWorkers = new Map();
    this.isDestroyed = false;

    this.initWorker();
  }

  initWorker() {
    if (this.isDestroyed) return;

    if (this.worker) {
      if (this.activeJobId) throw new Error('WORKER_BUSY');
      const previous = this.worker;
      this.worker = null;
      this.currentWorkerId = null;
      this.terminateWorker(previous);
    }

    const workerId = `worker_${++this.workerCounter}_${Date.now()}`;
    this.currentWorkerId = workerId;

    const workerPath = path.join(__dirname, '../engine/worker_process.js');
    let child;
    try {
      child = fork(workerPath, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, NODE_ENV: 'production' }
      });
    } catch (error) {
      this.currentWorkerId = null;
      throw error;
    }

    this.worker = child;

    child.on('message', (msg) => {
      // Guard: Ignore messages from old/terminated workers
      if (this.currentWorkerId !== workerId) return;
      this.handleWorkerMessage(msg);
    });

    child.on('error', (err) => {
      if (this.currentWorkerId !== workerId) return;
      console.error(`[Worker ${workerId} Error]:`, err);
      this.handleWorkerFailure(workerId, new Error(`Worker process encountered error: ${err.message}`), true);
    });

    child.on('exit', (code, signal) => {
      this.handleWorkerExit(workerId, code, signal);
    });
    // Spawn/channel failures can close without a preceding exit event.
    child.on('close', (code, signal) => this.handleWorkerExit(workerId, code, signal));
    child.on('disconnect', () => this.handleWorkerFailure(workerId, new Error('Worker IPC channel disconnected'), true));
  }

  handleWorkerExit(workerId, code, signal) {
    this.handleWorkerFailure(workerId, new Error(`Worker process exited unexpectedly (code: ${code}, signal: ${signal})`));
  }

  settleActiveJob(jobId, error = null) {
    const request = this.activeJobPromiseResolvers;
    if (!request || request.jobId !== jobId || this.activeJobId !== jobId) return false;
    // Retire ownership before any continuation or queue dispatch can replace it.
    this.activeJobPromiseResolvers = null;
    this.activeJobId = null;
    if (error) request.reject(error);
    else request.resolve(this.jobs.get(jobId));
    return true;
  }

  handleWorkerFailure(workerId, error, terminate = false) {
    if (this.isDestroyed || this.currentWorkerId !== workerId) return;
    const child = this.worker;
    this.worker = null;
    this.currentWorkerId = null;
    const request = this.activeJobPromiseResolvers;
    if (request?.workerId === workerId && request.jobId === this.activeJobId) {
      const job = this.jobs.get(request.jobId);
      if (job) {
        job.status = 'failed';job.error = error.message;
        job.completedAt = new Date().toISOString();
        job.progress.stepName = `Execution failed: ${error.message}`;
      }
      this.settleActiveJob(request.jobId, error);
    }
    if (terminate) this.terminateWorker(child);
    // A queued request starts on a new generation. Idle failures do not create
    // an unbounded automatic respawn loop; the next explicit run starts it.
    this.processNextInQueue();
  }

  terminateWorker(child, signal = 'SIGTERM') {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    let record = this.retiringWorkers.get(child);
    if (record) {
      if (signal === 'SIGKILL') {
        if (record.timer) clearTimeout(record.timer);
        record.timer = null;
        try { child.kill(signal); } catch (e) {}
      }
      return;
    }
    record = { timer: null };
    this.retiringWorkers.set(child, record);
    child.once('close', () => {
      if (record.timer) clearTimeout(record.timer);
      this.retiringWorkers.delete(child);
    });
    try { child.kill(signal); } catch (e) {}
    if (signal !== 'SIGKILL' && this.retiringWorkers.has(child)) {
      record.timer = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) {
          try { child.kill('SIGKILL'); } catch (e) {}
        }
      }, 300);
      record.timer.unref?.();
    }
  }

  ensureWorker() {
    if (this.isDestroyed) return;
    if (!this.worker || this.worker.killed || !this.worker.connected) {
      this.initWorker();
    }
  }

  handleWorkerMessage(msg) {
    if (this.isDestroyed || !msg || !msg.jobId) return;
    const job = this.jobs.get(msg.jobId);
    const request = this.activeJobPromiseResolvers;
    if (!job || job.status !== 'running' || this.activeJobId !== msg.jobId ||
        request?.jobId !== msg.jobId || request.workerId !== this.currentWorkerId) return;

    switch (msg.type) {
      case 'PROGRESS':
        job.progress = {
          currentStep: msg.stepIndex,
          totalSteps: msg.totalSteps,
          stepName: msg.stepName,
          percent: msg.percent
        };
        break;

      case 'COMPILED_SQL':
        job.generatedSQL = msg.sqlSteps;
        break;

      case 'STEP_RESULT':
        if (job.telemetry.timeToFirstRowMs === null && msg.preview && msg.preview.length > 0) {
          job.telemetry.timeToFirstRowMs = Date.now() - new Date(job.createdAt).getTime();
        }

        if (msg.nodeType === 'input') {
          job.telemetry.totalSourceRows = (job.telemetry.totalSourceRows || 0) + (msg.rowCount || 0);
        } else if (msg.nodeType === 'filter') {
          job.telemetry.rowsAfterFilter = msg.rowCount;
        }

        job.nodeOutputs[msg.nodeId] = {
          nodeId: msg.nodeId,
          nodeType: msg.nodeType || null,
          viewName: msg.viewName || null,
          rowCount: msg.rowCount,
          schema: msg.schema || [],
          preview: msg.preview || [],
          isOutdated: false,
          ...(msg.nodeType === 'export' && msg.producerExport !== undefined
            ? { producerExport: JSON.parse(JSON.stringify(msg.producerExport)) } : {})
        };
        break;

      case 'COMPLETED':
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.telemetry = {
          ...job.telemetry,
          ...msg.telemetry,
          timeToFirstRowMs: job.telemetry.timeToFirstRowMs || msg.telemetry?.durationMs
        };
        job.progress.percent = 100;
        job.progress.stepName = 'Completed successfully';

        this.settleActiveJob(job.jobId);
        this.processNextInQueue();
        break;

      case 'CANCELLED':
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        job.progress.stepName = 'Execution cancelled by user';
        job.telemetry = msg.telemetry || job.telemetry;

        this.settleActiveJob(job.jobId, new Error('JOB_CANCELLED_BY_USER'));
        this.processNextInQueue();
        break;

      case 'FAILED':
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        job.error = msg.error;
        job.telemetry = msg.telemetry || job.telemetry;
        job.progress.stepName = `Execution failed: ${msg.error}`;

        this.settleActiveJob(job.jobId, new Error(msg.error));
        this.processNextInQueue();
        break;
    }
  }

  createJob(pipelineDef, options = {}) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const job = {
      jobId,
      status: 'queued', // queued | running | completed | failed | cancelled
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      pipelineDef,
      generatedSQL: [],
      progress: {
        currentStep: 0,
        totalSteps: 0,
        stepName: 'Queued in runner',
        percent: 0
      },
      nodeOutputs: Object.create(null), // Own-key-safe for all admitted node IDs.
      telemetry: {
        durationMs: 0,
        timeToFirstRowMs: null,
        peakRssMB: 0,
        tempDiskSpillBytes: 0
      },
      error: null
    };

    this.jobs.set(jobId, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async runJob(jobId) {
    if (this.isDestroyed) throw new Error('RUNNER_SERVICE_DESTROYED');
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job "${jobId}" not found`);
    if (this.activeJobId === jobId || this.jobQueue.some(q => q.jobId === jobId)) throw new Error('JOB_ALREADY_SCHEDULED');

    if (this.activeJobId && this.activeJobId !== jobId) {
      // Concurrency management: Queue the job
      return new Promise((resolve, reject) => {
        this.jobQueue.push({ jobId, resolve, reject });
      });
    }

    return this.dispatchJobToWorker(job);
  }

  dispatchJobToWorker(job) {
    return new Promise((resolve, reject) => {
      try { this.ensureWorker(); } catch (error) {
        job.status = 'failed';job.error = error.message;job.completedAt = new Date().toISOString();
        reject(error);Promise.resolve().then(() => this.processNextInQueue());return;
      }
      this.activeJobId = job.jobId;
      job.status = 'running';job.startedAt = new Date().toISOString();job.error = null;
      const workerId = this.currentWorkerId;
      const request = { jobId: job.jobId, workerId, resolve, reject };
      this.activeJobPromiseResolvers = request;
      try { this.worker.send({
        type: 'START_JOB',
        jobId: job.jobId,
        pipelineDef: job.pipelineDef,
        config: {
          dataDir: this.options.dataDir,
          maxMemory: this.options.maxMemory,
          threads: this.options.threads,
          tempDirectory: this.options.tempDir
        }
      }, error => { if (error && this.activeJobPromiseResolvers === request) this.handleWorkerFailure(workerId, error, true); }); }
      catch (error) { if (this.activeJobPromiseResolvers === request) this.handleWorkerFailure(workerId, error, true); }
    });
  }

  processNextInQueue() {
    if (this.jobQueue.length > 0 && !this.activeJobId && !this.isDestroyed) {
      const next = this.jobQueue.shift();
      const job = this.jobs.get(next.jobId);
      if (job && job.status === 'queued') {
        this.dispatchJobToWorker(job)
          .then(next.resolve)
          .catch(next.reject);
      } else {
        this.processNextInQueue();
      }
    }
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job "${jobId}" not found`);

    // 1. Handle Queued Job Cancellation
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.progress.stepName = 'Queued job cancelled';

      // Find and reject all pending promises for this queued job (prevents dangling promises!)
      const matched = this.jobQueue.filter(q => q.jobId === jobId);
      for (const item of matched) {
        try {
          item.reject(new Error('JOB_CANCELLED_IN_QUEUE'));
        } catch (e) {}
      }
      this.jobQueue = this.jobQueue.filter(q => q.jobId !== jobId);
      return { success: true, message: `Queued job ${jobId} cancelled.` };
    }

    // 2. Handle Running Job Cancellation
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.progress.stepName = 'Execution cancelled by user';

      // Settle active promise immediately with cancellation error
      this.settleActiveJob(jobId, new Error('JOB_CANCELLED_BY_USER'));

      // Isolate and terminate current worker process:
      // Never dispatch next jobs on a worker executing a cancelled query!
      const dyingWorker = this.worker;
      this.worker = null;
      this.currentWorkerId = null;
      this.activeJobId = null;

      if (dyingWorker) {
        try {
          dyingWorker.send({ type: 'CANCEL_JOB', jobId });
        } catch (e) {}
        this.terminateWorker(dyingWorker);
      }

      // Initialize a fresh, clean worker for subsequent jobs
      if (!this.isDestroyed) {
        try { this.initWorker(); }
        catch (error) { console.error('Replacement worker could not start after cancellation:', error); }
      }

      // Advance queue on the fresh worker
      this.processNextInQueue();

      return { success: true, message: `Active job ${jobId} cancelled.` };
    }

    return { success: false, message: `Job ${jobId} is in terminal state "${job.status}"` };
  }

  /**
   * Mark specific node outputs as outdated.
   */
  markOutputsOutdated(jobId, nodeIds) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    for (const id of ids) {
      if (job.nodeOutputs[id]) {
        job.nodeOutputs[id].isOutdated = true;
      }
    }
  }

  /**
   * Invalidate a node and all downstream dependent nodes in the DAG.
   */
  invalidateDownstream(jobId, modifiedNodeId) {
    const job = this.jobs.get(jobId);
    if (!job || !job.pipelineDef) return [];

    const edges = job.pipelineDef.edges || [];
    const adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source).push(e.target);
    }

    // Traverse all reachable downstream nodes (BFS)
    const affected = new Set([modifiedNodeId]);
    const queue = [modifiedNodeId];
    while (queue.length > 0) {
      const u = queue.shift();
      const children = adj.get(u) || [];
      for (const v of children) {
        if (!affected.has(v)) {
          affected.add(v);
          queue.push(v);
        }
      }
    }

    // Mark all affected node outputs as outdated
    for (const id of affected) {
      if (job.nodeOutputs[id]) {
        job.nodeOutputs[id].isOutdated = true;
      }
    }

    return Array.from(affected);
  }

  getBoundedPreview(jobId, nodeId, limit = 50, offset = 0) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job "${jobId}" not found`);
    const output = job.nodeOutputs[nodeId];
    if (!output) throw new Error(`Node "${nodeId}" has no computed output in job "${jobId}"`);

    return {
      jobId,
      nodeId,
      rowCount: output.rowCount,
      isOutdated: output.isOutdated,
      preview: (output.preview || []).slice(offset, offset + limit)
    };
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Settle all queued requests
    for (const q of this.jobQueue) {
      try {
        q.reject(new Error('RUNNER_SERVICE_DESTROYED'));
      } catch (e) {}
    }
    this.jobQueue = [];

    // Settle active running job
    this.settleActiveJob(this.activeJobId, new Error('RUNNER_SERVICE_DESTROYED'));
    const child = this.worker;
    this.worker = null;this.currentWorkerId = null;
    this.terminateWorker(child, 'SIGKILL');
    for (const retired of this.retiringWorkers.keys()) if (retired !== child) this.terminateWorker(retired, 'SIGKILL');
  }
}
