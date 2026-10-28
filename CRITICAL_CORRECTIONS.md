# Critical review corrections

An interrupted save could destroy the previous workflow; worker failure could leave its caller pending; a missing source could read a different same-named file; and a later export at a shared path could be attributed to an older job. This branch corrects those four findings from reviewed commit `091c0e7da78e5cb2586747febf1ef308aa80377c`. It also preserves admitted `__proto__` node output through JSON.

| Finding | Resulting behavior |
| --- | --- |
| DESKTOP-SAVE-TRUNCATION-001 | Exclusive same-directory staged write, flush, identity/content checks and one rename; tested precommit failures preserve the previous saved file. |
| ENGINE-001 | Each request belongs to its job and worker generation; failure settles that caller before queue advancement. Late old-worker frames cannot settle the new request. |
| DESKTOP-SOURCE-FALLBACK-001 | Resolve the exact relative source against explicit dataDir. Missing subpaths fail execution instead of silently selecting a basename. The two starter input paths match the actual historical dataDir layout. |
| EXPORT-EXECUTION-BINDING-001 | Native COPY writes a unique private target; producing identity is retained before publication. Later capture verifies that identity instead of attributing current replacement bytes to an old job. |
| ENGINE-002 | Null-prototype per-job output storage retains special admitted IDs as own JSON keys. |

The export producer, source/view/count, actual COPY/query hash, public destination and private producing path remain distinct. Current-file verification observes a single opened file and checks its identity/content revision around hashing. Old sealed observer-only results retain bytes/resultId/integrity; their effective verification status is `LEGACY_EXECUTION_UNBOUND`. History labels distinguish retained execution linkage from current-file verification.

The matching backend changes are selectively composed into the separate common-provider engine. Five unchanged adapter/Charts dependency files complete its historical source-only bridge closure. This does not integrate the actual UI Builder designer, publish a new catalog authority, migrate saved pins or rewrite durable histories.

## Validation and independent review

The correction gates are **accepted in their bounded scopes**. The whole candidate remains **conditional**, with the P2 items below still open. Author checks, independent source/file checks, operator native executions and retrospective artifact review are separate evidence, never one summed test count.

| Cohort | Observed scope |
| --- | --- |
| Independent runner/compiler review | Twelve source/transport/path groups and five rejected mutants; fake children, no SQL execution. |
| Independent save renewal | Seven actual own-file/whole-main VM cases plus one rejected content-guard mutant; separate six history/callback models. |
| Independent export renewal | Twenty actual-file/model observations; contradictory producer/receipt fields, during-read replacement and legacy preservation. Five pure label-expression cases; no mounted UI claim. |
| Operator native-engine-v6 | Ten native Node/DuckDB/worker/export/registry/Charts cases: actual replacement, typed COUNT70 over source90, JSON/Parquet/zero CSV, missing exact path, special ID, actual own-worker crash, cancel and retry. Three captured children closed. |
| Operator native-provider-engine-v2 | Separate ten-case native backend cohort in the common-provider copy; all captured children closed; complete247-source before/after identity matched. Not catalog service or UI Builder runtime acceptance. |
| Operator native-desktop-v3 | Save phase four records; new-parent reopen phase two records. Actual preload IPC Save/Open/Run, injected own-stage partial-write failure, retry, physical843-byte workflow, normal parent Quit35976→new parent61856, exit0/null and both own worker close receipts. Actual pointer confirmation on the renderer's close dialog. |

The desktop graph displayed in the renderer remains its initial graph; the saved test workflow is supplied through real preload IPC. This is **not** toolbar Save/Load, OS file-dialog, displayed edited workflow or visual fit qualification. Native desktop uses owned Electron44.9.3/embedded Node24.22.0; native backend/orchestrator uses Node24.16.0. This does not qualify the separate SIREN Electron migration.

Exact application source, generated renderer, native dependency and whole owned runtime manifests are kept separately. Current source membership is247 files (desktop161/common86). The old239-source manifest and original drift inventory remain preserved beside their current versions. Native packages, profiles and raw local execution evidence are not uploaded. The historical reviewed339-file donor remains unchanged.

Portable CI runs `node review/check-source.mjs` and `node review/critical-regression.mjs`, without installing application dependencies. The latter has six actual-file/explicit-model smoke groups and is coordinator-authored regression evidence, not independent fix acceptance. Reports in `review/critical-fixes/` disclose reviewer ownership and bounds. Raw local evidence and failed attempts remain in their distinct named cohorts.

Preserved nonpassing attempts include the native harness's initial numeric-looking VARCHAR measure refusal; parent-initiated disconnect close-accounting timeouts; an initial desktop close dialog not confirmed by the harness; the provider's missing adapter import before closure composition; and verifier loader/oracle/quoting errors. None is pooled into the current passing cohorts or hidden by rewriting an earlier result.

## Remaining work and limits

- Analysis P2: imported shape validation; same-job reversed polling; contradictory terminal/result wire frames; signed/unsigned small-integer wire bounds. Preserve these original findings for the next isolated correction stage.
- Visual Builder-owned: split UTF-8 in UI-Python output and optional/defaultless widgets inventing values. Findings were transferred to the owner; its sources remain untouched.
- The historical packager's helper/module closure is not qualified by this source-host proof. No new standalone desktop release/package, installation, merge or main integration is performed.
- Per-export publication is not a transaction across all workflow outputs. No power-loss/directory-fsync, real full-disk, hostile final-check-to-rename race, arbitrary concurrent-writer, broad offline or120M-operation guarantee is claimed.
- Mutable source/export files may change after observation. Saved snapshots remain distinct, large data stays in the engine, and saved results are not silently synchronized to current files.

Terminal, migration, installed/main SIREN, other owners' sources, real user data and Windows policy are outside this branch. GitHub is a dedicated public review repository authorized by the user; this correction PR is for review only.
