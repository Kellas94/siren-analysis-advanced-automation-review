# Independent retrospective durable-history RPC artifact gate

The finite current `evidence/rpc-v2` artifact gate is **ACCEPTED IN THE SCOPE BELOW**. This is an independent readback of Root's actual retained executions and files, not an independent native rerun. No provider, SQL, child process, app, browser or IPC was launched by this reviewer. Writes are confined to this lot's `review/`. No new product finding was reproduced.

The independent source/model report is separate: `review/history-provider-source-review.md`, 13,617 bytes, SHA256 `24c0fbdc1fdf4d39d9b563551db5b99a3d071ec0b003434ca2dc715360e2257c`. Its source-ready-v3 pins remain current: provider `e0bf44b4386f837bfa40a29e44c76d58d727a8cacc5b1d9a07369a32bf709873`; history-state `e1563b88e8fd8e2a446e3e0900e9dd20af7c64330b6b4f1820b5cc64ca1a7d24`; store `53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618`; bootstrap `196c7d4c78afc178a8764387d1960719590ce46afacf1cb7c1a30f1f39e3be33`; transport `f7106e2367f6858065dcde8bfd6ce54acbb068128fece1da1dd268dd08005ec8`.

## Producers, custody and mode

I read the exact copied `executed-history-rpc.mjs` and `executed-proof-utils.mjs` before authoring the independent reader. I also read the three copied Count/text fixture modules, current `fixture.mjs` and `source-fixture.mjs`, actual consumer discovery/execution mapping, provider result/source-capture/binding logic, RPC host, semantic state validator and bootstrap. The copied producer/helper bytes equal their current source files. The 455 transport source pins in every connection config are identical and all current physical bytes match those pins.

The producer calls the actual copied `UiFunctionService` → `AnalysisCatalogConsumer` → `AnalysisNodeTransport` → owned RPC host → Analysis native Runner/worker. Form creation, value assignment and saving are programmatic. There are no browser pointer actions, Electron windows, native OS Save/Open dialogs or actual UI Builder designer interaction in this cohort. Native means the actual Node-hosted Analysis/DuckDB worker route, not a desktop executable. Metadata-only process-fault/CAS and browser cohorts remain separate gates.

`fixture.mjs` and `source-fixture.mjs`, used by the retained SUM publications, were not separately copied into this cohort by the author. Their current bytes match the whole pre-RPC packet manifest. That is a packet-level custody readback, not a new contemporaneous executed-fixture capture. The five copied producer/Count/text files have explicit cohort copies. All captured source files referenced by completed results were independently opened and hashed; their sizes, original-path source IDs, capture paths and CSV populations were checked.

## Exact current execution cohort

The author RESULT has exactly the nine named records written in the executed producer. My reader requires the same ordered roster, not just `finished:true` or a count. There are nine distinct parent receipts:

| Connection | Parent | Exit / meaning | Worker receipt(s) |
|---|---:|---|---|
| parent-a | 67768 | 0, ready, normal close | 9840 SIGKILL |
| parent-b | 68420 | 0, ready, normal close | 11864 SIGKILL |
| parent-c-missing | 61276 | 0, ready, normal close after unavailable-source failure | 48476 SIGKILL |
| parent-c-restored | 26976 | 0, ready, normal close | 68848 SIGTERM; 44624 SIGKILL |
| parent-d-exact-retry | 27048 | 0, ready, normal close | 68448 SIGKILL |
| wrong-grant | 61804 | 1, startup refused before ready | none |
| missing-history | 62144 | 1, startup refused before ready | none |
| corrupt-prefix | 61704 | 1, startup refused before ready | none |
| missing-middle | 8520 | 1, startup refused before ready | none |

All parent signals are null. The six worker closure receipts have `closed:true` and signal termination rather than normal exit 0; five are maintained destroy SIGKILL and one is cancellation SIGTERM. No ready parent or worker receipt is reused as another parent. The startup-refusal receipts explicitly retain exit 1 and `startupRefused:true`; these are successful refusals and cleanup, not successful executions or graceful exit 0. `providerAdmitted:true` here records the transport's source-pins event before bootstrap, not a claim that a provider became ready. Startup causes remain HISTORY_AUTHORITY, HISTORY_MISSING, semantic HISTORY_INVALID_STATE (wrapped HISTORY_STATE), and HISTORY_CHAIN respectively.

This cohort has **ten distinct completed native jobs**, a separate actual cancellation receipt, and a separate missing-source failure before job admission. These are not added to the nine scenario records or to the source/model test groups as an artificial total. Completed jobs are the exact files for `a-empty-v1`, `b-old-pin-empty`, `b-wide-lookup`, `b-sum`, `b-decimal`, `b-current-input-changed`, `c-source-restored`, `c-false`, `c-cancel-retry`, and `d-exact-publication-retry`.

