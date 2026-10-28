/**
 * SIREN Analysis -> Charts Adapter: Identity & Versioning Helper
 *
 * Establishes immutable cryptographic identity for snapshots.
 * Binds sourceId, jobId, capturedAt, state, and resultVersion.
 * If the engine does not provide a physical revision, computes a deterministic content SHA-256.
 */

import crypto from 'node:crypto';

/**
 * Deterministically serializes a value to canonical JSON.
 * Sorts object keys recursively to ensure consistent hashing.
 */
export function canonicalJson(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalJson).join(',') + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/**
 * Computes SHA-256 hash of a value using canonical JSON serialization.
 */
export function computeContentHash(data) {
  const canonical = canonicalJson(data);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Constructs the source metadata object according to siren.chart-data/1.
 *
 * @param {Object} inputSource
 *   - sourceId: string
 *   - jobId: string
 *   - resultVersion?: string
 *   - capturedAt?: string
 *   - state?: 'current' | 'outdated' | 'missing' | 'unknown'
 * @param {*} contentPayload - Data used to compute content hash if resultVersion is missing
 * @returns {Object} Validated source object
 */
export function buildSourceIdentity(inputSource = {}, contentPayload = null) {
  if (typeof (inputSource.sourceId ?? inputSource.nodeId) !== 'string' || typeof inputSource.jobId !== 'string') throw new Error('IDENTITY_ERROR: Source and job identities must be strings.');
  if (inputSource.resultVersion !== undefined && (typeof inputSource.resultVersion !== 'string' || !inputSource.resultVersion.trim())) throw new Error('IDENTITY_ERROR: Explicit resultVersion must be a nonempty string.');
  const sourceId = String(inputSource.sourceId || inputSource.nodeId || '').trim();
  const jobId = String(inputSource.jobId || '').trim();

  if (!sourceId) {
    throw new Error('IDENTITY_ERROR: sourceId/nodeId is required and cannot be empty.');
  }
  if (!jobId) {
    throw new Error('IDENTITY_ERROR: jobId is required and cannot be empty.');
  }

  let resultVersion = inputSource.resultVersion;
  if (!resultVersion || typeof resultVersion !== 'string' || !resultVersion.trim()) {
    // Generate deterministic content hash labeled explicitly as content-sha256
    const hash = computeContentHash(contentPayload || { sourceId, jobId });
    resultVersion = `content-sha256:${hash}`;
  }

  if (inputSource.capturedAt !== undefined && (typeof inputSource.capturedAt !== 'string' || !Number.isFinite(Date.parse(inputSource.capturedAt)))) throw new Error('IDENTITY_TIME: Invalid capture timestamp.');
  const capturedAt = inputSource.capturedAt && Number.isFinite(Date.parse(inputSource.capturedAt))
    ? new Date(inputSource.capturedAt).toISOString()
    : new Date().toISOString();

  const validStates = new Set(['current', 'outdated', 'missing', 'unknown']);
  if (inputSource.state !== undefined && !validStates.has(inputSource.state)) throw new Error('IDENTITY_STATE: Invalid capture state.');
  const state = inputSource.state || 'unknown';

  return {
    sourceId,
    jobId,
    resultVersion,
    capturedAt,
    state
  };
}

/**
 * Generates an immutable snapshot ID.
 *
 * @param {string} sourceId
 * @param {string} jobId
 * @param {string} resultVersion
 * @returns {string} Unique snapshot ID
 */
export function generateSnapshotId(sourceId, jobId, resultVersion) {
  const hash = crypto
    .createHash('sha256')
    .update(`${sourceId}:${jobId}:${resultVersion}:${Date.now()}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  const cleanSource = sourceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const cleanJob = jobId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return `snap_${cleanSource}_${cleanJob}_${hash}`;
}
