# SIREN Analysis Snapshot Worker Recovery — Technical Handoff

**Component:** Persistent Snapshot Catalog & Child-Worker Recovery Architecture  
**Directory:** `D:\Siren analysis snapshot worker recovery`  
**Contract Version:** `siren.analysis.execution-receipt/2`  
**Candidate Baseline Pin:** `04f2b82d0d0d4e9ecc911d46c0afd2bcc8c865c9b8d61ea4cfe159ef54d1e340` (49 files)  
**Status:** **Candidat pentru verificare independentă**  
**Independent Review Note:** Testele proprii nu constituie review independent.

---

## 1. Executive Summary

This deliverable extends the verified receipt/2 candidate by providing:
1. **Durable Persistence:** A persistent catalog of owned sealed copies and durable job/attempt records with atomic commits and monotonic revisions.
2. **Process Isolation:** Native DuckDB execution in a dedicated child Node.js process with strict `(jobId, attemptId, sessionToken)` binding.
3. **Real Crash Recovery & Non-Interference:** Violent worker process kills (`SIGKILL`) are detected, active attempts settle as `CRASHED`, and fresh retries run against the exact same reverified snapshots without re-reading live originals. Delayed responses from Job A are discarded and cannot mutate Job B.
4. **Cold Discovery & Restart:** Graceful normal quit awaits worker shutdown with zero orphan processes; restarting the application re-hashes snapshots, reconciles interrupted jobs to `INTERRUPTED` (never `SUCCESS`), clears stale leases, and re-verifies receipts + captured rows.

---

## 2. Architecture & File Structure

```
D:\Siren analysis snapshot worker recovery\
├── package.json
├── INPUT_CONTRACT.md                  # Specification of receipt/2, protocol & persistence
├── STATUS.md                          # Delivery status (Candidat pentru verificare independentă)
├── HANDOFF.md                         # Technical handoff & reproduction commands
├── src\
│   ├── index.js                       # Barrel export
│   ├── baseline_pin.js                # Cryptographic check of 49-file candidate roster SHA
│   ├── worker_protocol.js             # IPC message definitions & session validation
│   ├── worker_process.js              # Dedicated child worker process executing DuckDB
│   ├── worker_client.js               # Parent worker client (fork, IPC dispatch, kill, shutdown)
│   ├── persistent_catalog.js          # Persistent catalog, atomic revisions, cold recovery
│   └── recovery_orchestrator.js       # Top-level orchestrator coordinating snapshots, catalog & worker
├── tests\
│   ├── test_baseline_pin.mjs          # Suite 0: Pin check of candidate (49 files, SHA 04f2...)
│   ├── test_persistent_catalog.mjs    # Suite 1: Durable catalog atomic writes & monotonic revisions
│   ├── test_worker_ipc_isolation.mjs  # Suite 2: Child process execution, PID, delayed A reply rejection
│   ├── test_real_crash_and_retry.mjs  # Suite 3: Real SIGKILL worker crash, detection & fresh retry
│   ├── test_cancellation_shutdown.mjs # Suite 4: Query interrupt & graceful shutdown without orphans
│   ├── test_quit_restart_recovery.mjs # Suite 5: Save → Quit → Reopen, cold recovery, stale lease cleanup
│   ├── test_negative_rejection.mjs    # Suite 6: Adverse gates (corrupt copy, corrupt catalog, NaN rows, orphans)
│   └── run_all_tests.mjs              # Master test runner (exit code 1 on failure)
├── reports\
│   ├── MANIFEST.json                  # Canonical SHA-256 manifest of all deliverables
│   ├── VERIFICATION_REPORT.json       # Master verification run output (77 tests passed)
│   └── NEGATIVE_CONTROLS_REPORT.json  # Adverse control gates output
└── scripts\
    └── generate_manifest.mjs          # Manifest generator
```

---

## 3. Verified Behaviors & Proven Invariants

### 3.1 Dedicated Child Worker & Runtime Version Attribution
- DuckDB executes exclusively in a separate child process (`child PID !== parent PID`).
- The receipt records the actual owning worker PID (`workerId: worker_pid_<PID>`) and the real engine version returned by DuckDB.
- Query results are bounded to at most 50 captured rows with full population counts (`outputRowCount`, `nullCounts`).

### 3.2 Stale / Delayed Reply Non-Interference
- Every request binds `(jobId, attemptId, sessionToken)`.
- When an attempt from Job A is cancelled or completed and Job B starts, a delayed IPC message arriving from Job A is identified as a session mismatch and discarded.
- Delayed A cannot mutate Job B's result, catalog record, or revision.

