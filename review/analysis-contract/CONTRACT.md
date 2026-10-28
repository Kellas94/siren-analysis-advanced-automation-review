# Durable Analysis publication history — isolated provider extension

Execution contract stays `siren.analysis-execution/2.0.0`; no consumer RPC method or formula engine is added. Internal store protocol is `siren.publication-history/1`, semantic state `siren.analysis-state/1`. This is an opt-in metadata extension to accepted464/a4e1, not an automatic migration of any older form, grant or runtime.

| Responsibility | Owner / reuse / boundary |
|---|---|
| Analytical preparation, typed formulas/workflows, execution/cancellation, result schema/coverage/provenance and Analysis→Charts→Docs | Analysis; retains existing DuckDB engine and published workflow adapter |
| Durable workflow definitions, every exposed catalog snapshot and exact reference resolution | This isolated Analysis provider increment |
| Controls, layout, UI Python, action selection/parameter binding | UI Builder owner; copied compatible consumer/service used here as reference proof only |
| Shared presentation/interaction rules | UI/UX owner; no owner source edited |
| Overlap / transfer | Existing prototype analytical code is preserved. Generic registered-workflow consumer contract remains the shared route; no second analytical engine or hardcoded action shortlist |

## Trusted open / create

Bootstrap config explicitly supplies `history: {directory, storeId, grantId, create}`. Directory is absolute within canonical authorized workDir and existing ancestors must be ordinary directories. `create:false` refuses absent/empty history. `create:true` can initialize genesis; it does not replace existing records. No implicit fallback to ephemeral state when a durable store is unavailable.

External authority binds store/grant IDs, canonical grant root, exact base-catalog digest, execution contract, approved executor membership/bytes, actual bootstrap and exact Node version/platform/architecture. Bootstrap must be the approved actual provider import. Missing, changed, extra or wrongly pinned executor files refuse. Copying a stored authority cannot grant access. A new location/runtime/base/executor requires an explicit future migration policy; editing its stored hashes is not that policy.

Recovery validates before Runner construction and RPC ready. It persists exact admitted definitions, submitted publication/fingerprint, descriptors, version/revision, base and **all** exact catalogs0..N. It recomputes compiler, parameter/default, graph/ancestry, path, descriptor, publication and catalog checks and validates every predecessor prefix. A catalog pin resolves its exact snapshot, never latest. Missing requested history refuses. Strict JSON rejects lossy or non-JSON submissions before retry/fingerprint handling.

## Input and saved-reference semantics

Durable relative input paths resolve from the fixed canonical grant root. Fresh publication also checks actual realpath, grant and deterministic submitted/admitted mapping; alias/junction spelling that maps elsewhere refuses `HISTORY_SOURCE_PATH`. Canonical ordinary paths are supported. Ephemeral CWD/alias behavior is retained separately. Recovery does not demand that source files still exist. Execution captures and checks current authorized source bytes/schema; missing current files give `SOURCE_UNAVAILABLE` and no result. Restore the source and establish a fresh consumer connection if its owned failed session closed.

Forms retain their exact contract, catalog ID/version/digest, capability ID/version/descriptor and workflow definition reference plus configured values. Publishing another capability/catalog does not modify those forms. Historical workflow metadata **does not retain historical input bytes, results or jobs**. New runs create new process-local jobs, source captures and result versions. Old job IDs are not replayed. Original input retention is a separate existing snapshot mechanism, not implied here.

## Append and interruption

Each numbered commit contains authority, complete semantic state, parent digest and canonical record digest. New bytes go to an exclusive unique staging file, are completely written, flushed and closed, then linked exclusively to the next fixed commit filename. Existing committed records are never replaced or deleted. Compare-and-swap detects a stale head both before preparation and publication. Another writer's success produces explicit `HISTORY_CONFLICT`; refresh and retry must preserve it. Exact same submitted id/version returns a verified existing descriptor without another append; different content at the same id/version refuses.

An interruption after link but before acknowledgment can leave a committed publication. Cold read is authoritative; exact publication retry is idempotent. Incomplete/unlinked stages remain pending and are never automatically promoted or cleaned. Status head/revision is one coherent validated snapshot. Metadata corruption blocks new catalog/publication/execution admission while owned job status/cancellation/close remain available.

Bounds:16MiB per record,128MiB total committed bytes,256 committed records including genesis. Pending storage is retained and not globally quota-bounded; no compaction/retention administrator exists in this increment. Long-lived deployment requires a separately designed retention mechanism. Unsupported exclusive-link primitives refuse; there is no destructive rename fallback.

## Qualification limits

Local file flush, exclusive publication, ordinary process restart and the named owned process-stop/CAS observations are distinct from power loss, directory flush guarantees, network/shared filesystem support, hostile authenticated history or deployment durability. A complete coherently rewritten chain or valid terminal-prefix rollback cannot be authenticated without an external trusted expected head; local digests alone do not provide that authority. Requested missing pins still refuse.

Actual reference browser and RPC/native proofs are separate from a full UI Builder designer, Electron desktop, portable package, installed SIREN, Docs/Charts combination, global process absence, unrestricted offline compatibility or120M dataset qualification. UI Builder's completed459/d47 candidate is a distinct intake and must selectively reconcile its current lifecycle/focus/reconnect hooks with Count464 and this history extension in a new copy.
