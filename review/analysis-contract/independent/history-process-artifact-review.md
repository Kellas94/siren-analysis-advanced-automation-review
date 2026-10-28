# Independent metadata-process artifact and final packet gate

**ACCEPTED IN THE FINITE SCOPE BELOW.** I independently inspected Root's retained `evidence/process-v1` metadata-child executions, physical files, configs, phase markers, logs and closure receipts. The reader passes seven bounded groups and eleven corruption refusals. This is retrospective independent artifact review, not an independent process rerun. I launched no metadata child, provider, SQL, engine, native app, RPC or browser. All new writes are under this lot's `review/`; product and peer files remain untouched.

The already separate current source/model and RPC reports remain unchanged. Their counts are not pooled with these process probes. The process probe uses actual `DirectoryHistory` with a deliberately small typed metadata-entry validator. It does not import the Analysis provider or validate complete real workflow/catalog semantics in a new process; those are covered separately by source/store and RPC gates. It does not establish power-loss durability, Windows directory fsync behavior, an external history authority/signature, global process absence or UI Builder adoption.

## Captured producers and source identity

I read `scripts/fs-writer.mjs` (5114 bytes) and `scripts/history-process.mjs` (16734 bytes), then their exact captured executable copies and the actual Store phase/publication route before writing the independent reader. Original and captured bytes match:

| Captured source | SHA256 |
|---|---|
| history-process.mjs | `f7284edaf8d3a28a4d444c68cf00b3657d2cd227c1ef58558d9aa46960866ed0` |
| fs-writer.mjs | `3f8e613cccee095da13f565b0b12408fd2cbbfcce7cf8e837f5633a3e10f0c70` |
| publication-store.mjs | `53dc5bb2d94a677ace57f50ada422c6f5b53a0fbb791dbc4ee6935ffd6b12618` |

The proof logic executes from the captured `executables/history-process.mjs`; spawned workers require their actual path to equal the captured own `executables/fs-writer.mjs`. Configs have an exact bounded shape, own root/directory/marker/release/receipt paths and all three source hashes. The only non-builtin worker import is the captured DirectoryHistory module. The driver's only children are the captured workers, launched without a shell, with hidden Windows windows. Stops are applied through captured live `ChildProcess` handles. No name-wide or PID-search kill route is present.

Root's process RESULT is explicitly helper-author/Root-operated, operator PID56300, Node v24.16.0. The three-source pin receipt agrees with current originals and captured files. Runtime version is retained in the driver/worker receipts; this gate does not independently hash the external Node binary. Root reported the approved host exited0; my conclusions below rely on the retained child close events and physical readbacks, not on a kill call's Boolean return or an author PASS count alone.

## Exact cohort and closure

The independent reader requires exactly these ordered named groups: `BEFORE_LINK_STOP_CONSERVES_ACK`, `COMMITTED_STOP_COLD_RECOVERY`, `TWO_WRITER_CONFLICT_REFRESH_RETRY`. Each standalone group-result must equal the corresponding full RESULT record. The RESULT has `allClosed:true`, no unexpected recovery cleanup, no pin error and all three statuses PASS. These summaries are corroborated below.

| Child | PID | Observed close | Outcome |
|---|---:|---|---|
| before-link-writer | 67012 | SIGTERM, code null | stopped at before-link, no ACK receipt |
| before-link-cold | 54988 | 0, signal null | READ |
| committed-writer | 67364 | SIGTERM, code null | stopped at committed, no ACK receipt |
| committed-cold | 55692 | 0, signal null | READ |
| race-a | 71216 | 0, signal null | CONFLICT / HISTORY_CONFLICT |
| race-b | 46324 | 0, signal null | ACK |
| race-refresh | 2540 | 0, signal null | READ |
| race-loser-retry | 70200 | 0, signal null | ACK |
| race-final-cold | 66940 | 0, signal null | READ |

All nine PIDs are distinct, each has a separate `closeObserved:true` exit file, and all have `spawnError:null`. Seven children close normally0; two deliberate owned stops are SIGTERM and stay classified as stops. Neither stopped writer has a manufactured normal receipt or a release file. The source-pin/config hash/writer ID/PID in each marker or receipt matches its exact config and separate exit. Stdout phase/receipt events are independently checked against the intended phase order; no unexpected worker stderr was retained. Child completion order may differ for the concurrent writers and is not silently forced into launch order.

## Before-link stop: acknowledged state conserved