### 3.3 Real Worker Process Kill & Fresh Retry
- Tested via real `SIGKILL` process termination (not a simulated boolean).
- The parent detects the child's `exit` event, records the exited PID, exit code, and signal, and marks attempt 1 as `CRASHED`.
- Leases on snapshots are released.
- The retry launches attempt 2 with a new worker process against the **exact same reverified snapshot** without re-reading the live original file.
- The retry succeeds with `status: 'SUCCESS'` and `retryCount: 1`.

### 3.4 Cold Recovery on Normal Quit & Restart
- Normal quit cleanly terminates the child worker process (`process.kill(pid, 0)` confirms no orphan process remains).
- On application restart:
  - Catalog rediscovers all snapshots in `storage/sealed/` and re-computes their SHA-256 and byte counts.
  - Incomplete jobs left in `RUNNING` or `PENDING` state become `INTERRUPTED` (never `SUCCESS`).
  - Stale leases belonging to dead worker sessions are cleared.
  - Saved receipts and captured rows are re-verified with `ReceiptVerifier`.

### 3.5 Negative Controls & Adverse Rejection Gates
- **Corrupted Snapshot File:** Flagged by catalog recovery as `intact: false` with `INTEGRITY_MISMATCH`.
- **Corrupted catalog.json:** Throws `CATALOG_CORRUPT` on parse failure.
- **Unregistered Complete Copies (Orphans):** Detected during cold discovery and safely unlinked via `cleanupOrphans()` without touching registered snapshots.
- **Tampered Receipt Metrics:** Rejected by `ReceiptVerifier` (`RECEIPT_COVERAGE` or `RECEIPT_DIGEST_MISMATCH`).
- **Non-Lossless JSON in Captured Rows:** Rows containing `NaN` or non-lossless structures are strictly rejected with `RECEIPT_CAPTURED_VALUE`.
- **No-Op Child Receipts:** Receipts declaring `SUCCESS` with empty inputs or missing compiled SQL are strictly rejected with `RECEIPT_CHILD_NOOP`.

---

## 4. Test Summary (77 / 77 Passed)

