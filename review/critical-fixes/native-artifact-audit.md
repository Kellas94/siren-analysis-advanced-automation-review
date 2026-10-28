# Independent native-artifact audit

**Bounded verdict:** the final artifacts support the finite Root-operated engine, provider-engine and Electron IPC/file/lifecycle observations below. Their source custody is verified. This is artifact/tooling review, **not independent acceptance of this reviewer's Runner correction**, a new native run, or general product/package acceptance. No product, historical evidence, native process or GUI was modified or operated by this reviewer.

## Final cohorts — separate evidence classes

| Cohort | Supported observation | Source custody independently checked |
|---|---|---|
|`native-engine-v6`|Ten literal named engine cases; real native worker/SQL/COPY/registry/files/Chart snapshot. Three captured workers close: 60076 SIGKILL, 69456 SIGTERM, 63436 SIGKILL. This is host Node, not Electron or normal application Quit.|56 backend/probe files, 387052B, identical before/after copies and exact membership. Desktop-v3's full capture also contains the final backend.|
|`native-provider-engine-v2`|Ten equivalent named cases through the composed common edition's actual engine imports. Captured workers 64136 SIGKILL, 75184 SIGTERM, 7844 SIGKILL all close. No catalog service, authority migration or UI Builder execution is implied.|248 first-party/probe files, 1861597B; every copied file's bytes/hash and exact membership checked before/after.|
|`native-desktop-v3`|Actual Electron main/preload/renderer loaded through an owned test entry. Save phase has four records; new-parent reopen phase has two. Parents 35976→61856 both exit 0 with no exit signal. Each has one captured fork child, 65584/52660, closed with SIGKILL during approved cleanup.|168 application/probe files including generated dist, 3362752B; full before/after bytes/hash and exact membership checked.|

These cohorts and this reader's checks are not summed into a test total. Node-host custody records identify v24.16.0 and executable SHA256 `b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3`. Electron admissions independently report Electron 44.9.3/Chrome 152.0.7977.167/Node 24.22.0. The copied 72-file runtime intake was separately rehashed, 385923028B, without treating it as a complete application package.

The native engine scripts retain old generic scope text saying “disconnect”. Their actual captured scripts use `oldChild.kill('SIGKILL')`, and their ninth named record says captured-worker crash. This supports peer crash/EOF, **not** successful closure after explicit parent-side `child.disconnect()`.

## Physical readback and finite oracles

The reader uses built-in file/JSON/CSV/hash operations only; no product module is imported. It checks exact case names, real saved records, source/result/preview distinctions, and these concrete expectations:

- A's three typed rows remain `A/10.25`, `B/20.5`, `=note/0`; B is `Other/99.75`. Their producer hashes differ; saved registry records retain their own job/data/producer identity and valid envelope/content hashes. The final shared destination has been rewritten by a later A retry, so its final bytes are compared to that retry, **not** incorrectly asserted to remain B.
- Saved Chart bytes have consistent bundle/snapshot hashes and contain A's three mapped rows and 3/3/3 coverage, even though a mutable export was changed during the scenario. This is saved snapshot readback, not chart rendering.
- Actual semicolon CSV inputs contain 80 left rows and 10 right rows. Direct CSV parsing finds 70 non-NULL labels, including empty text. Source telemetry 90, Lookup result 80, preview 50 and aggregate BIGINT string `70`/one row remain distinct. Fifty unique typed preview rows match the CSV for exact DECIMAL scale, BIGINT/unsigned128/signed128 strings, numeric VARCHAR `00120`, NULL, empty text, Boolean and literal text. The Parquet artifact matches its producer byte count/hash; no independent Parquet reader was run.
- JSON export is parsed as three actual JSON lines. The empty CSV case retains two schema columns and zero rows/COMPLETE without invented data. Missing-source error text names the intended missing subpath, the unintended output is absent, and retries/special-ID/raw crash/cancel job states are present.
- Desktop-v3's physical workflow is 843B, SHA256 `ee71c9f5985ad92f1a78d19b3f7e7aa2cb77a39c6014fc4dc900db3bb9b6a122`. Both phase configurations and saved native jobs match it. Native data preserves `00120`, `😀`, `=literal`, zero and the expected numeric values. Parent exits, per-phase results, admissions, fork-close records and top-level results agree.

Four in-memory corruptions are meaningfully rejected: a missing engine case, count `71` instead of `70`, an unclosed child, and changed saved-workflow bytes. Originals are untouched. The final reader's separate runs report 16 and 15 check groups with no failures; these are reader checks, not additional native scenarios.

## IPC versus actual interaction

The inspected host calls `saveWorkflow`, `openWorkflow`, `runPipeline`, status and `quitApp` through `executeJavaScript`→the real preload IPC API. It supplies explicit file paths. ENOSPC is a controlled same-process `fs.writeSync` partial-stage fault, not actual disk exhaustion. Cancellation uses the existing `__forceCancel` API path, not an OS dialog.

The host does show/focus the real owned window and send mouseDown/mouseUp to the observed enabled **Close without saving** confirmation button. Both phase pointer receipts, button coordinates and renderer state are preserved. This is the only pointer reachability demonstrated. The renderer still displays its initial unsaved default graph; the separate configured workflow is saved/opened/run through IPC. Thus no toolbar Save/Load/Run, authoring, keyboard, OS file-dialog, saved graph display, or ResultHistory visual qualification follows. There are no screenshots in these cohorts. Desktop-v2 contains two GPU error lines; a clean-console or rendering claim would be unsupported.

