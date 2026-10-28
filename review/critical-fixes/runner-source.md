# Independent runner and exact-source-resolution gate

**Accepted in the bounded source/model scope below**, on the exact two changed files. No current product defect was reproduced in this scope after the starter-path composition adjustment. This is not native worker/SQL/OS-closure or whole-candidate acceptance. My own desktop save correction is excluded from independent acceptance here; another reviewer owns that gate.

| Reviewed source | Bytes | SHA256 |
|---|---:|---|
| candidate/analysis-desktop/server/runner_service.js |15762|`5a1c7f01906972640fe06324f5868e206024de776c38921c749dcda8224f6160`|
| candidate/analysis-desktop/engine/pipeline_compiler.js |18154|`04e217923c12555542e09450eb4210ea1f618c973a198ea1af8876da40692439`|

Both hashes were asserted before and after the independent run. I inspected current full source, baseline copies, diff, author `probe.mjs`, freeze rows and both baseline/candidate author result rosters before writing the new probe. The author23 passing groups are context, not independent proof. Their baseline-v2 has4 passing/17 failing records and current author-candidate-v2 has23 passing/0 failing; those populations are kept separate from this review.

Only new `review/runner-source/` files were written for this review. No runner/compiler/product, QA tests, original, Terminal, migration, UI Builder, shared source or GitHub edits were made. No child, app, native analytical runtime, SQL, dependency install or process census was launched. Actual compiler imports resolve only its current unchanged pure helper dependencies; tiny path fixtures are owned by this review.

## Mode and independent cases

`independent-v2.mjs` completed **twelve bounded groups and five rejected source mutants** with no current findings. Runner source is evaluated whole in a VM after replacing only its module/bootstrap bindings with deterministic built-in/transport doubles. Fork returns an EventEmitter fake child; timers are manually triggered objects, never native timers. Promise reactions are drained deterministically. The actual compiler text is imported with relative module URLs rebound to current pure helpers; its generated SQL is inspected, never executed.

### ENGINE-001: request ownership and failure settlement

The current source binds each active resolver to jobId and worker generation, clears resolver/active ownership before invoking continuations, and admits worker messages only for the current running job/request/generation. Idle failures retire the generation without an unconditional respawn loop. Send throw/callback failure and close/disconnect routes enter the same owned failure path. A synchronous replacement-fork failure rejects that scheduled owner and allows later queue progress instead of losing it.

Independent adverse controls cover:

- Four fresh cohorts whose **first** terminal event is error, exit, close-only or disconnect. Each starts A active plus B/C queued. A rejects/marks failed, B starts on a fresh generation, and old error/exit/close/disconnect plus old STEP_RESULT/COMPLETED cannot settle or contaminate B. B then completes and C starts; late FAILED for completed B cannot fail C. Instrumented A/B resolver calls are exactly one rejection/one resolution respectively, not merely a Promise callback count that JavaScript would force to one. A/B/C observed outcomes remain distinct.
- Idle error causes no repeated automatic fork; the next explicit run retries. Ordinary engine FAILED rejects its owner, followed by a successful new job in the model.
- Immediate send-callback error and synchronous send throw reject the admitted job. A stale send-error callback for a completed request does not fail a later request on the same worker.
- Replacement fork failure while processing the queue rejects its owner and does not lose the next queued job.
- Queued cancel rejects the queued caller, active cancel rejects its own caller and starts the remaining queued job on another generation. The manually fired fallback targets the retired fake child, never the replacement. Destroy rejects active and queued callers; repeated destroy does not create new work; later run requests refuse RUNNER_SERVICE_DESTROYED; late fake completion cannot change the already rejected caller.

These models establish the named synchronous state/Promise transitions on the exact source. Fake kill calls are **requests, not actual OS closure**. `destroy()` itself does not return a per-child close receipt; native current/retired-worker closure and the unchanged desktop coordinator's actual integration remain Root's separate gate. This review supplies no global orphan/process-absence claim.

### ENGINE-002: own-key-safe outputs

Current jobs initialize `nodeOutputs` with `Object.create(null)`. Independent STEP_RESULT controls use `__proto__`, `constructor`, `toString`, `Ω` and `é` as admitted node IDs, complete the job, serialize/parse the actual job and retrieve each bounded preview. All IDs remain own keys with the intended values. The output object has null prototype before serialization. This accepts preserving the existing admitted ID domain; it does not reject formerly valid names or rename them.

The reader does not generalize that to every downstream object operation or claim a complete prototype-pollution/security audit. It verifies the changed storage/wire/preview boundary and its source callers.

### Producer export receipt retention

The independent control sends a deliberately controlled proof object through a non-export input STEP_RESULT, an export STEP_RESULT and an export STEP_RESULT with no proof. Only the export with a supplied proof retains it. Nested later mutation of the input proof does not alter the stored proof, demonstrating actual deep detachment. An absent receipt is not synthesized; no later destination file is read or hashed by this retention code.

