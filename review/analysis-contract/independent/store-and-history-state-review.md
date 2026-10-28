# Independent store and history-state review

Reviewer: Codex `test_claim_review`, separate from store author qa and Root provider/history-state implementer; siren-verify. Read-only product/source review. Reviewer authored the controls/oracles; **Root inspected and operated the metadata-only FS/FakeRunner programs in approved host context**. Reviewer independently ran pure JSON controls and read the physical artifacts. No reviewer native DuckDB, child worker, RPC, browser or application run. No product changes.

**Verdict: accepted within the Store53dc and corrected source-mapping scope below. HISTORY-SOURCE-RETARGET-001 is confirmed on the initial edition and corrected on the inspected current edition. No remaining reproduced blocker in this bounded gate.** Whole provider/bootstrap/transport/native/browser/final-packet acceptance remains separate.

## Exact current pins

| Current file | SHA256 |
|---|---|
| `provider/src/publication-store.mjs` | `53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618` |
| `provider/src/history-state.mjs` | `e1563b88e8fd8e2a446e3e0900e9dd20af7c64330b6b4f1820b5cc64ca1a7d24` |
| `provider/src/provider.mjs` | `e0bf44b4386f837bfa40a29e44c76d58d727a8cacc5b1d9a07369a32bf709873` |

Store author files/tests/README, Root source-ready manifests and actual current sources were inspected before controls. Store's implementation/provider copies are the same53dc edition; prior authoraf633 controls are historical author evidence, not independent current execution. Bootstrap196c and transportf710 are outside this review's renewed source gate and belong to the peer review.

## Confirmed finding, now corrected

**HISTORY-SOURCE-RETARGET-001 — submitted source fingerprint did not bind normalized source.** Initial provider47cc7e94/history-state388cd760 deleted all input paths from submitted/normalized comparison. The finite witness uses distinct regular A.csv/B.csv inside one owned grant. In a copy of first-publication history, normalized source/descriptor/catalog and outer digest are coherently retargeted toB while the complete submittedA fingerprint stays unchanged. Actual Store plus actual semantic loader admitted that state, constructed FakeRunner, then exact retry(submittedA) returned descriptorB. This is a demonstrated metadata/source-identity/lost-ACK defect; no incorrect SQL/native data result is claimed.

RED: `review/semantic-path-host-v3/RESULT.json`, SHA256 `6308b49cceb7027b49735a20ce93fe7f0cccab5483a7e103cb909f1972872d69`. Root recorded this as the same finding, not a duplicate. The original goodA chain and corrupted copied chain remain distinct.

Root's current fix compares full source mappings after deterministic resolution from externally supplied grantRoot (`history-state.mjs:18,48`). Durable fresh publish resolves relative paths from workDir and requires realpath to equal that canonical request (`provider.mjs:147-151`); recovery checks normalized granted paths without opening the source file. Ephemeral behavior remains unchanged. Capability impact is deliberate: durable alias/junction/case-dependent spellings may need an explicit canonical path; this is not silent remapping or a rewrite of already accepted durable production history.

GREEN: `review/semantic-path-host-v4/RESULT.json`, SHA256 `fdc3165b6d6fd0bcbd77d0180cc707f2b3f1ec65f9bebc4f153bef8c23ab7917`: actual Store/current loader refuses HISTORY_STATE **before FakeRunner construction**. Five separate preservation/adverse records prove ordinary exact retry/different-payload refusal; grant-root-relative resolution despite another cwd; metadata recovery/identical retry with current A missing and execute admission SOURCE_UNAVAILABLE; durable junction-alias refusal/canonical acceptance plus ephemeral alias preservation; and an isolated removed mapping-guard mutant admittedB, detected by the independent sourceA oracle. No SQL or actual worker was run.

The stdout convenience field runnerConstructed is cumulative after later preservation constructors, and reads true. It is **not** the adverse oracle: `adverse.runnerConstructed=false` and the immediate unchanged-constructor-counter assertion are the gate. The JSON/readback uses those correctly. `semantic-path-readback-v1.py/json` independently checks actual RED/GREEN commit hashes, unchanged submitted fingerprint, different raw/canonical source paths, descriptor/catalog identities and latest positive relative-path history; readback SHA256 `f3e44d6e792a741a56309c732a19a39aeb1ff15c157b18f1ce9550c682a126a8`.

**Custody limitation:** full pre-retarget47cc/388 source snapshots were not retained/located. Their selected hashes, source-ready-v1, the actual RED probe/output and owned metadata are retained; current corrected full source exists. Root confirmed this gap. No supposed original file is reconstructed or claimed from patch history. The initial default-context v1 EPERM and v2 incomplete FakeRunner.initWorker bind failure remain infrastructure attempts, not semantic findings or completed controls.

