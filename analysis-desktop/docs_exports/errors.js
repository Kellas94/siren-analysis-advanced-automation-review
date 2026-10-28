/**
 * SIREN Analysis Versioned Docs Export — Error Types & Codes
 */

export class DocsExportError extends Error {
  constructor(code, message, detail = {}) {
    super(`[${code}] ${message}`);
    this.name = 'DocsExportError';
    this.code = code;
    this.detail = detail;
  }
}

export const ErrorCodes = Object.freeze({
  INVALID_OUTPUT_DIR: 'INVALID_OUTPUT_DIR',
  INVALID_DOCS_ENVELOPE: 'INVALID_DOCS_ENVELOPE',
  INVALID_PATH_SEGMENT: 'INVALID_PATH_SEGMENT',
  FILE_COLLISION: 'FILE_COLLISION',
  WRITE_FAILED: 'WRITE_FAILED',
  FSYNC_FAILED: 'FSYNC_FAILED',
  READBACK_FAILED: 'READBACK_FAILED',
  READBACK_BYTE_COUNT_MISMATCH: 'READBACK_BYTE_COUNT_MISMATCH',
  READBACK_HASH_MISMATCH: 'READBACK_HASH_MISMATCH',
  READBACK_PARSE_ERROR: 'READBACK_PARSE_ERROR',
  ENVELOPE_IDENTITY_CHANGED: 'ENVELOPE_IDENTITY_CHANGED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED'
});