The actual Store calls `stage-flushed` only after exclusive stage creation, full write, fsync and close. It then calls `before-link`, before the later head refresh, unchanged-stage-byte check and exclusive hard-link publication. The worker synchronously writes its phase marker and waits at that callback. The captured stdout contains only stage-flushed and before-link before the owned stop.

The before-link marker binds writer67012 to the expected seed head and exact config. The driver recorded SIGTERM requested at `2026-10-28T19:57:31.679Z`, returned true, and subsequently observed the separate SIGTERM close. No normal worker receipt exists. Thus the observed boundary is a completed staged write before link, not an arbitrary earlier process failure.

Physical `commits/` contains only000001, exactly the originally acknowledged bytes/hash. The cold reader54988 returns that same head and the one-entry `base-ack` state. Both stage files remain byte-identical to the pre-stop inventory: the seed's linked stage and the uncommitted candidate containing `pending-not-promoted`. Independent parsing confirms the candidate is a valid sequence2 record with the seed parent digest and the exact requested two-entry state, but it is not in committed history. PendingStages is1, not the total stage count2. Nothing is auto-promoted or deleted.

## Stop after commit, before ACK: cold recovery

Store `committed` occurs after the exclusive hard link succeeds but before validated readback and return of the commit ACK. The second writer's stdout records stage-flushed, before-link and committed. Its marker/expected seed head/config/PID agree. The driver recorded its own SIGTERM at `2026-10-28T19:57:31.849Z` and a subsequent actual SIGTERM close. Again there is no normal ACK receipt and no gate release.

Physical commits000001 and000002, and both stages, equal their pre-stop inventories. Independent record digest/authority/parent/sequence/canonical-byte checks pass. Cold reader55692 returns sequence2 and exact `base-ack`, `linked-before-ack` entries, matching the interrupted writer's intended config. PendingStages is0 because both retained stage byte hashes are represented in committed history. This proves the named actual link-before-ACK process boundary and cold recovery; it does not convert the interrupted writer into an acknowledged normal exit or prove a power interruption case.

## Two actual writers, conflict, fresh retry

Race-a71216 and race-b46324 both reach the before-link gate in separate OS processes with the same expected seed head. The marker source/config/PID identities are exact. Their staged candidate records are distinct: one appends race-a, the other race-b. Before release, all three existing stage files are inventoried. Both configs point to the same retained `race-release` file, whose physical content is exactly `release\n`.

After release, exactly one worker records ACK and exactly one records HISTORY_CONFLICT. Here race-b wins; race-a loses. Both close normally0 because a handled, explicit conflict is an expected worker outcome. The winner acknowledges sequence2; refresh child2540 opens the physical store and returns the exact winning head/state and one still-pending losing stage.

Retry child70200 is a new process with the refreshed sequence2 head. Its config appends the actual losing race-a entry to `base-ack`, race-b. It ACKs sequence3. Final cold child66940 returns the exact three-entry state and sequence3. Independent physical chain validation requires that exact order and typed payload, not only a coherent digest. The previously acknowledged000001/000002 hashes remain conserved,000003 matches the retry ACK, and every pre-race stage remains exact. The losing candidate stage stays present and uncommitted; the new retry adds a fourth stage that matches000003. Final pendingStages remains1 rather than4.

There is no lost acknowledged entry, replacement version, overwrite, duplicate ACK or hidden winner selection in these finite artifacts. This is a single observed two-writer race plus loser refresh/retry, not an unbounded concurrency or filesystem stress claim.

## Physical and typed metadata checks

The reader independently opens every committed and staged file in all three group directories. Ordinary-file/no-reparse checks are applied. Commit names must be contiguous. Bytes must be canonical JSON plus newline; protocol, authority/body hashes, sequence and parent chains are recomputed. Final commit chains must match the independently fixed intended entry order. All entries preserve exact string `00120`, BIGINT-like string `9007199254740993`, DECIMAL-like string `9999999999999999999999999999.1234567890`, empty text, NULL and Boolean false. These are metadata preservation checks; they do not execute SQL DECIMAL/BIGINT operations.

Each group's current physical inventories equal its saved final inventory. The before/after-stop and before-race inventories conserve all prior ordinary file bytes. Pending stages are independently counted by whether the stage's actual byte hash already occurs in the physical committed chain. This prevents conflating retained linked-stage files with unpublished pending payloads.

## Deliberate fail-closed controls

The independently authored reader passed eleven in-memory negative controls, leaving all original evidence untouched. For semantic chain controls, digests and downstream parents are recomputed so failure is not merely a stale checksum:

