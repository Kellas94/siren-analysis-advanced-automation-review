# Independent durable-history provider / bootstrap / transport source gate

2026-10-28 — reviewer `typed_route_map`, owns only this lot's `review/`. **SOURCE/MODEL GATE ACCEPTED on exact source-ready-v3 below for proceeding to actual metadata/RPC/browser qualification. This is not durability/runtime acceptance.** No product edits, native SQL, child/app/browser process or actual RPC invocation by this reviewer. Root owns implementation and actual fault/RPC/browser runs; the store implementation/FS gate has a different reviewer.

## Exact current source

Fresh readback after the final controls matches all5 `evidence/source-ready-v3.json` rows:

| Current file | Bytes | SHA256 |
| --- | ---: | --- |
|provider/src/provider.mjs|26287|`e0bf44b4386f837bfa40a29e44c76d58d727a8cacc5b1d9a07369a32bf709873`|
|provider/src/history-state.mjs|5106|`e1563b88e8fd8e2a446e3e0900e9dd20af7c64330b6b4f1820b5cc64ca1a7d24`|
|provider/src/publication-store.mjs|14980|`53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618`|
|scripts/bootstrap.mjs|4132|`196c7d4c78afc178a8764387d1960719590ce46afacf1cb7c1a30f1f39e3be33`|
|reference-consumer/mini_ui/analysis_node_transport.mjs|4191|`f7106e2367f6858065dcde8bfd6ce54acbb068128fece1da1dd268dd08005ec8`|

Earlier e244/388c/47cc and bootstrape1dd checks remain historical, not current acceptance. No whole final startup-packet identity or actual native-data result is substituted by this selected-source gate.

I read PLAN, the separate design review, actual provider/history-state/bootstrap/transport and source changes before the corresponding final checks. The actual store's pure `strictHistoryJson` is imported and used; the DirectoryHistory persistence object is replaced by a model except for the explicitly failed thin FS attempt below. No author CLI/suite was executed as independent evidence.

## Provider/state —11 groups /4 semantic mutants, one finite cohort

`independent-history-provider-v5.mjs` executes the actual current provider, history-state, compiler and contract with a no-process FakeRunner and in-memory FakeHistory. Fake heads/CAS/phase faults are model mechanics, not the store's file format, link atomicity or durability. The sole result0/source2 in the callback test is deliberately supplied, not counted from data. Eleven finite groups pass:

1. Genesis snapshot/revision0 precedes Runner construction. Complete semantic recovery or wrong grant/base/contract/executor/missing open fails before a new FakeRunner. Explicit create/open and no implicit ephemeral fallback are retained.
2. Old exact catalog/reference survives reconstruction with all snapshots and no registry replay. New jobs/requests are process-local; an unknown old job is not restored. Metadata loads while the original source is missing; execute refuses SOURCE_UNAVAILABLE; restoring/changing current bytes creates a fresh physical execution copy without rewriting metadata. No old input/result retention is inferred.
3. Modeled lost acknowledgement after commit: exact canonical submitted payload returns its committed descriptor without another revision; changed title/description/units at the same id/version refuses. A stale second publisher refreshes and preserves all prior modeled acknowledgements rather than replacing a stale complete state.
4. Missing/changed catalog history, fingerprint, stored default/unit, malformed fields and foreign normalized paths refuse semantic recovery before Runner. Recovery uses current compiler/model/default/slot checks, recomputes descriptor/publication/catalog identities and compares complete predecessor prefixes.
5. Commit callbacks encounter HISTORY_BUSY for reentrant public metadata operations. A valid external metadata append replaces only fully checked definition/catalog maps; existing request deduplication, owned job and asynchronous completion retain their original registered workflow/unit/reference.
6. Corrupt metadata blocks new catalog/publication work while owned queued cancellation/status/close remain possible. Closed provider metadata operations refuse; cleanup does not reopen corrupt history. This is a queued model cancellation/cleanup case, not actual worker termination.
7. **New source-retarget correction:** a coherently retargeted admitted input from same-grantA toB, with regenerated descriptor/catalog but unchanged complete submittedA fingerprint, now refuses before FakeRunner. It is not accepted merely because all inner/outer hashes can be recomputed.
8. Durable relative `input.csv` resolves against the fixed trusted grant root, not process CWD. Its admitted absolute mapping survives missing-file recovery. Explicit ephemeral mode still accepts its previous CWD-relative behavior; no contract1/ephemeral path migration is invented.
9. Actual `strictHistoryJson` is called before durable fingerprint/exact-retry: undefined, nonfinite and negativezero submissions refuse instead of becoming a silently different saved payload or an exact retry. Extensive strict-JSON/store bounds remain the separate store gate.
10. Ephemeral opt-out retains absence-of-old-history refusal and Countif nullable/index/list guards. The factored private preparation retains original typed/default/slot/ancestry/graph/compiler policy; the history path is not a second formula engine.
11. **Status correction regression:** a valid other-writer append after the first modeled read now returns one coherent admitted head/revision pair. A later append can make that snapshot older; it does not mix the newer head with the old revision.

