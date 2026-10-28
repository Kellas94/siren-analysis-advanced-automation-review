/**
 * Test Suite 0: Baseline Candidate Pin Verification
 *
 * Confirms that the candidate in C:\Claude\SIREN_WORK\docs-analysis-review-and-composition\input-snapshots-review-v1\candidate
 * matches the exact 49-file roster SHA 04f2b82d0d0d4e9ecc911d46c0afd2bcc8c865c9b8d61ea4cfe159ef54d1e340.
 */

import { fileURLToPath } from 'node:url';
import { verifyCandidatePin, PINNED_MANIFEST_SHA256, PINNED_FILE_COUNT } from '../src/baseline_pin.js';

export async function runBaselinePinTests() {
  console.log('\n=== SUITE 0: BASELINE CANDIDATE PIN VERIFICATION ===\n');

  let passCount = 0;
  let failCount = 0;
  const testResults = [];

  function assert(name, condition, extra = '') {
    if (condition) {
      passCount++;
      testResults.push({ name, status: 'PASS' });
      console.log(`  [PASS] ${name}`);
    } else {
      failCount++;
      testResults.push({ name, status: 'FAIL', extra });
      console.error(`  [FAIL] ${name} ${extra}`);
    }
  }

  try {
    const pinResult = verifyCandidatePin();
    assert('verifyCandidatePin executes without error', pinResult.verified === true);
    assert(`Candidate file count matches ${PINNED_FILE_COUNT}`, pinResult.fileCount === PINNED_FILE_COUNT);
    assert(`Candidate manifest SHA-256 matches ${PINNED_MANIFEST_SHA256}`, pinResult.manifestSha256 === PINNED_MANIFEST_SHA256);
  } catch (err) {
    assert('verifyCandidatePin executed cleanly', false, err.message);
  }

  console.log(`\nBaseline Pin Tests Finished: ${passCount} passed, ${failCount} failed.`);
  return { suite: 'Baseline Candidate Pin', passCount, failCount, testResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBaselinePinTests().then((res) => {
    if (res.failCount > 0) process.exit(1);
  });
}