- changed exact decimal metadata, Boolean false becoming text, and empty becoming NULL;
- omitted losing acknowledged append and swapped winner/loser order;
- treating the uncommitted stage as a promoted cold commit;
- relabeling an actual controlled committed stop as normal0;
- relabeling before-link as committed or substituting another child PID;
- relabeling losing CONFLICT as ACK without the actual committed phase/receipt;
- silently replacing an acknowledged pre-race stage hash.

This is an oracle-sensitivity check of the finite retained evidence, not another actual filesystem fault run. The actual Store FS injection/semantic source-path red/green remains the other independent reviewer's scope. No new product defect was found here.

## Final467 application packet identity

I compared both whole application manifests `identity-beforebrowser1` and `identity-afterbrowser1`, then independently enumerated the actual declared application/native/consumer/startup scope. Membership and every ordinary file's bytes/hash match exactly: **467 files,64,303,151 bytes**, roster SHA256 **`93ac0baf3f24b0d1acaeb9947fee3b12f1fb385f82b640e72202fd59093a4a1b`**. The two manifest files are themselves byte-identical. Provider, reference-consumer, legacy-consumer and workbench trees include their actual complete files; named root fixtures/package/startup files are also covered. Reparse entries in that scope are refused.

All466 members of the earlier RPC packet remain exactly unchanged. The sole later application member is `scripts/browser-history-server.mjs`,8250 bytes, SHA256 `dab5f240a6411ef270816b167f47838384face354c525a1a58c040522c3cb1df`. The native/RPC cohort does not import that later browser startup. Its addition does not invalidate the unchanged466-member RPC source identity or retroactively make browser evidence part of the RPC cohort.

All464 accepted donor rows were freshly rehashed at the original `analysis-count-contract-v1` location and remain unchanged. Relative to that donor the final packet has three additions (history-state, publication-store and browser-history-server), three changed existing files (provider, transport, bootstrap), and no removals. The metadata process QA scripts and their captured executables are separate source-pinned tooling evidence rather than claimed application members; their own exact hashes are listed above.

This final packet observation supports the current source-ready-v3 pins, not superseded47cc/e1dd bytes. It is an identity/bookend gate, not independent browser interaction, native runtime compatibility or installed/main integration qualification.

## Scoped process observation and boundaries

I read `process-observation-v2.json`: Root's read-only observation at `2026-10-28T19:58:26.5241066Z` reports797 observed processes,180 unavailable command lines, no visible matching own-stage Node/Electron/Edge runtime, and no matching retained known own PIDs. This is Root's retained aggregate observation, not a reviewer-executed census or a complete independently reconstructable process table. Unknown metadata and possible PID reuse remain explicit limits. It supports no global absence claim.

`process-observation-v1.json` contains zero observations after the reported default-context CIM denial. PowerShell continued to write that file. It is **INVALID as absence evidence** and excluded. The later successful aggregate does not erase that failed tool attempt. The actual child closure table above has its own receipts and does not rely on the invalid zero file.

The accepted scope is exact captured metadata-process interruption/concurrency artifacts plus final packet identity. The already reviewed source/model/RPC gates remain separate; browser old-form Save/Open is still its distinct artifact gate. No new execution, process kill, Windows policy change, original input edit, cleanup, provider API administration, formula, UI Builder-owner mutation, Docs/Charts/Electron/main change, merge or release was performed.

## Review artifact pins

| Artifact | Bytes | SHA256 |
|---|---:|---|
| independent process reader v1 | 20028 | `1f08409286142336da3e408e424de0c0cc37f55ad1f427f76c4b57d92db66769` |
| independent process reader RESULT | 6064 | `ac6121b65a389165bc5f253c5d875f4ddd70fd7dc102daf9d56045892a4fec67` |
| author process RESULT | 32502 | `4d35677e97a57a930c65804521496e1d7e911173c34118577d35e1a3dbedc914` |
| process SOURCE_PINS | 1440 | `d50e4cddb90ab935f86fb9d945a8a3c04cf9c702f1cb3986c63a0925ef4428cf` |
| before and after browser application manifest, each | 102245 | `d123b73b2d28782977efa2b894c9813150f4bfb4b4bc864119e278fb5f782697` |
| bounded process observationv2 | 337 | `2af5ed9864edee8bd0287cab6a9c370a63c3ebe3cfcf051e05bacd24f1306318` |
