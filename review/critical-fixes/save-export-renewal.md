# Save and execution-bound export — independent renewal

Reviewer: **test_claim_review**. Mode: independent source review, whole-main VM, actual tiny owned files with explicit FS/job doubles, pure label expression checks, physical custody and retrospective native-artifact readback. `siren-verify` applied. I implemented none of these product corrections and launched no Electron, GUI, analytical child, SQL, DuckDB or build/package process.

## Bounded verdict

**Accepted for the inspected save-preservation and producer/receipt/envelope/registry correction scope on the exact pins below.** The two first-pass issues and the additional same-file-content issue are corrected in the exercised interleavings. No remaining concrete blocker was found in this delegated scope. This is not approval of the whole critical-fixes candidate, the separate provider composition, unrelated Runner/compiler changes, installed runtime or release.

| Inspected desktop source | SHA-256 |
| --- | --- |
| desktop/main.cjs | `2085324dce849715b2f757a8fe8d39a982803bee1c104200eaef78f491d908b1` |
| desktop/atomic_workflow_save.cjs | `f1f992052aa6f8265117fae9e2292aaaa0b2126a69571ecbb33af5a7fcb1e862` |
| engine/export_identity.js | `f8b539d0369e5fb56898a3ee89f6d0fe8bf937ed68e95671bb568d05e9776fb1` |
| engine/worker_process.js | `11d31cc091252768b10d5b911f7dee43e8ffc315385564134b3c78cd0d6901b9` |
| registry/src/export_receipt.js | `1829a70e8d210530bd97e35817e30a88a27332e87dffba189159cd29e1da87d9` |
| registry/src/result_envelope.js | `75804fc405b86c64e0bb0ec2ed7924e54b3ecdfd8f04c97665281047dcb9280a` |
| registry/src/result_registry.js | `f29e1cbaffda6729b59b4ba8567db3293fbebfee8a9f3f1a02acca1f7ac2a1a9` |
| registry/bridge.js | `3f45c258327d7a90aac2098926490f19289cf74638b911235b619b61864ecd55` |
| src/components/ResultHistory.jsx | `dc8d5b102404775dcb213078c19038a17913005b2566754bf7187b931e88ae3b` |

`review/renewal-custody-v1.json` records current physical sizes/hashes and the separately verified56-file Root native-engine-v6 before/after custody. Those captured file sets are exact bijections and their physical bytes/hashes match, returncode0. The included export runtime sources match this review's current desktop pins. The newly revised save helper and label UI do not acquire native-save/render qualification merely from that backend cohort.

## Save correction and preserved adverse evidence

The main change remains exactly one sibling helper require and replacement of the direct destination write. Renderer/preload/history/close logic was not redesigned by this save patch. The helper writes an exclusive same-directory stage, loops short writes, fsyncs, checks its descriptor/path identity, pins the closed file's content revision, compares exact bytes, then renames once. It neither truncates nor deletes the existing destination as a failure fallback.

The reviewed history is preserved rather than overwritten:

- `save-stage-identity-v1` retains full main208532/helperab60 source and actual own-file traces showing publication of a different replacement stage and deletion of a replacement during failed cleanup.
- `save-stage-identity-v2` retains full helper24919 and shows those two cases correctly refused, but same-inode/same-length content mutation during readback still published `00999` instead of authored `00120` and returned Saved.
- `save-stage-identity-v3` retains full finalf1f9/main208532 and renews those original cases. Identity is now dev/ino/birthtime, with closed-stage mtimeNs/ctimeNs revision checks around readback and before rename. Different-file replacements refuse while preserving both old destination and foreign replacement. Same-file content mutation after read and mutation after close refuse, preserving the prior saved destination. Partial-write failure and rename/EPERM also preserve the prior destination; ordinary positive save publishes exact expected UTF-8 JSON, including emoji, zero, empty and NULL.

The final reviewer cohort has **seven production-source cases plus one isolated removed-content-guard mutant**, not eight successful production tests. That mutant again admits the coherent same-length `00999` file; the independent exact-byte oracle rejects it. No product file is changed to perform the mutation. The original errors and materialized files remain under their distinct directories.

`save-retention-v1.mjs/json` separately exercises the actual whole main with startup held and explicit dialog/writer doubles, plus actual unchanged DefinitionHistory (`4fe02bd6a4ed0f3a1f561d2a1660ca5db2124833558f7790779fd55805de7242`). ForceCancel and dialogCancel perform no writer call. Newer edits remain dirty; reverse save acknowledgements retain the newer path; another view with the same node ID ignores the old save response; failed save retains path/dirty/failed. These six model records are separate from the file interleavings and author tests, and are not native dialog or renderer scheduling observations.

No power-loss, directory-fsync guarantee, actual full disk/device error or hostile last-check→rename immunity is claimed. Unknown/changed stage identity fails closed; an unremovable own stage can remain without becoming a saved success. External destination CAS/multiwriter ownership policy is unchanged. Existing save/open IPC sender/path authorization was not expanded or newly qualified by this helper-only correction.

## Export producer, observer and registry

The worker executes COPY to a unique private sibling artifact, hashes and validates that actual file before publishing it at the requested destination, and emits a detached `producerExport` in STEP_RESULT. It records actual private COPY SQL and public `exportDestination` in COMPILED_SQL. The source node/view/count, job/export IDs, format, path, producing hash/size/query digest and time remain distinct from the later observation/capture time. Publication is per export, not one atomic transaction across all workflow outputs. Failed stages remain pending; no unrelated destination is auto-deleted as recovery.

