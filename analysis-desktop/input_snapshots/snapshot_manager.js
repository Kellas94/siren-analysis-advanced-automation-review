/**
 * SIREN Analysis Input Snapshots — Snapshot Manager
 *
 * Responsibilities:
 *   1. Atomic streaming copy of source files into owned storage directory while computing SHA-256.
 *   2. Strict publication: in-progress copies remain in staging (.part); only completed, verified copies are sealed and published.
 *   3. Distinct identity preservation: original path, snapshot ID, sealed path, content SHA-256, byte count, capture timestamps.
 *   4. Honest before/after stat recording: detects and flags if original was modified during copy.
 *   5. Lease management: tracks which active jobs are using a snapshot; prevents deletion while leased.
 *   6. Boundary integrity verification: verifies snapshot existence, byte count, and SHA-256 before use.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { SnapshotError, ErrorCodes } from './errors.js';

/**
 * Computes SHA-256 hash and byte length of a file via streaming.
 * @param {string} filePath
 * @returns {Promise<{ sha256: string, byteCount: number }>}
 */
export async function computeFileSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new SnapshotError(ErrorCodes.SNAPSHOT_NOT_FOUND, `File does not exist: ${filePath}`, { filePath });
  }

  const hash = crypto.createHash('sha256');
  let byteCount = 0;

  const countStream = new Transform({
    transform(chunk, encoding, callback) {
      byteCount += chunk.length;
      callback(null, chunk);
    }
  });

  const readStream = fs.createReadStream(filePath);
  await pipeline(readStream, countStream, hash);

  return {
    sha256: hash.digest('hex'),
    byteCount
  };
}

export class SnapshotManager {
  /**
   * @param {Object} options
   * @param {string} options.baseDir - Base owned directory for snapshots and staging
   */
  constructor(options = {}) {
    if(typeof options.baseDir!=='string'||!path.isAbsolute(options.baseDir))throw Error('EXPLICIT_ABSOLUTE_SNAPSHOT_BASE_REQUIRED');
    this.baseDir = path.resolve(options.baseDir);
    this.storageDir = path.join(this.baseDir, 'sealed');
    this.stagingDir = path.join(this.baseDir, 'staging');

    this.snapshots = new Map(); // snapshotId -> metadata object
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
  }

  /**
   * Generates a unique, non-colliding snapshot ID.
   * Format: snap_<timestamp>_<randomHex>
   */
  generateSnapshotId() {
    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(6).toString('hex');
    return `snap_${timestamp}_${randomHex}`;
  }