Four active history-state mutants remove, separately, submitted-fingerprint verification, recovered-descriptor equality, acknowledged-prefix equality and submitted/admitted source mapping equality. Independently constructed malformed/coherently altered states refuse under original code but admit when the targeted check is removed. This verifies semantic refusal, not authenticated tamper detection. Actual store headers/chain/CAS/process crash behavior remain separately qualified.

## Source binding and recovery policy

Current recovery preserves normalized absolute paths/order and does no source-file realpath/existence check. `projection` now normalizes **both submitted and admitted paths** using the externally supplied trusted grant root and compares them, instead of deleting paths from the comparison. Fresh durable publication resolves grant-relative input, enforces the existing realpath grant and requires canonical admitted path to equal its deterministic lexical request; filesystem alias spellings with a different canonical target refuse. Current execute still enforces actual path/file/schema/source-copy policy. Saved metadata cannot grant itself access or imply that old source bytes/results are retained.

The state validator requires exact state/record shapes, exact base, revision/definition count, genesis plus every exact revision catalog, immutable old definitions/catalogs, original submitted fingerprint, current preparation/normalized equality and descriptor/catalog hashes. Canonical object-key order may be insignificant; array order and full submitted semantics remain part of the fingerprint. Only fully checked maps are applied. Jobs/requests/child ownership are not hydrated from metadata.

A valid terminal-prefix rollback or coherently rewritten complete history cannot be authenticated without an external expected head. That design exclusion is retained; a requested missing catalog digest must still refuse. Local hashes are identities, not authorship/authentication. No stronger deletion/power-loss claim is approved.

## Trusted bootstrap —7 groups, separate cohort

`independent-history-bootstrap-v4.mjs` executes actual bootstrap with FakeProvider only. It reads the **whole current provider/native source roster** plus actual bootstrap and runtime fields; it does not instantiate store/Runner or load the native engine. Seven groups pass: exact externally constructed authority; malformed/foreign config refusal; missing/changed/extra declared executor membership or absent bootstrap pin refusal; configured provider root must equal the actually imported executor; existing non-directory ancestor refusal; no-registry cold startup makes no publication replay, and initial registry failure closes its owned provider; explicit ephemeral behavior remains.

Authority is bound to storeId, grantId/canonical grant root, exact base, contract, approved whole provider byte membership, bootstrap, actual Node version/platform/arch. Stored metadata/config-supplied authority cannot substitute another executor. Existing history ancestors are checked for reparse/non-directory traversal. No new RPC administration/path/publish endpoint is introduced.

Prior tiny-executor bootstrap fixtures qualified earlier source behavior only. They are superseded by current whole-roster authority controls after the imported-executor equality guard was added. This is source/hash-policy verification, not native runtime compatibility or store durability.

## Transport repair —5 model groups plus separate Root artifact readback

I independently inspected HISTORY-STARTUP-CLOSE-001, producer and exact transport copies and read Root's controlled actual before/after host results. Before: host63052 exited1 after source-pins verification but before ready; catalog failed and close repeated that failure/closed=false. After f710: host53904 still exits1 and catalog still fails, while close reports closed=true/startupRefused with that original nonzero exit and no worker receipts.

