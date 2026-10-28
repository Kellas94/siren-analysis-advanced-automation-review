/**
 * SIREN Analysis Versioned Docs Export — Independent Saved-File Verifier
 *
 * Independently parses, inspects, and validates exported .sirendoc.json files on disk.
 * Refuses changed cells, corrupted hashes, identity drift, and invalid counts.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { DocsExportError, ErrorCodes } from './errors.js';

export function verifySavedDocsFile(filePath, expectedSpec = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'filePath must be a non-empty string');
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, `File does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, `Target is not a regular file: ${resolved}`);
  }

  const rawBytes = fs.readFileSync(resolved);
  const actualByteCount = rawBytes.length;
  const actualSha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

  // Verify byte count and hash if expected
  if (expectedSpec.expectedByteCount !== undefined && actualByteCount !== expectedSpec.expectedByteCount) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Byte count mismatch: expected ${expectedSpec.expectedByteCount}, actual ${actualByteCount}`
    );
  }

  if (expectedSpec.expectedSha256 !== undefined && actualSha256 !== expectedSpec.expectedSha256) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `SHA-256 digest mismatch: expected ${expectedSpec.expectedSha256}, actual ${actualSha256}`
    );
  }

  // Parse JSON
  let envelope;
  try {
    envelope = JSON.parse(rawBytes.toString('utf8'));
  } catch (err) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Corrupted file: invalid JSON in ${resolved}: ${err.message}`
    );
  }

  // Check Docs schema
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      !envelope.document || typeof envelope.document !== 'object' || Array.isArray(envelope.document) ||
      typeof envelope.document.id !== 'string' || !envelope.document.id || !Array.isArray(envelope.document.blocks) ||
      !envelope.workbooks || typeof envelope.workbooks !== 'object' || Array.isArray(envelope.workbooks)) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Invalid Docs document structure');
  }
  if (expectedSpec.expectedEnvelope !== undefined && !isDeepStrictEqual(envelope, JSON.parse(JSON.stringify(expectedSpec.expectedEnvelope)))) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Full expected envelope differs');
  }
  if (envelope.schemaVersion !== '1.0.0') {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Invalid schemaVersion: expected "1.0.0", got "${envelope.schemaVersion}"`
    );
  }

  if (envelope.engineName !== 'univer') {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Invalid engineName: expected "univer", got "${envelope.engineName}"`
    );
  }

  // Check metadata
  const meta = envelope.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Missing metadata in envelope');
  }
  const count = v => Number.isSafeInteger(v) && v >= 0;
  if (!['COMPLETE','SAMPLED','TRUNCATED'].includes(meta.transferStatus) || !count(meta.transferredRows) || !count(meta.totalResultRows) ||
      meta.transferredRows > meta.totalResultRows || (meta.transferStatus === 'COMPLETE' && meta.transferredRows !== meta.totalResultRows) ||
      (meta.transferStatus === 'SAMPLED' && meta.transferredRows >= meta.totalResultRows)) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Invalid transfer status or population counts');
  }
  for (const key of ['totalSourceRows','totalSourceRowsProcessed','rowsAfterFilter']) if (meta[key] !== undefined && meta[key] !== null && !count(meta[key])) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Invalid optional count '+key);
  }

  if (expectedSpec.jobId !== undefined && meta.jobId !== expectedSpec.jobId) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Metadata jobId mismatch: expected "${expectedSpec.jobId}", got "${meta.jobId}"`
    );
  }

  if (expectedSpec.nodeId !== undefined && meta.sourcePipelineNode !== expectedSpec.nodeId) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Metadata nodeId mismatch: expected "${expectedSpec.nodeId}", got "${meta.sourcePipelineNode}"`
    );
  }

  if (expectedSpec.transferStatus !== undefined && meta.transferStatus !== expectedSpec.transferStatus) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Metadata transferStatus mismatch: expected "${expectedSpec.transferStatus}", got "${meta.transferStatus}"`
    );
  }

  if (expectedSpec.transferredRows !== undefined && meta.transferredRows !== expectedSpec.transferredRows) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Metadata transferredRows mismatch: expected ${expectedSpec.transferredRows}, got ${meta.transferredRows}`
    );
  }

  if (expectedSpec.totalResultRows !== undefined && meta.totalResultRows !== expectedSpec.totalResultRows) {
    throw new DocsExportError(
      ErrorCodes.VERIFICATION_FAILED,
      `Metadata totalResultRows mismatch: expected ${expectedSpec.totalResultRows}, got ${meta.totalResultRows}`
    );
  }

  // Check workbook structure
  const workbooks = envelope.workbooks || {};
  const wbKeys = Object.keys(workbooks);
  if (wbKeys.length === 0) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Envelope contains no workbooks');
  }

  const wb = workbooks[wbKeys[0]];
  const sheetId = wb.sheetOrder?.[0];
  const sheet = wb.sheets?.[sheetId];
  if (!sheet) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Workbook contains no sheets');
  }

  const cellData = sheet.cellData || {};
  if (wb.lineage) for (const key of ['transferStatus','transferredRows','totalResultRows']) if (wb.lineage[key] !== meta[key]) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Workbook lineage conflicts with metadata: '+key);
  }

  // Check expected column headers if provided
  if (Array.isArray(expectedSpec.expectedColumns)) {
    for (let c = 0; c < expectedSpec.expectedColumns.length; c++) {
      const headerCell = cellData[0]?.[c];
      const headerVal = headerCell?.v;
      if (headerVal !== expectedSpec.expectedColumns[c]) {
        throw new DocsExportError(
          ErrorCodes.VERIFICATION_FAILED,
          `Column header mismatch at col ${c}: expected "${expectedSpec.expectedColumns[c]}", got "${headerVal}"`
        );
      }
    }
  }

  // The actual document contract inserts a one-cell notice row before data for
  // sampled/truncated transfers. Legacy fixtures without a notice remain row1.
  const notice = cellData[1]?.[0]?.v;
  const hasNotice = typeof notice === 'string' && Object.keys(cellData[1]).length === 1 &&
    ((meta.transferStatus === 'SAMPLED' && notice.startsWith('ℹ️ [SAMPLED]:')) || (meta.transferStatus === 'TRUNCATED' && notice.startsWith('⚠️ [TRUNCATED]:')));
  const dataStartRow = expectedSpec.dataStartRow ?? (hasNotice ? 2 : 1);
  if (!Number.isSafeInteger(dataStartRow) || dataStartRow < 1) {
    throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Invalid dataStartRow');
  }
  const actualRows = Object.entries(cellData).filter(([row,cells]) => /^(?:0|[1-9]\d*)$/.test(row) && Number(row) >= dataStartRow &&
    cells && typeof cells === 'object' && Object.values(cells).some(cell => cell && Object.hasOwn(cell,'v'))).length;
  if (actualRows !== meta.transferredRows) throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, 'Actual data rows conflict with transferredRows');
  // expectedRows checks an explicit value matrix/prefix of the first sheet.
  // Use expectedEnvelope for complete multi-workbook/field/lineage equality.
  if (Array.isArray(expectedSpec.expectedRows)) {
    for (let r = 0; r < expectedSpec.expectedRows.length; r++) {
      const expectedRow = expectedSpec.expectedRows[r];
      const sheetRowIdx = r + dataStartRow;

      for (let c = 0; c < expectedRow.length; c++) {
        const expectedVal = expectedRow[c];
        const cell = cellData[sheetRowIdx]?.[c];
        if (!cell || !Object.hasOwn(cell, 'v')) throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, `Missing expected cell ${r},${c}`);
        const actualVal = cell.v;
        if (cell.f) throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, `Unexpected formula at ${r},${c}`);
        const expectedType = typeof expectedVal === 'number' ? 2 : typeof expectedVal === 'boolean' ? 3 : typeof expectedVal === 'string' ? 1 : null;
        if (expectedType !== null && cell.t !== expectedType) throw new DocsExportError(ErrorCodes.VERIFICATION_FAILED, `Cell type mismatch at ${r},${c}`);

        if (expectedVal === null) {
          if (actualVal !== null) {
            throw new DocsExportError(
              ErrorCodes.VERIFICATION_FAILED,
              `Cell mismatch at row ${r}, col ${c}: expected NULL, got ${JSON.stringify(actualVal)}`
            );
          }
        } else if (expectedVal === '') {
          if (actualVal !== '') {
            throw new DocsExportError(
              ErrorCodes.VERIFICATION_FAILED,
              `Cell mismatch at row ${r}, col ${c}: expected empty string "", got ${JSON.stringify(actualVal)}`
            );
          }
        } else if (expectedVal === 0) {
          if (actualVal !== 0) {
            throw new DocsExportError(
              ErrorCodes.VERIFICATION_FAILED,
              `Cell mismatch at row ${r}, col ${c}: expected 0, got ${JSON.stringify(actualVal)}`
            );
          }
        } else if (!Object.is(actualVal, expectedVal)) {
          throw new DocsExportError(
            ErrorCodes.VERIFICATION_FAILED,
            `Cell mismatch at row ${r}, col ${c}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`
          );
        }
      }
    }
  }

  return {
    valid: true,
    verificationScope: expectedSpec.expectedEnvelope !== undefined ? 'EXACT_ENVELOPE' : expectedSpec.expectedSha256 !== undefined ? 'EXACT_BYTES_AND_STRUCTURE' : Array.isArray(expectedSpec.expectedRows) ? 'DECLARED_FIRST_SHEET_PREFIX_AND_STRUCTURE' : 'STRUCTURE_AND_METADATA',
    byteCount: actualByteCount,
    sha256: actualSha256,
    metadata: meta,
    workbookId: wb.id,
    sheetName: sheet.name,
    transferredRows: meta.transferredRows,
    totalResultRows: meta.totalResultRows
  };
}