## Independent Store53dc evidence

Three grouped **pure strictHistoryJson** records and two removed-guard controls (`store-json-v1.mjs/json`, raw SHA256 `6f213f575dce1e950a2b4e1027532b9f4718f595610ec9bbcd870dff31ea6006`) verify exact strings/NULL/false/empty/zero, finite fractional values and ordinary catalog availability.prototype survive detached cloning. Unsafe integral Number, -0/nonfinite, undefined/function/BigInt/symbol, accessors/nonenumerables/cycles/sparse/decorated arrays and unsafe prototype keys refuse without invoking getters. Removing unsafe-integer or negative-zero guard causes the independent refusal oracle to reject the mutant. Actual provider source calls strictHistoryJson before fingerprint/early exact-version retry.

Ten grouped **actual owned FS** records (`store-fs-host-v1.mjs`, SHA256 `842c5997ce6a9717934a26fbd01069354ca60c2b4f799ac42301c31f1b5490bf`; result SHA256 `1259bdd387b7950723b691ad857eefde1d0463f36043cce424bb3fa3f35bd385`) pass on53dc:

- Full append/read/clone/previous-state validation; successful stages retained without false pending.
- Stale head and controlled two-instance interleaving refuse loser while conserving winner. This is one-process scheduling, not an actual multi-process race.
- Injected write/fsync/link faults preserve acknowledged bytes and stages; ordinary retry works. Phase exceptions before link preserve old head; after link is a readable lost-ACK state. Raw Store retry is CAS, while submitted-publication idempotency belongs to provider.
- Prelink stage tamper, false/Promise validator, reentry and closed access refuse. Coherent authority/parent/semantic-prefix errors, digest corruption, duplicate/noncanonical bytes, missing middle sequence and unknown committed entries refuse.
- Partial/unknown/oversized pending stages remain; no promotion/deletion. Own ACK remains its own head/state even when a peer commits the next revision before return.
- A removed read-semantic-validation guard admits coherently rewritten prefix; independent immutable-prefix oracle rejects it.

Separate Python `store-fs-readback-v1.py/json` rereads11 positive fixture chains and preserved failure stages, checking full canonical bytes, sequence/parent/authority/body hashes and exact states, including unchanged acknowledged genesis bytes. It confirms the prefix corruption has valid hashes, so checksum alone cannot catch it. Readback SHA256 `a49c9121e22234c7484851c2a4c635cbc87c996994d5fb49ae57fa20c8f9ad8d`. These11 fixture chains are not11 new native tests and are not pooled with the ten groups or author cohorts.

## Code conclusions and material limits

Store `#read` validates every immutable numbered record against trusted authority and semantic callback; `commit` validates/clones before staging, fsyncs/closes, rereads CAS, rechecks staged bytes and exclusively links fixed next filename with no overwrite/delete fallback. Original phase exceptions and ambiguous post-publication ACK failure remain visible. The callback is mandatory, synchronous and clone-isolated; analysis semantics are delegated to Root, not implemented by this generic store.

The16MiB record/128MiB committed-total/256 commit limits and actual read/commit protocol regions are byte-identical to preserved authoraf633 regions. Large128MiB/256 controls were **not independently rerun** or promoted from old author results. Pending disk usage is excluded from committed total and has no cleanup/quota guarantee; individual pending reads are capped, oversized stages count pending without being read.

Current semantic source inspection recomputes normalized admission/descriptors/catalog snapshots and immutable definition/catalog prefixes with trusted base/grant. This report's actual Root semantic controls concentrate on the reproduced path relationship; the peer owns broader provider/bootstrap/transport modeling and actual RPC/native evidence. Test FakeRunner authority is deliberately a model and does not itself qualify bootstrap's whole-executor roster/runtime authority.

No power-loss/directory-flush guarantee, privileged hostile-parent path race guarantee or authentication of a coherently rewritten entire store is issued. Valid-prefix/tail rollback cannot be detected cold without an external head; requested missing pin still must refuse. Metadata is not input-data history, result retention, job/request persistence or automatic replay. Store-root symlink refusal is source-inspected here, not a new independent junction test; the actual junction control above is the publisher's canonical-source gate.

No whole-packet identity, browser/UI Builder designer, installed application, Lock/PIN, Docs/Charts export or release acceptance follows. Current native rpc-v2 is Root-operated and reviewed separately; none of these metadata/FakeRunner results are called native execution.