`captureExportReceipt` requires the actual own completed job, direct source/export edge, source/view/count/COPY/path/format and producing metadata; it compares the observed file to the retained producing hash. It never recaptures a later B destination and synthesizes B identity for old jobA. Envelope construction checks the receipt against current retained job output, embeds that producing record and rechecks file bytes. Sealed reads validate its bindings and semantic/integrity identities.

`export-binding-v1` preserved the first-pass registry4e303 issue: a same-size write during hashing could return `verified:true` for obsolete bytes. The exact first-pass six full module bytes are retained in its inspected source files and `SOURCE_CUSTODY.json`.

`export-binding-v2` renews on registryf29e and the unchanged other five export module pins. Its **20 grouped own-file/model observations** are separate from save/native cohorts. They establish:

- successful actual private-file publication, producer receipt and sealed envelope; unique stage removed on success;
- same-size later destination replacement refuses, retaining producer A metadata;
- missing/wrong producing job, source/view/count/query/destination, failed/cancelled job and digest contradictions refuse;
- forged receipt producer digest/query/source/current-file digest refuse against actual retained job output;
- zero-result/zero-byte CSV identity is allowed in the explicit model;
- an actual old sealed observer-only record retains exact bytes/resultId/integrity, while current list/verify reports `LEGACY_EXECUTION_UNBOUND`, contentVerified=true and verified=false;
- the same controlled during-read A→B mutation now returns verified=false/`EXPORT_CHANGED_DURING_VERIFICATION` through `snapshotExportFile`;
- removing the observer comparison in an isolated in-memory module admits replacement, which the independent current-file-versus-producing-A oracle rejects.

These are actual file/helper/registry behaviors with explicit constructed completed-job/COPY-content fixtures. They do not run DuckDB or authenticate arbitrary fabricated supplied jobs. A local hash is integrity/identity evidence, not author or host authentication.

## Minimal legacy disclosure

`history-export-label-v2.mjs/json` evaluates the exact source label expression for VERIFIED, LEGACY_EXECUTION_UNBOUND, UNBOUND, NONE and missing status. Verified records explicitly say the export is bound to the retained execution and the **current file is not reverified**; legacy says the execution link is unconfirmed. The preview derives legacy status from an available old reference lacking producer metadata; list uses the registry's effective status. No old sealed record is rewritten.

After removing exactly the added helper and two display calls and normalizing blank-line/CRLF whitespace, the surrounding source equals the frozen ResultHistory. All original async capture/list/open/export guards remain text-identical. This is a pure expression/source-diff check, not a mounted React, visual fit, pointer or GUI save acceptance.

The first label checker failed only because its CRLF normalizer left CR characters from current CRCRLF blank-line drift. Its source/infra record are preserved; v2 corrects that reader normalization. An earlier Python console inspection also failed to print Unicode under cp1252; a fresh explicit UTF-8 read corrected the inspection. Neither caused or establishes a product defect.

## Retrospective readback of Root native evidence

Read `scripts/native-engine.mjs` before the readers. `native-export-readback-v1` checks Root's historical native-engine-v5; `native-export-readback-v2` separately checks designated native-engine-v6. **Neither is an independently rerun native cohort. Do not pool v5 and v6.**

The v6 reader requires the exact10 named ordered records, strict true pass/finished flags, distinct job identities and three owned child close records/signals **SIGKILL / SIGTERM / SIGKILL**. These are deliberate crash, cancellation and final destroy observations, not graceful worker exits or global absence of processes. The56-source before/after physical custody was also independently checked.

Saved files/records substantiate the export route: A retains exactly A/10.25, B/20.5 and literal `=note`/0; later sourceB retains Other/99.75 with a different producer hash. Private COPY SQL/path/query hash and producing record match job output and sealed registry bytes. Saved A remains immutable and supplies the later saved Charts rows, snapshot/integrity/receipt hashes and unknown source-current state. The distinct typed Lookup/Count route retains exact BIGINT string `70`, result1/captured1/source90. Its full left80/right10 CSV populations and label cycle were independently read to derive70 non-NULL values, including empty text. The empty native export is schema-bearing **13-byte header-only CSV**, result0, not the model's zero-byte case.

JSON export rows are independently decoded and compared; Parquet file hash/size and PAR1 boundaries match the producing record, but this reviewer does **not** independently decode its logical column values through DuckDB/another Parquet engine. Typed native job/retained rows and exact COPY source/view binding are supporting evidence with that readback limit stated.

Three rehashed saved-record corruptions (wrong producer job, observer hash replaced with B, producing query hash) are refused by the independent literal/actual producing-metadata oracle, beyond checksum mismatch alone. The readers pin the actual artifacts they used. No new save helper native execution, browser, Docs UI, Charts paint or package is inferred from backend files/screenshots.

## Remaining scope limits

This report closes the delegated save source/file and export/registry source/file/readback issues only. Root's final whole-candidate identity, provider mirror/history authority, independent Runner/compiler source gate, current native desktop IPC/dialog/package custody and remaining P2 contract/consumer findings stay separately owned. Mirroring bytes does not migrate existing historical authorities or integrate the two editions. No original/main/installed SIREN, Terminal, actual UI Builder sources, policy, release or GitHub state was changed by the reviewer. Source changes after these pins require renewal of their affected gate.