“All children closed” covers the actual fork handles captured by the instruments. It is not a census proving absence of all Chromium descendants or any foreign/global process. Successful desktop parents exit normally through the requested close flow; worker SIGKILL cleanup is explicitly recorded rather than described as graceful worker exit. Crash/cancel is requested immediately after dispatch; the saved proof does not establish that a long DuckDB query was already executing when interrupted.

## Source composition, Save and label boundaries

`provider-composition-v1/RESULT.json` lists exactly eight composed backend files. Every current desktop/provider pair has identical bytes matching those pins, also present in desktop-v3 custody: Runner, compiler, worker, export identity, registry bridge, receipt, envelope and registry. `provider-composition-closure-v1` adds exactly five dependencies—four existing adapter modules plus chart core—byte-identical to desktop. This is source composition/dependency closure, not adoption by the catalog service, existing durable authority or actual UI Builder.

Desktop-v3 custody binds main `2085324dce849715b2f757a8fe8d39a982803bee1c104200eaef78f491d908b1`, Save helper `f1f992052aa6f8265117fae9e2292aaaa0b2126a69571ecbb33af5a7fcb1e862`, and ResultHistory `dc8d5b102404775dcb213078c19038a17913005b2566754bf7187b931e88ae3b`. This renews the finite native actions on those bytes. The separate same-inode adversary belongs to the other reviewer's file/handler controls; it was not exercised as a new native scenario here and is not accepted from this audit alone. Desktop-v2's older Save candidate remains historical.

The separate `history-export-label-v2` tool/report was read: five pure label cases and exact normalized surrounding-source comparison, with async handlers unchanged and legacy preview branch preserved. Its source pin matches desktop-v3 custody. This supports the narrow wording distinction between execution-bound exports, current-file-not-rechecked and legacy-unbound references. It is not a mounted React or visual interaction test.

## Preserved failures and custody limits

- Engine-v1/v2 each stop after two functional records with `MEASURE_TYPE_INVALID`; their broader runs did not complete. Engine-v3 lacks a final result; engine-v4 retains ten functional records followed by close timeout after explicit parent disconnect. A SIGTERM exit without close is **incomplete closure**, not an orphan-process allegation. The separate minimal host Node ordering observation remains distinct from final crash/EOF cases.
- Desktop-v1 preserves four pre-Quit observations but has no final result, parent-exit receipt or reopen phase. Desktop-v2 completes two parents with 4/2 records but predates final Save and full source custody. It does not qualify final bytes by inheritance.
- Provider-v1 fails module resolution before any worker due to missing adapter dependency. Its return code 1, unchanged source custody and error log remain preserved. Provider-v2 is the fresh successful dependency-closure cohort.
- Earlier v5/v2 had weaker execution-time source binding; final v6/v3/provider-v2 supply the missing captures. All final BEFORE/AFTER copies were checked for exact membership, regular files, bytes and hashes, not merely trusted flags. Before/after custody does not prove no adversarial transient mutation/ABA during execution or authenticate authorship.
- The producer's private COPY target is renamed into its public destination; its former stage path is not a retained full-file snapshot. The first reader wrongly assumed those paths remained readable and preserved 8 passing/4 failing checks at `readback-v1/RESULT.json`. That is a reader assumption failure, not a product finding. The corrected reader checks published files where still available, registry/Chart bytes and producer metadata; it does not invent historical B file bytes after later replacement.

The current captured engine test asserts case count and selected outcomes; several broad labels have weaker original assertions (Chart originally only nonempty-file, JSON only producer size). This audit strengthens their **saved** finite readback as described above. It does not widen crash timing, general concurrency, rendering, offline, arbitrary datasets, 120M volume, Docs UI, package/install/runtime-migration or release scope.

## Exact evidence pins

| Artifact | SHA256 |
|---|---|
|Root engine-v6 RESULT|`d91c8d11791dea854a64a7bdeb8ddc630277f5552a01b53efcfb84902dce009d`|
|Root desktop-v3 RESULT|`5e64582b6b233447f7466ed66fb619d6fd0cd3d2ae6bd215ff5eb07939b3fb27`|
|Root provider-engine-v2 RESULT|`2d8a2da6a8bc502fe653fa36b534aecc273a6ee00810784517d14c85dfd6e3c0`|
|Engine-v6 BEFORE=AFTER manifest|`36bbe131ccf2f9c4f1d8eed7d03844f3d5e098f2dedcc0e02322a8d25a141bfe`|
|Desktop-v3 BEFORE=AFTER manifest|`c7ca694e62de975805c5fc2cd4600e56b7f1ecde95bfa132a41c47e90e057a5a`|
|Provider-v2 BEFORE=AFTER manifest|`210ba15282586ee64e5ebe63d9eaef91fc714901c358be4295d82d1cd90cd6d2`|
|Final independent reader|`b93a5c7b1b28771f13dff90991e2d129bc9f747c2156a9c73f357fab46785184`|
|Reader engine-v6 result|`9a204e585eec57c92a0dfb50f320dc55a3611d6acd9abf4d555f8f97826829e0`|
|Reader provider-v2 result|`beec3d9453fe88a3036f46f18fc68c91448c62950ed08cbebd9c3789d6f3ef6d`|
|Preserved initial reader result|`33d74a76cb88f18bb2f9520bdb5fabb393f0d969c91278e077153decc4015331`|

Both final reader result files include the complete input pin inventory and an executed-checker copy. No native/GUI replay was performed by this reviewer; separate qualified source review remains responsible for accepting the implemented fixes.
