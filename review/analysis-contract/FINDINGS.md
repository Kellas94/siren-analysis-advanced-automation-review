# Reproduced findings

## HISTORY-STARTUP-CLOSE-001 — verified-source, pre-ready refusal cannot close connection

Current exact copied transport6e9ccc32, actual owned RPC host controlled bootstrap fixture rejects before ready/worker. Source verification event has set providerAdmitted=true, but the parent exits1 without becoming ready. Subsequent close() repeats the rejected start promise and leaves closed=false, although that owned parent is already terminated. Initial RESULT and complete transport bytes are retained in evidence/startup-close-before-v1. This is a controlled real connection lifecycle reproduction, not an actual corrupt-history/native-engine test. Existing FINDINGS files searched yielded no matching report; no claim about every historical artifact.

Fix in this new copy only: track successful ready separately from source verification; acknowledge already-exited pre-ready connection as closed/startupRefused with its original nonzero exit. Do not convert startup failure into successful execution, pretend a graceful host exit, or weaken ready/worker ownership checks. Recheck controlled before/after and actual history-refusal startup. Separate reviewer must inspect the delta; actual UI Builder-owner sources remain untouched.

## HISTORY-STATUS-READ-001 — two reads could report a mixed status snapshot

Independent reviewer reproduced on provider e24407ce using actual provider source with FakeStore/FakeRunner: a valid other-writer append between historyStatus()'s first and second read returned head.sequence3 with cached revision1, rather than a coherent head/revision pair. Witness review/independent-history-provider-v1/history-status-interleaving.json retained. This is a model/scheduling finding, not a filesystem/native reproduction.

Root correction makes #refreshHistory return the single validated read; historyStatus reports that admitted head/revision plus the same read's pending-stage information under the metadata gate. Another writer may append afterward, but one returned snapshot stays internally coherent. Reviewer regression is required; no durability/native acceptance follows from this correction alone.

## HISTORY-SOURCE-RETARGET-001 — normalized source could disagree with submitted source

Reviewer-authored semantic-path-host-v3 was inspected and run by Root in an approved host, using actual Store53dc/provider47cc/history-state388 and actual owned metadata files, with FakeRunner only (no native engine/process child). SourceA and distinct same-grantSourceB were regular different files. In a copied first-publication record, normalized path/descriptor/catalog and outer digest were coherently retargeted toB while the complete submittedA fingerprint stayed unchanged. Cold loader admitted it and an exact retry of submittedA returned descriptorB. Original goodA history was preserved. RESULT records refused=false/runnerConstructed=true/retargeted=true; v1 permission and v2 incomplete-FakeRunner failures remain tooling evidence, not earlier semantic findings.

Root correction binds durable input-path interpretation deterministically to the externally trusted canonical grant root; submitted and admitted paths must normalize to the same path, without deleting paths from their comparison. Fresh durable publication refuses symlink/alias spellings that differ from their canonical admitted path and asks the trusted owner for that canonical path. Relative paths in durable mode are grant-relative rather than process-CWD-relative. Ephemeral behavior remains unchanged. Recovery performs no source-file realpath and can still load missing-file metadata. Reviewer regression and actual native old-form proof remain required.

## Current correction closure

All three findings are corrected on provider e0bf44b4/history-state e1563b88/store53dc5bb2/bootstrap196c7d4c/transportf7106e23 in this isolated copy. Source/status models, controlled before/after transport hosts, current actual FS/FakeRunner retarget refusal, actual RPC/native old-form runs and distinct independent reviews are documented in `review/history-provider-source-review.md`, `review/store-and-history-state-review.md` and `review/history-rpc-artifact-review.md`. These evidence modes remain separate. Startup refusal stays exit1; missing current source stays FAILED with no outputs; no response is relabeled success.

Historical custody limit: full old47cc/388 source bytes were not separately retained/located. Their selected identity hashes, original reproduction script/output and distinct good/corrupt physical history are retained. Current complete corrected sources and removed-guard regression controls exist. We do not reconstruct an alleged original or call our own fix independently verified without the separate reviews.