The service output, separately saved raw terminal status, and table envelope must agree exactly. Request, job, workflow, output node, result version, executed definition, applied parameter hash, all source captures, schemas, nullable flags, units, coverage and integrity seal are checked. The executed definition hash is independently reconstructed after actual parameter binding and replacing original paths with captured paths. Hash validity alone is insufficient for this gate.

## Independently read values and populations

The Count/text workflows have two inputs, 80 left rows and 10 right rows, so source population is 90. The separate retained SUM workflows have 80 left rows plus 12 right rows, so source population is 92. Neither source count is a result count.

- Empty configured text Countif returns the exact BIGINT string `10` before close, after new-parent no-registry recovery, after source restoration, after cancellation retry and after exact-publication retry. It is one COMPLETE row with source90/result1/transferred1 and unit `rows`.
- Changing one actual current input empty label to `CHANGED` produces `9`, a new captured-source hash and new job/result version. The old form/reference remains unchanged; the original input is restored afterward. This proves fresh current authorized capture under an old workflow pin, not historical input retention.
- Boolean false returns exact BIGINT string `53` from all 80 left rows, with source90. False is retained as Boolean in parameter hashing and binding, not text or truthiness.
- Lookup is result80, transferred50, 17 columns, source90, explicit SAMPLED with `FIRST_N_PREVIEW_NOT_STATISTICAL_SAMPLE`. Every retained cell (50×17 = 850) is compared with an independent calculation from the actual captured CSVs and finite typed rules. INTEGER IDs are actual numbers, unique and in the observed first50 order. Numeric-looking VARCHAR `00120`, DECIMAL(38,10) exact scales, BIGINT beyond safe JSON range, uint64/uint128 maxima, signed128 minimum, DOUBLE/Boolean/null, empty text, literal `=SUM(A1:A2)`, literal tag `=review`, spaces, composed/decomposed accents, Chinese and emoji remain distinct. LEFT/RIGHT/MID are computed by Unicode code points in the independent reader; Lookup uses exact text including empty, without case/trim/normalization or numeric conversion. No all80 transformed-result file is claimed.
- Retained integer SUM is exact HUGEINT string `63050394783186951`, unit `items`, COMPLETE one row, source92. It equals the independent sum of the seven source rows with KEEP and ID>=60.
- Retained decimal SUM is exact DECIMAL(38,10) string `1053.0000000027`, unit `RON`, COMPLETE one row, source92. It equals an independent decimal calculation over KEEP source rows with ID>=0.

`c-missing-source.json` is FAILED/SOURCE_UNAVAILABLE/ENOENT with no native job ID and no outputs. Its owned-session-close receipt equals the saved missing-parent normal closure. Metadata discovery still connected while the file was absent. A fresh restored connection executes the unchanged form successfully. The actual separate cancelled job is `job_1793216815898_j7ik7`: requested/confirmed/cancelled/workerExited all true. It is not among the ten completed IDs. This is one observed cancellation; it is not a generic crash/cancel stress claim.

## Physical history and saved form

The eight ordinary committed files are exactly `000001.json` through `000008.json`. Their bytes/hashes equal both `commits-after-a.json` and `commits-final.json`. Each authority hash, record digest, sequence and parent digest is independently recomputed. The same authority/base is retained. States have revisions0…7, definitions0…7 and all exact catalog snapshots0…7 with70…77 entries. Previous acknowledged definitions AND previous catalog bodies remain exact prefixes. Submitted fingerprints, normalized submitted/source paths, definition identities, descriptor/publication identities and every catalog digest/body/version are checked, not only the latest catalog.

The connected consumer view is deliberately a mapped discovery view, not byte-identical to the stored raw catalog. The independent reader checks its identity, complete entry roster, executable admission, parameter signatures/defaults, copied metadata and exact references against the raw stored descriptors. The final new-parent discovery has the exact prior catalog digest without any publicationRegistry in parent B's config. Parent D's exact registry replay creates no ninth commit or replacement metadata.

The actual saved `saved-history-form.sirenui.json` remains **2452 bytes**, SHA256 `7133f3e664c9666f16ec3708a15a20c934d41e1c551b4938acc5f5ef86195f22`. Its text control is configured empty while the declared parameter default stays `00120`. It pins catalog2.0.1 / `30c2a842c4db4b0d906832ddac3e2fd8a72a1656c2eaafe8d12f56171127cf97`, workflow text1.0.0, descriptor `69e5e08fe7d9850e8fbbd027c22f98e719c5b6c92999d48a65870d4495bb3eb7` and definition `b805006c94a0c3b4d59f8d0df4aa8a13f740d11f2e7e8eb88fc0035e70909748`. There is no implicit pin migration to2.0.7. This cohort reads the physical form file programmatically after cold startup; browser Save/Open is a separate qualification.