  /**
   * Captures an input snapshot from an original file.
   *
   * @param {string} originalFilePath - Path to the original file to snapshot
   * @param {Object} [options]
   * @param {string} [options.nodeId] - Associated node ID in pipeline
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   * @returns {Promise<Object>} Sealed snapshot metadata
   */
  async captureSnapshot(originalFilePath, options = {}) {
    const resolvedOriginalPath = path.resolve(originalFilePath);

    if (!fs.existsSync(resolvedOriginalPath)) {
      throw new SnapshotError(
        ErrorCodes.ORIGINAL_FILE_NOT_FOUND,
        `Original source file does not exist: ${resolvedOriginalPath}`,
        { originalPath: resolvedOriginalPath }
      );
    }

    let beforeStat;
    try {
      beforeStat = fs.statSync(resolvedOriginalPath);
    } catch (err) {
      throw new SnapshotError(
        ErrorCodes.ORIGINAL_FILE_UNREADABLE,
        `Cannot stat original source file: ${err.message}`,
        { originalPath: resolvedOriginalPath, error: err.message }
      );
    }

    const originalBeforeStat = {
      size: beforeStat.size,
      mtimeMs: beforeStat.mtimeMs,
      ctimeMs: beforeStat.ctimeMs
    };

    const snapshotId = this.generateSnapshotId();
    const ext = path.extname(resolvedOriginalPath) || '.bin';
    const stagingPath = path.join(this.stagingDir, `${snapshotId}.part`);
    const sealedPath = path.join(this.storageDir, `${snapshotId}${ext}`);
    let ownsStaging=false;const cleanup=()=>{if(ownsStaging)this.cleanupStagingFile(stagingPath);};

    let byteCount = 0;
    const hash = crypto.createHash('sha256');

    const countStream = new Transform({
      transform(chunk, encoding, callback) {
        byteCount += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      }
    });

    // Check pre-aborted
    if (options.signal?.aborted) {
      cleanup();
      throw new SnapshotError(ErrorCodes.COPY_CANCELLED, 'Snapshot capture was cancelled before starting', {
        originalPath: resolvedOriginalPath,
        snapshotId
      });
    }

    const readStream = fs.createReadStream(resolvedOriginalPath);
    const writeStream = fs.createWriteStream(stagingPath,{flags:'wx'});
    writeStream.once('open',()=>{ownsStaging=true;});

    let isAborted = false;
    const abortHandler = () => {
      isAborted = true;
      readStream.destroy();
      writeStream.destroy();
      cleanup();
    };

    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      await pipeline(readStream, countStream, writeStream);
    } catch (err) {
      cleanup();
      if (isAborted || options.signal?.aborted) {
        throw new SnapshotError(ErrorCodes.COPY_CANCELLED, 'Snapshot capture copy was cancelled during streaming', {
          originalPath: resolvedOriginalPath,
          snapshotId
        });
      }
      throw new SnapshotError(ErrorCodes.COPY_FAILED, `Failed to stream snapshot copy: ${err.message}`, {
        originalPath: resolvedOriginalPath,
        snapshotId,
        error: err.message
      });
    } finally {
      if (options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }

    // Inspect post-copy metadata of original file
    let afterStat;
    try {
      afterStat = fs.statSync(resolvedOriginalPath);
    } catch (err) {
      afterStat = null;
    }

    const originalAfterStat = afterStat
      ? {
          size: afterStat.size,
          mtimeMs: afterStat.mtimeMs,
          ctimeMs: afterStat.ctimeMs
        }
      : null;

    const originalModifiedDuringCapture =
      !afterStat ||
      originalBeforeStat.mtimeMs !== originalAfterStat.mtimeMs ||
      originalBeforeStat.size !== originalAfterStat.size;

    const contentSha256 = hash.digest('hex');

    // Atomic publication: Rename staging file (.part) to final sealed path (.snap/.parquet/.csv)
    try {
      fs.linkSync(stagingPath, sealedPath);
      fs.unlinkSync(stagingPath);
    } catch (err) {
      cleanup();
      throw new SnapshotError(
        ErrorCodes.COPY_FAILED,
        `Failed to atomically publish snapshot to sealed path: ${err.message}`,
        { stagingPath, sealedPath, error: err.message }
      );
    }

    const format = ext.replace('.', '').toLowerCase();

    Object.freeze(originalBeforeStat);if(originalAfterStat)Object.freeze(originalAfterStat);
    const snapshotRecord = Object.freeze({
      snapshotId,
      snapshotPath: sealedPath,
      originalPath: resolvedOriginalPath,
      nodeId: options.nodeId || null,
      format,
      contentSha256,
      byteCount,
      capturedAt: new Date().toISOString(),
      originalBeforeStat,
      originalAfterStat,
      originalModifiedDuringCapture,
      status: 'SEALED',
      leases: new Set()
    });

    this.snapshots.set(snapshotId, snapshotRecord);
    return snapshotRecord;
  }

  cleanupStagingFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      // Best-effort cleanup
    }
  }

  /**
   * Retrieves snapshot record by ID.
   * @param {string} snapshotId
   * @returns {Object}
   */
  getSnapshot(snapshotId) {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) {
      throw new SnapshotError(ErrorCodes.SNAPSHOT_NOT_FOUND, `Snapshot ID "${snapshotId}" not found in registry`, {
        snapshotId
      });
    }
    return snap;
  }

  /**
   * Verifies snapshot integrity on disk before execution or retrieval.
   * Checks file existence, byte length, and SHA-256.
   *
   * @param {string|Object} snapshotRef - snapshotId or snapshotRecord
   * @returns {Promise<{ valid: boolean, snapshotId: string, byteCount: number, sha256: string }>}
   */
  async verifySnapshotIntegrity(snapshotRef) {
    const record = typeof snapshotRef === 'string' ? this.getSnapshot(snapshotRef) : snapshotRef;

    if (!fs.existsSync(record.snapshotPath)) {
      throw new SnapshotError(
        ErrorCodes.SNAPSHOT_NOT_FOUND,
        `Sealed snapshot file is missing from disk: ${record.snapshotPath}`,
        { snapshotId: record.snapshotId, snapshotPath: record.snapshotPath }
      );
    }

    const diskStat = fs.statSync(record.snapshotPath);
    if (diskStat.size !== record.byteCount) {
      throw new SnapshotError(
        ErrorCodes.SNAPSHOT_TRUNCATED,
        `Snapshot file size mismatch on disk. Expected ${record.byteCount} bytes, found ${diskStat.size} bytes.`,
        { snapshotId: record.snapshotId, expected: record.byteCount, actual: diskStat.size }
      );
    }

    const { sha256 } = await computeFileSha256(record.snapshotPath);
    if (sha256 !== record.contentSha256) {
      throw new SnapshotError(
        ErrorCodes.SNAPSHOT_CORRUPTED,
        `Snapshot SHA-256 digest mismatch. File on disk has been corrupted or modified. Expected ${record.contentSha256}, got ${sha256}.`,
        { snapshotId: record.snapshotId, expected: record.contentSha256, actual: sha256 }
      );
    }

    return {
      valid: true,
      snapshotId: record.snapshotId,
      snapshotPath: record.snapshotPath,
      byteCount: record.byteCount,
      sha256
    };
  }

  /**
   * Acquires a lease on a snapshot for an active job.
   * @param {string} snapshotId
   * @param {string} jobId
   */
  acquireLease(snapshotId, jobId) {
    const record = this.getSnapshot(snapshotId);
    record.leases.add(jobId);
  }

  /**
   * Releases a lease on a snapshot for an active job.
   * @param {string} snapshotId
   * @param {string} jobId
   */
  releaseLease(snapshotId, jobId) {
    const record = this.getSnapshot(snapshotId);
    record.leases.delete(jobId);
  }

  /**
   * Checks if a snapshot currently has active job leases.
   * @param {string} snapshotId
   * @returns {boolean}
   */
  isLeased(snapshotId) {
    const record = this.getSnapshot(snapshotId);
    return record.leases.size > 0;
  }

  /**
   * Prunes a single snapshot if not actively leased.
   * @param {string} snapshotId
   */
  pruneSnapshot(snapshotId) {
    const record = this.getSnapshot(snapshotId);
    if (record.leases.size > 0) {
      throw new SnapshotError(
        ErrorCodes.SNAPSHOT_LEASE_ACTIVE,
        `Cannot prune snapshot "${snapshotId}" because it is actively leased by job(s): ${Array.from(record.leases).join(', ')}`,
        { snapshotId, activeLeases: Array.from(record.leases) }
      );
    }

    if (fs.existsSync(record.snapshotPath)) {
      fs.unlinkSync(record.snapshotPath);
    }
    this.snapshots.delete(snapshotId);
  }

  /**
   * Cleans any orphaned temporary files in the staging directory.
   */
  cleanupStaging() {
    if (!fs.existsSync(this.stagingDir)) return;
    const entries = fs.readdirSync(this.stagingDir);
    for (const entry of entries) {
      const fullPath = path.join(this.stagingDir, entry);
      try {
        fs.unlinkSync(fullPath);
      } catch (e) {}
    }
  }

  /**
   * Cleans all unleased snapshots and staging files.
   */
  cleanupAll() {
    this.cleanupStaging();
    for (const [snapshotId, record] of this.snapshots.entries()) {
      if (record.leases.size === 0) {
        if (fs.existsSync(record.snapshotPath)) {
          try {
            fs.unlinkSync(record.snapshotPath);
          } catch (e) {}
        }
        this.snapshots.delete(snapshotId);
      }
    }
  }
}
