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
    this.isDestroyed = false;

    this.initWorker();
  }

  initWorker() {
    if (this.isDestroyed) return;

    if (this.worker) {
      try {
        this.worker.kill('SIGTERM');
      } catch (e) {}
      this.worker = null;
    }

    const workerId = `worker_${++this.workerCounter}_${Date.now()}`;
    this.currentWorkerId = workerId;

    const workerPath = path.join(__dirname, '../engine/worker_process.js');
    const child = fork(workerPath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.worker = child;

    child.on('message', (msg) => {
      // Guard: Ignore messages from old/terminated workers
      if (this.currentWorkerId !== workerId) return;
      this.handleWorkerMessage(msg);
    });

    child.on('error', (err) => {
      if (this.currentWorkerId !== workerId) return;
      console.error(`[Worker ${workerId} Error]:`, err);
      if (this.activeJobId) {
        const job = this.jobs.get(this.activeJobId);
        if (job && job.status === 'running') {
          job.status = 'failed';
          job.error = `Worker process encountered error: ${err.message}`;
          job.completedAt = new Date().toISOString();
        }
      }
    });

    child.on('exit', (code, signal) => {
      this.handleWorkerExit(workerId, code, signal);
    });
  }

  handleWorkerExit(workerId, code, signal) {
    if (this.isDestroyed) return;

    // Ignore exit events from previous terminated workers
    if (this.currentWorkerId !== workerId) return;

    if (this.activeJobId) {
      const job = this.jobs.get(this.activeJobId);
      if (job && job.status === 'running') {
        job.status = 'failed';
        job.error = `Worker process exited unexpectedly (code: ${code}, signal: ${signal})`;
        job.completedAt = new Date().toISOString();
        if (this.activeJobPromiseResolvers) {
          this.activeJobPromiseResolvers.reject(new Error(job.error));
          this.activeJobPromiseResolvers = null;
        }
      }
      this.activeJobId = null;
    }

    this.worker = null;
    this.currentWorkerId = null;

    // Automatically respawn clean worker and process any queued jobs
    this.initWorker();
    this.processNextInQueue();
  }

  ensureWorker() {
    if (this.isDestroyed) return;
    if (!this.worker || this.worker.killed || !this.worker.connected) {
      this.initWorker();
    }
  }

  handleWorkerMessage(msg) {
    if (!msg || !msg.jobId) return;
    const job = this.jobs.get(msg.jobId);
    if (!job) return;

    // Critical State Protection: If parent already marked job as 'cancelled',
    // ignore any delayed 'COMPLETED' or 'STEP_RESULT' messages from worker!
    if (job.status === 'cancelled') {
      return;
    }

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
          isOutdated: false
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

        if (this.activeJobPromiseResolvers) {
          this.activeJobPromiseResolvers.resolve(job);
          this.activeJobPromiseResolvers = null;
        }
        this.activeJobId = null;
        this.processNextInQueue();
        break;

      case 'CANCELLED':
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        job.progress.stepName = 'Execution cancelled by user';
        job.telemetry = msg.telemetry || job.telemetry;

        if (this.activeJobPromiseResolvers) {
          this.activeJobPromiseResolvers.reject(new Error('JOB_CANCELLED_BY_USER'));
          this.activeJobPromiseResolvers = null;
        }
        this.activeJobId = null;
        this.processNextInQueue();
        break;

      case 'FAILED':
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        job.error = msg.error;
        job.telemetry = msg.telemetry || job.telemetry;
        job.progress.stepName = `Execution failed: ${msg.error}`;

        if (this.activeJobPromiseResolvers) {
          this.activeJobPromiseResolvers.reject(new Error(msg.error));
          this.activeJobPromiseResolvers = null;
        }
        this.activeJobId = null;
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
      nodeOutputs: {}, // nodeId -> { nodeId, viewName, rowCount, preview, isOutdated }
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
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job "${jobId}" not found`);

    if (this.activeJobId && this.activeJobId !== jobId) {
      // Concurrency management: Queue the job
      return new Promise((resolve, reject) => {
        this.jobQueue.push({ jobId, resolve, reject });
      });
    }

    return this.dispatchJobToWorker(job);
  }

  dispatchJobToWorker(job) {
    this.ensureWorker();
    this.activeJobId = job.jobId;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.error = null;

    return new Promise((resolve, reject) => {
      this.activeJobPromiseResolvers = { resolve, reject };

      this.worker.send({
        type: 'START_JOB',
        jobId: job.jobId,
        pipelineDef: job.pipelineDef,
        config: {
          dataDir: this.options.dataDir,
          maxMemory: this.options.maxMemory,
          threads: this.options.threads,
          tempDirectory: this.options.tempDir
        }
      });
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
      if (this.activeJobPromiseResolvers) {
        this.activeJobPromiseResolvers.reject(new Error('JOB_CANCELLED_BY_USER'));
        this.activeJobPromiseResolvers = null;
      }

      // Isolate and terminate current worker process:
      // Never dispatch next jobs on a worker executing a cancelled query!
      const dyingWorker = this.worker;
      this.worker = null;
      this.currentWorkerId = null;
      this.activeJobId = null;

      if (dyingWorker) {
        try {
          dyingWorker.send({ type: 'CANCEL_JOB', jobId });
          dyingWorker.kill('SIGTERM');
        } catch (e) {}

        // Hard kill fallback
        setTimeout(() => {
          try {
            dyingWorker.kill('SIGKILL');
          } catch (e) {}
        }, 300);
      }

      // Initialize a fresh, clean worker for subsequent jobs
      if (!this.isDestroyed) {
        this.initWorker();
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
    this.isDestroyed = true;

    // Settle all queued requests
    for (const q of this.jobQueue) {
      try {
        q.reject(new Error('RUNNER_SERVICE_DESTROYED'));
      } catch (e) {}
    }
    this.jobQueue = [];

    // Settle active running job
    if (this.activeJobPromiseResolvers) {
      try {
        this.activeJobPromiseResolvers.reject(new Error('RUNNER_SERVICE_DESTROYED'));
      } catch (e) {}
      this.activeJobPromiseResolvers = null;
    }
    this.activeJobId = null;

    if (this.worker) {
      try {
        this.worker.kill('SIGKILL');
      } catch (e) {}
      this.worker = null;
      this.currentWorkerId = null;
    }
  }
}