The manual uncommitted stage is still present and not promoted. The corrupt-history copy's coherently rehashed old-unit rewrite and gapped copy's absent middle commit refuse startup. The original good eight-file store and form remain unchanged. This verifies the named finite cases, not external-tamper authentication, power-loss durability, or detection of a cold complete valid-prefix rollback without an external expected head.

## Independent fail-closed controls

`review/independent-history-rpc-artifacts-v4.py` passed seven bounded reader groups and **14 deliberate in-memory corruption refusals**. Original evidence is untouched. For result controls, the result integrity digest is recomputed and redundant service/raw table views are updated together. The reader still rejects duplicate Lookup row/ID, VARCHAR-to-number coercion, changed uint128 maximum, empty-to-NULL change, changed decimal total, extra SUM row with coherent result counts, pooled90→92 source population, wrong request provenance and fabricated captured-source hash. Separate controls reject repeated parent identity, startup1 relabeled0, rehashed acknowledged source retarget, rehashed acknowledged unit rewrite, and changing the saved configured empty value. The latter file pin is checked against the exact independently fixed original saved hash, not an attacker-supplied replacement receipt.

The source-retarget/unit controls here test the physical chain's acknowledged-prefix refusal. The broader fully coherent semantic source-retarget red/green belongs to the separate source/store reviews; this reader does not claim to repeat that FS reproduction.

## Preserved adverse attempts and remaining gates

Root's rpc-v1 stopped after four completed records because the probe searched error text for the code SOURCE_UNAVAILABLE, while the actual result carries `.code` separately and text `Authorized source is currently unavailable: ENOENT`. The failure and its partial files remain historical, not pooled into current acceptance. Root also reported an initial rpc-v2 invocation with wrong cwd before a host was launched; that operator/tooling observation is not a product refusal receipt. The completed current rpc-v2 uses a fresh restored connection because the consumer deliberately closes its owned session after a pre-job SOURCE_UNAVAILABLE failure.

My own reader attempts are retained: v1 had a Python unmatched-parenthesis compile failure before any gate; v2 incorrectly expected HISTORY_GAP rather than the actual defined HISTORY_CHAIN and stopped; v3 correctly passed connection/state checks then incorrectly compared a mapped consumer catalog with the complete raw stored catalog. v4 fixes only those reviewer expectations and has a fresh result directory. These are reviewer-tool failures, not product findings or passed cohorts.

All466 files/64,294,901 bytes in the pre-RPC manifest were freshly rehashed against current physical files. Its roster remains `6f56df373394f5df9563ce0a4de3ed2ce2b124556245a6b1dfb0aed24e4f5dff`. This confirms the recorded members' current identity and RPC custody. A final packet membership/bookend after all later browser work is still separate; this report does not silently treat the pre-RPC manifest as that later final freeze. No process census was run by this reviewer; closure conclusions are the exact retained owned parent/worker receipts, not a global absence claim.

Actual metadata-child faults/CAS/concurrency, independent store FS review, browser old-form Save/Open, final whole-packet bookends and final scoped process observation remain their own gates. This report does not qualify actual UI Builder designer adoption, Docs/Charts/Electron/installed integration, migration, generic offline/network behavior, new formulas or release.

## Artifact pins

| Artifact | Bytes | SHA256 |
|---|---:|---|
| independent reader v4 | 26643 | `4c6f5b9037aa36ea44766fa32b3c775b893cdbbc466d761552ec7ebb9cafde91` |
| independent reader v4 RESULT | 5958 | `f4815b34166f013e1291bbf1dbe49605e9ce703a688fac2d263a0cf219424fbe` |
| executed history-rpc | 11461 | `7f995b5e65d3fdfd6fa09363c5ecc7158e3b28a71806200fbb6559cbb76b48ff` |
| executed proof-utils | 4288 | `c01be9a6f90c4ea859b46d4c39e5d59f7b06a9e0cecb76939ef77c0c266d8b5e` |
| author rpc-v2 RESULT | 4908 | `6dde937aa303677a2e8a0d7c27e5ddd7c06e58c45f407d8e363ef035a03f6c39` |
| pre-RPC application-manifest | 102028 | `dcdaa2b553cff2778352cf259ad2298f9806e3928eb1ca78e72cfcbf15afb170` |
| final physical commit000008 | 1252891 | `2328091676c6a34d813b5415159366ae5211643315389048a09b1cf1b8f4e03b` |

Proceed with the other explicitly separated durable-history gates on these unchanged source bytes. Do not call this artifact readback a second native execution.