This retention layer trusts the producing worker's message; it does not validate the complete receipt schema or prove that COPY ran. The controlled proof is not called a valid native export receipt. Worker producer/registry/export validators and actual producing-execution evidence remain Root's separately reviewed scope.

### Exact source resolution and metadata compatibility

The compiler now resolves a relative path only against an explicit absolute dataDir. It does not search a basename, current working directory or ancestors. An unavailable exact path may still compile to describe historical metadata; actual execution is responsible for refusing unavailable files. This separation is intentional and does not replace a missing file with a different dataset.

The independent review creates one actual own `data/sales.csv` decoy but leaves `data/missing/sales.csv` absent. Compiling configured `missing/sales.csv` binds only the absent exact path, never the existing decoy. Missing or relative dataDir refuses. An absolute missing path containing an apostrophe remains compileable and exactly escaped; reader delimiter/NULL-token options remain present. No CSV is analytically read and no query result is inferred from SQL text.

During source traversal I identified a compatibility concern: the old App starter Input paths were `data/correctness_*.csv`, while main already discovers app/data as dataDir and the historical packaged layout places fixtures directly there. The exact-path policy would bind app/data/data. Root adjusted the two authored starter paths to `correctness_transactions.csv` and `correctness_customers.csv`; the strict compiler rule was not weakened. The current positive review executes the exact App initial-node literals and exact main dataDir discovery block against an own tiny historical-layout fixture. Both generated source paths now equal the actual corresponding files.

Current App context pin for that narrow composition check is `0ae873785756ab5ee6732b7ba563c608005043dcc321a598401e5d4b647d1268`; main context pin is `2085324dce849715b2f757a8fe8d39a982803bee1c104200eaef78f491d908b1`. Read-only `git diff --ignore-space-at-eol` shows only those two authored Input-path changes in App. This is a starter-source binding check, not independent acceptance of my save helper/main change, all App behavior, native initial workflow execution or historical real fixture contents. Missing default sample data in a source-only clone is still not silently supplied.

## Oracle-sensitivity controls

Five in-memory source mutants are independently rejected; no candidate file is modified:

1. Removing the actual active failure settlement leaves the first caller pending and fails the owned-settlement oracle.
2. Removing the transport generation guard allows an old fake child to spoof completion of the current job, failing the generation oracle. This is a deliberate boundary adversary, not a claim an ordinary old worker knows an undispatched new job ID.
3. Replacing null-prototype output storage with `{}` loses own `__proto__` in the wire JSON and fails the own-key oracle.
4. Replacing detached producer-proof cloning with a shared reference leaks nested later mutation and fails the retained-proof oracle.
5. Restoring basename-only path resolution in the actual compiler produces the wrong bound path and fails the exact-source oracle, despite valid generated SQL.

These are targeted model/semantic controls, not extra child-process or native cohorts and not checksum-only tests.

## Preserved reviewer attempt

`independent-v1` passed eleven groups and then stopped on my stale expectation that the current starter paths would still be broken. At execution time Root had already corrected them; the exact bound files existed. The failed expectation and all prior observations are preserved in `independent-v1/FAILURE.json`. It is a reviewer source-expectation failure, **not a reproduced current product defect**, and was never promoted to acceptance. A fresh script/output directory v2 replaces only that expectation with the positive current starter-path check, then runs the five planned mutants. No product or QA source was changed by this reviewer. A later read-only diagnostic was initially issued with a duplicated candidate path from the wrong cwd; its file-not-found output supplied no product evidence and was corrected without source mutation.

## Bounds and next action

This source gate supports proceeding to actual isolated Runner/worker and native export/native desktop verification on the exact corrected composition. It does not qualify actual fork/OS error timing, worker close receipts, native SQL success/failure/cancel/retry, physical COPY/receipt lineage, generated UI/package identity, installed/main/migration, offline disconnection, volume or arbitrary operations. Whole candidate acceptance remains pending the other independent gates and Root's real executions. The two editions in the source packet and any shared backend composition remain explicitly separate; old durable history authority or saved catalog pins cannot be silently rewritten because compiler/runner sources changed.

## Reviewer artifact pins

| Artifact | Bytes | SHA256 |
|---|---:|---|
| independent-v2.mjs |16711|`f5c7d5486c29e7d8c8a7b91c14bc329700c7539481f4f0df9cb889e0a9acd5c4`|
| independent-v2/RESULT.json |11621|`e405b7c1c37845f909d39203c664e3b9076b777da7f3c53ad187bf7c61484786`|
| independent-v2/starter-compatibility-positive.json |2600|`10207b21283f5f4ac7938462645b1371205b50ef112764d38b5824492ed238a0`|
| independent-v1/FAILURE.json |7781|`b3e7dda51f5f1d81a99a3e6f6964900399df3e8388d9e21877c7f2e9c9dd3770`|

Original current runner/compiler and executed review script copies are retained in each named review output. No additional product edits are requested by this bounded gate.
