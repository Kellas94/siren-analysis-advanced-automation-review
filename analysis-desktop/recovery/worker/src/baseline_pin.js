/**
 * Baseline Candidate Pin & Verification Module
 *
 * Verifies that the consumed receipt/2 candidate in:
 *   C:\Claude\SIREN_WORK\docs-analysis-review-and-composition\input-snapshots-review-v1\candidate
 * matches the exact 49-file roster SHA:
 *   04f2b82d0d0d4e9ecc911d46c0afd2bcc8c865c9b8d61ea4cfe159ef54d1e340
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PINNED_CANDIDATE_ROOT = 'C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1/candidate';
export const PINNED_REVIEW_ROOT = 'C:/Claude/SIREN_WORK/docs-analysis-review-and-composition/input-snapshots-review-v1';
export const PINNED_MANIFEST_SHA256 = '04f2b82d0d0d4e9ecc911d46c0afd2bcc8c865c9b8d61ea4cfe159ef54d1e340';
export const PINNED_FILE_COUNT = 49;

export function verifyCandidatePin() {
  const summaryPath = path.join(PINNED_REVIEW_ROOT, 'evidence/identity-final-v2/summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`BASELINE_PIN_FAILED: summary.json not found at ${summaryPath}`);
  }

  const candidateFilesPath = path.join(PINNED_REVIEW_ROOT, 'evidence/identity-final-v2/candidate-files.json');
  if (!fs.existsSync(candidateFilesPath)) {
    throw new Error(`BASELINE_PIN_FAILED: candidate-files.json not found at ${candidateFilesPath}`);
  }

  const manifestBuf = fs.readFileSync(candidateFilesPath);
  const actualManifestSha = crypto.createHash('sha256').update(manifestBuf).digest('hex');

  if (actualManifestSha !== PINNED_MANIFEST_SHA256) {
    throw new Error(
      `BASELINE_PIN_MISMATCH: Manifest SHA mismatch! Expected ${PINNED_MANIFEST_SHA256}, got ${actualManifestSha}`
    );
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  if (summary.files !== PINNED_FILE_COUNT) {
    throw new Error(
      `BASELINE_PIN_MISMATCH: File count mismatch! Expected ${PINNED_FILE_COUNT}, got ${summary.files}`
    );
  }

  const rows=JSON.parse(manifestBuf);if(!Array.isArray(rows)||rows.length!==PINNED_FILE_COUNT)throw Error('BASELINE_PIN_COUNT');
  const expected=new Set();for(const row of rows){const full=path.resolve(PINNED_CANDIDATE_ROOT,row.path);if(!full.startsWith(path.resolve(PINNED_CANDIDATE_ROOT)+path.sep)||expected.has(row.path))throw Error('BASELINE_PIN_PATH');expected.add(row.path);const stat=fs.lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.bytes||crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')!==row.sha256)throw Error('BASELINE_PIN_FILE');}
  const actual=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('BASELINE_PIN_LINK');if(entry.isDirectory())walk(full);else if(entry.isFile())actual.push(path.relative(PINNED_CANDIDATE_ROOT,full).replaceAll('\\','/'));}}
  walk(PINNED_CANDIDATE_ROOT);if(actual.length!==expected.size||actual.some(p=>!expected.has(p)))throw Error('BASELINE_PIN_FILE_SET');

  return {
    verified: true,
    candidateRoot: PINNED_CANDIDATE_ROOT,
    fileCount: summary.files,
    manifestSha256: actualManifestSha
  };
}
