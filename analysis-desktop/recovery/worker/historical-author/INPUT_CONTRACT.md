# SIREN Analysis Snapshot Worker Recovery — Input & Persistence Contract

**Contract Version:** `siren.analysis.execution-receipt/2`  
**Candidate Baseline Pin:** `04f2b82d0d0d4e9ecc911d46c0afd2bcc8c865c9b8d61ea4cfe159ef54d1e340` (49 files)  
**Status:** `Candidat pentru verificare independentă`  
**Notă:** Testele proprii nu constituie review independent.

---

## 1. Architectural Role & Evolution from receipt/1

The initial receipt/1 prototype ran DuckDB queries inside the parent process and maintained snapshot registries in transient memory, with simulated crashes (`simulateCrash: true`).
This architecture evolves to **receipt/2 with a dedicated child worker process and a durable persistent catalog**:

```
Live Original File
       │
       ▼ (Atomic streaming copy + SHA-256)
Owned Sealed Snapshot (storage/sealed/)
       │
       ▼ (Atomic catalog registration)
Persistent Catalog (catalog/catalog.json)
       │
       ▼ (Session-bound IPC request: jobId + attemptId + sessionToken)
Dedicated Child Process (DuckDB Worker Process)
       │
       ▼ (Bounded 50-row execution + full counts + actual worker PID)
Sealed Execution Receipt (siren.analysis.execution-receipt/2)
```

---

## 2. Dedicated Child Worker Process Protocol

### 2.1 Process Isolation
- The DuckDB native engine runs exclusively inside a dedicated child Node.js process (`src/worker_process.js`), forked with a Node IPC channel and isolated arguments (`execArgv: []`).
- The receipt records the actual owning child process PID (`workerId: worker_pid_<PID>`) and the real engine version returned by `SELECT version()`.

### 2.2 Strict Session Binding (Delayed Reply Non-Interference)
- Every execution request is stamped with a triplet: `(jobId, attemptId, sessionToken)`.
- When a reply arrives at the parent:
  - If `(msg.jobId, msg.attemptId, msg.sessionToken)` matches the currently active request, it is settled.
  - If it is from an older attempt, cancelled job, or reversed message order, the parent **discards the stale message immediately** and increments `staleRepliesDropped`.
  - A delayed response from Job A can **never** mutate the state, catalog, or receipt of Job B.

---

## 3. Real Cancellation & Crash Recovery

### 3.1 Real Cancellation
- Calling `cancelActiveQuery()` sends `CANCEL_REQUEST` over IPC.
- The child worker immediately calls `duckdbConnection.interrupt()`.
- The child settles truthfully as `CANCELLED` and releases internal resources.

### 3.2 Real Worker Crash (Not a Simulation)
- Tested via direct process termination: `SIGKILL` or `process.exit(137)`.
- The parent detects the child's `exit` event, extracts the exited PID, exit code, and signal, and marks the active attempt as `CRASHED`.
- Active snapshot leases are released immediately.
- The parent awaits process termination completely, ensuring no owned orphan processes remain.

### 3.3 Fresh Retry Protocol
- A crashed or failed job can be retried with a fresh attempt (`attemptId: attempt_2`, new `sessionToken`).
- A new dedicated child worker process is spawned if the previous died.
- The retry re-uses the **exact same reverified sealed snapshot** from the persistent catalog.
- The live original file is **never re-read or recaptured implicitly**.
- The successful retry emits a receipt with `lifecycle.retryCount: 1`.

---

## 4. Persistent Catalog & Cold Discovery

### 4.1 Atomic Durability & Monotonic Revisions
- All catalog updates are written to a temporary file (`catalog.json.<timestamp>.tmp`) and atomically renamed (`fs.renameSync`).
- Partial writes never corrupt the catalog.
- Every commit increments `catalogRevision: 1, 2, ...`.

### 4.2 Cold Discovery on Reopen
When an application restarts:
1. **Re-hashes physical snapshots:** Computes SHA-256 and byte length of all files in `storage/sealed/`. If altered or missing, flags `intact: false`.
2. **Reconciles in-flight crashes:** Any job left in `RUNNING` or `PENDING` status is reconciled to `INTERRUPTED` (never `SUCCESS`).
3. **Reconciles stale leases:** Removes any residual lease tokens belonging to dead worker PIDs.
4. **Restores receipts and captured rows:** Re-verifies every saved receipt and its bounded 50 captured rows using `ReceiptVerifier.verifyReceipt(receipt, { capturedRows, verifyDiskSnapshots: true })`.
5. **Orphan Detection:** Files in storage that lack a catalog entry (due to interrupted publication) are flagged as orphans and can be safely cleaned via `cleanupOrphans()`.

---

## 5. Scope Boundaries & Honest Protection Statement

- **Guarantees Provided:**
  - Complete isolation from external post-capture edits of original source files.
  - Process isolation: DuckDB fatal segfaults or memory corruptions crash only the child worker, leaving the parent catalog intact.
  - Full cryptographic verification of captured rows, schemas, null counts, and snapshot checksums.
  - Zero orphan processes upon shutdown.
- **Explicit Limits & Non-Guarantees:**
  - *No PKI Signatures:* Cryptographic digests are SHA-256; no digital certificate or asymmetric signature is claimed.
  - *No Hardware TPM / OS Root Immunity:* Processes with administrator privileges can alter catalog or storage files directly.
  - *Non-Atomic Original Capture:* If a live original file is mutated while the first byte is streamed, `originalModifiedDuringCapture: true` is flagged honestly.