| Suite | File | Tests | Passed | Failed | Duration |
|:---|:---|:---:|:---:|:---:|:---:|
| 0. Baseline Candidate Pin Verification | [`test_baseline_pin.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_baseline_pin.mjs) | 3 | 3 | 0 | 12ms |
| 1. Persistent Catalog & Monotonic Revisions | [`test_persistent_catalog.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_persistent_catalog.mjs) | 13 | 13 | 0 | 25ms |
| 2. Child Worker IPC & Stale Reply Isolation | [`test_worker_ipc_isolation.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_worker_ipc_isolation.mjs) | 15 | 15 | 0 | 95ms |
| 3. Real Worker Crash & Fresh Retry | [`test_real_crash_and_retry.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_real_crash_and_retry.mjs) | 16 | 16 | 0 | 110ms |
| 4. Cancellation & Shutdown Without Orphans | [`test_cancellation_shutdown.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_cancellation_shutdown.mjs) | 6 | 6 | 0 | 45ms |
| 5. Quit, Restart & Cold Recovery | [`test_quit_restart_recovery.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_quit_restart_recovery.mjs) | 13 | 13 | 0 | 85ms |
| 6. Negative Rejection Controls & Adverse Gates | [`test_negative_rejection.mjs`](file:///D:/Siren%20analysis%20snapshot%20worker%20recovery/tests/test_negative_rejection.mjs) | 11 | 11 | 0 | 180ms |
| **Total** | **All 7 Suites** | **77** | **77** | **0** | **552ms** |

---

## 5. Reproducible Execution Commands

```powershell
# 1. Run Baseline Candidate Pin Verification
node "D:\Siren analysis snapshot worker recovery\tests\test_baseline_pin.mjs"

# 2. Run Persistent Catalog & Revisions test
node "D:\Siren analysis snapshot worker recovery\tests\test_persistent_catalog.mjs"

# 3. Run Child Worker IPC & Stale Reply Isolation test
node "D:\Siren analysis snapshot worker recovery\tests\test_worker_ipc_isolation.mjs"

# 4. Run Real Worker Crash & Fresh Retry test
node "D:\Siren analysis snapshot worker recovery\tests\test_real_crash_and_retry.mjs"

# 5. Run Cancellation & Shutdown test
node "D:\Siren analysis snapshot worker recovery\tests\test_cancellation_shutdown.mjs"

# 6. Run Quit, Restart & Cold Recovery test
node "D:\Siren analysis snapshot worker recovery\tests\test_quit_restart_recovery.mjs"

# 7. Run Negative Rejection Controls test
node "D:\Siren analysis snapshot worker recovery\tests\test_negative_rejection.mjs"

# 8. Run Master Test Runner (all 7 suites)
node "D:\Siren analysis snapshot worker recovery\tests\run_all_tests.mjs"

# 9. Re-generate SHA-256 Manifest
node "D:\Siren analysis snapshot worker recovery\scripts\generate_manifest.mjs"
```

---

## 6. Canonical Deliverables & Manifest Table (`reports/MANIFEST.json`)

| Path | Size (bytes) | SHA-256 Checksum |
|:---|:---:|:---|
| `INPUT_CONTRACT.md` | 5,368 | `baee0e03706ecbaf85724d93aa0565bfccc92e97fbb0edc0e908386ca1b84e0a` |
| `package.json` | 560 | `4316e781366688080adccae396d8feebc57a3a4e1e57a2ab2fe437af24723a4d` |
| `reports/NEGATIVE_CONTROLS_REPORT.json` | 1,550 | `727e0ac7b90f26194c82bbaef3af3deec1ecfccfd6ff38f8fd893639a39aab60` |
| `reports/VERIFICATION_REPORT.json` | 10,225 | `63955710b0c3f6de4dd91bf8804a088d3ff84493a3ffe17e1adb696e87d14d16` |
| `scripts/generate_manifest.mjs` | 2,649 | `9e35cfea17c8118313befc35cec8fb6a696300899020829fed90705b402b9c9e` |
| `src/baseline_pin.js` | 2,696 | `15ac81555fb44bbd6c8d4e72be11a9b37f1feff30bfe8e56cb1510dfd0820d09` |
| `src/index.js` | 265 | `65c915d853ed9fec76f2281b58e3ff3e5ab781a2059eef7499a873364627f6c2` |
| `src/persistent_catalog.js` | 12,584 | `1a1e9af35c00ebccc0a705d81e9322a87f4678ff384d7476080657fa7f1de419` |
| `src/recovery_orchestrator.js` | 5,816 | `600f4666896de2460848c8e8d680efcbc442c2dc0b743a0428d26d85635648f2` |
| `src/worker_client.js` | 7,022 | `fb69bb90e86f1589d6ad2b725c2824a38f407404fd5f5701d46450972941fae3` |
| `src/worker_process.js` | 8,241 | `3f68d40113b980d1b09e12f4c62c68ea4c40704c01e1aa3fe9ec2bac6ab1d871` |
| `src/worker_protocol.js` | 1,323 | `e27118d800f28b81476f7a921eab1e5eb3b3ec42011a2b8be12fa05e25587071` |
| `STATUS.md` | 4,555 | `c94cc156616c414d444f9e1edd7ec917d64ff5141acecab4cb6f46f984e43033` |
| `tests/run_all_tests.mjs` | 5,436 | `5a39b3ce062ec5b667efd83ecc75f16eee4eecc8ae51ae6f0c85175243ef268a` |
| `tests/test_baseline_pin.mjs` | 1,759 | `f3f1e666edc741e08edde8287c7d78b4df7f4c7e21e42efebc903c6a7c8ffe8e` |
| `tests/test_cancellation_shutdown.mjs` | 4,215 | `8341cc777198ff51b533bdb34dcb279bc55666fc55620c63cf3e5c16d3838e39` |
| `tests/test_negative_rejection.mjs` | 8,725 | `307d933d7b29d450cffdc3776c72c8e11eaf053a30b9c4b17bd0f14dd399fb76` |
| `tests/test_persistent_catalog.mjs` | 5,009 | `52dc08974d12af1a1a0c134224eb2879cab65882bcf82b720cc16729b1fc8ff7` |
| `tests/test_quit_restart_recovery.mjs` | 5,733 | `65397aba0f7c397b5dd3a7a7d18521f019c1833280e912096daf96adbcb94590` |
| `tests/test_real_crash_and_retry.mjs` | 5,685 | `6958bbdb23ffcf5fe47145c542590b17784cc842490796b11184a311a5652c76` |
| `tests/test_worker_ipc_isolation.mjs` | 6,211 | `0d9ba77b783c87ba667bb59eaed3f5ab72903d4792d5eff1923cf90e445ba83c` |
| `HANDOFF.md` | (dynamic) | Sealed in `reports/MANIFEST.json` upon generation |

Total: 22 canonical files, 0 runtime dependencies, pure ECMAScript ES2022.