Five separate EventEmitter-child model groups on actual f710 preserve verified-source/pre-ready refusal closure; pre-source-pins refusal; normal ready close with provider-close/worker receipts/zero parent; abnormal ready exit refusal; and never-started close without spawning. No process is launched by these controls. Source verification and successful ready are distinct. **Exit1 remains startup failure, not execution success or graceful zero exit.** Root's two controlled actual hosts are retrospective artifact evidence, not the reviewer's rerun and not an actual corrupt-store/native-engine case.

## Findings, failed attempts and remaining gates

- HISTORY-STATUS-READ-001 was independently reproduced on e244 with FakeStore scheduling: head.sequence3/revision1. Original witness remains in `independent-history-provider-v1/history-status-interleaving.json`; Root's single-read/busy-gate correction passes current regression. It remains a model finding, not filesystem/native reproduction.
- HISTORY-SOURCE-RETARGET-001 was separately reproduced using actual Store files by the other reviewer/Root. I do not claim that red FS run as mine. Current e0bf/e156 passes my independent same-grant coherent-retarget model and removed-mapping mutant; missing-file/grant-relative/ephemeral retention controls also pass.
- Reviewer v2 stopped before model work when Store admission changed the import signature; v3's model positives passed but a mutant used a cached data-URL class instead of its intended state module. Both failed scripts/output remain. Fresh v4 corrected mutant module identity and passed on the earlier47cc; final v5 renews affected source/path groups and all four mutants on e0bf/e156. Earlier successful and failed editions are not pooled.
- A thin actual provider→DirectoryHistory integration with FakeRunner was attempted in the ordinary tool context on47cc/Store53dc. Genesis exclusive publication failed HISTORY_IO/causeEPERM **before any Runner construction**. `independent-real-store-provider-v1/FAILURE.json` and its pending stage are retained; commits directory is empty. No alternate host, policy change, cleanup or successful FS qualification is inferred. This was an environment/primitive attempt, not a reproduced semantic product defect. Its scope does not become current e0bf durability acceptance.

Actual store implementation/owned-FS review, write/fsync/link faults, bounds, two-writer/CAS/process-stop evidence, current RPC/native data/cancellation/closure, real provider restart without registry, reference-browser physical Save/Open/old pin, full final packet identity and bounded process observations remain their own gates. No durability acceptance, actual UI Builder designer/Docs/Charts/Electron/main/installed integration, job ledger, cached-result recovery or new formulas is established by this report. No unresolved source/model blocker remains on the exact5 current pins.

## Reviewer artifact pins

- Provider/state final script `review/independent-history-provider-v5.mjs`:20898 bytes,SHA `8f9a8032e8c7a4c100d62c569547869acea7425ced26f66a8d38b819d4ca67a8`; RESULT2629 bytes,SHA `a6c4b8cfb10500fe0250fba9b8a288e07b7b7d854eb9a803d0f10b24325f0bc5`.
- Bootstrap final script `review/independent-history-bootstrap-v4.mjs`:6878 bytes,SHA `58395931f97c66214e7cfe0cdf34fa86d03119c0f38eb197d9054d90596bd41a`; RESULT1395 bytes,SHA `e63c960e05d5975b47b3f2860f0b97f973c463e9115a69c18757593afd1f3ead`.
- Transport script `review/independent-startup-transport-v1.mjs`:6244 bytes,SHA `25d204c7d5c14fc64cf329bd2913016b5d99caf3f6f6797cc074ea12c0eb891d`; RESULT1196 bytes,SHA `dcd7c154f64002ed9f30ed3c088103062accebcbb672e1d801f1ea3f1646518a`.
- Current selected source readback `review/source-gate-pins-v3.json`:1001 bytes,SHA `9ee008d7cc17d41b167e0e9e01b40951e92f153995839a11493ae471b87325ca`.
- Thin real-store attempt script SHA `45340c03b7d476692850e0b5db5a0d5789ea8d90f4b51fc395c1bf17670f98c0`; failure SHA `e50d685dac399ef32daa641470a8887535bbfa4392c78fd2e69794d92f827a28`. These are preserved failed evidence, not PASS counts.
