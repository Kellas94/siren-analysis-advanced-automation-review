# Proposed COUNT catalog delta — review artifact only

Author: Codex `test_claim_review`, read-only evaluator. This is a concrete **proposal**, not a product/catalog edit, publication or independent qualification of the proposal author's own artifact. Only new files under `analysis-count-text-v2/review` were written. No application, build, SQL or provider process was launched.

`proposed-catalog.json` SHA256 **3736a3955c9fb4c69e0f2a7afc58d950ecd5f4e7f3d2d968f67350ade790d5e7** proposes provisional catalog **1.11.0 /70 entries**, from numeric catalog1.10.0 SHA256 `4355a36b6e4829929ae5ebb5a44c1d5303da4b56d763a7055f0d8ac430b7bed1`. The original catalog bytes remain unchanged. `proposed-catalog-checks.json` SHA256 `6ed5970c32199e96d6a6beb865b3b884eef7ec59429948b6e98380602234d678` records exact source pins and construction comparisons.

## Exact proposed delta

Only capability `analysis.count.configure` changes, version **1.0.0 →1.1.0**. All other **69 complete capability objects are canonically identical**: IDs, versions, schemas, defaults, results, invocation/adapters, statuses, notes and source-evidence lists. No entry is added or removed. The top-level catalog version/scope change to identify this proposal explicitly; the catalog schema/contract wrapper is inherited unchanged rather than being silently upgraded to execution contract2.

COUNT configure's closed parameter shape stays `{nodeId,countModel:{version,operation,column}}`. Required fields, nonempty column constraint, operation const/default `count`, model const `analysis.conditional-count/1` and result shape are unchanged. New description/column policy/limits/UI wording admit the exact helper-supported numeric types plus VARCHAR/BOOLEAN; empty text, zero and false count as values, NULL does not. No implicit cast/trim/numeric parsing. DATE/TIMESTAMP/BLOB/JSON/composites refuse. Selection remains required; there is no invented valid default column.

The text evidence field points to the current reviewed source/state scope, explicitly separating native/data/physical gates. Prototype is still IMPLEMENTED locally; common status **IN_CONSTRUCTION** and invocation **renderer-owned-action /endpoint null** remain unchanged. Every one of the70 endpoints remains null. The proposal does not alter COUNTIF one-rule policy or run-input behavior, add COUNTA, rename the count model, migrate old numeric models or replace an old published descriptor under capability1.0.0.

Because the69 other objects are deliberately retained, inherited COUNTIF shared limits still contain the numeric-stage cross-family wording about COUNT. Its own COUNTIF semantics are unchanged. This proposal is narrowly scoped to COUNT configure's behavioral metadata; if Root later chooses an editorial cleanup of another capability, that is an additional explicit metadata/version delta rather than an undocumented change in this artifact.

## Current source and provider boundary inspected

| Artifact | SHA256 |
|---|---|
| Current text Count helper | `5a3523677a2f4aa8b8b3f738d5b29ef74e9bf894a139788bf5861f2abd45dc31` |
| Current CountEditor | `e9df8dacfe17d037333123bffef37098be006f776df3eaa4762b3afb18cf799c` |
| Unchanged actual App caller | `1a583a2e6c54d052addb9925296435dee1ffd149c0b8369dc5936812c9ef9a12` |
| Frozen common provider | `aff0d6da1c2f2f2b0f8a432179ca5bce370e55e7e3839e912f738d7797af1ce0` |
| Frozen contract2 wire | `b52ff1742a87f91450d16d39ec35158f60b7edb9066df95e83a0418a5d6916fe` |
| Copied common consumer | `5bf9da4db35d94df6afce8803e67c49348e024a8b26c5aaaeba370b07e9eca57` |

Actual helper `conditional-count.js` adds shared `isCountColumnType` and still compiles exact `COUNT(quoted column)` with no cast or WHERE. Actual CountEditor uses the same predicate on visible choices and event admission. Source/state report `16dc9fb84f47d2f216a6f917ef7c74ffee842d39b4d2dfbcae9e3e5c679dcef5` covers the new narrow source gate; it does not establish native values/persistence/package acceptance.

Actual frozen provider `provider.mjs:97` supports input/select/filter/join/aggregate/pivot/unpivot/derive/conditional_sum/lookup, **not conditional_count**. Criterion bindings at lines28-29 target structured Filter/Sum criteria. Registered-workflow publication creates an executable descriptor at line128 and a separate version2.0 revisioned catalog at line136. Merely changing this local file does none of those operations. Existing provider, consumer, grants and saved references were not changed; selected provider/contract/consumer pins were freshly rehashed. This is not a new whole459-row requalification or cold-process compatibility run. The previous separate catalog review physically checked that frozen manifest; this proposal does not inherit native acceptance from it.

## User-facing roadmap distinctions to preserve

- Text is already first-class in Lookup exact matching, LEFT/RIGHT/MID/literal new columns, and typed Filter/COUNTIF. The numeric-only COUNT description belongs to the preserved prior base; this proposal captures the explicit text/BOOLEAN widening.
- SQL-style COUNT(column) is not Excel's numeric COUNT. Label its non-NULL policy clearly and include empty text/false/zero. Do not create a duplicate COUNTA with the same behavior. Counting visible nonblank text is a separate predicate, not an implicit trim.
- NULL, empty text, source text `00120`, numeric0 and BOOLEANfalse remain distinct. A display row number is not a source key. Source population, aggregate resultRows1, returnedRows1 and count value are separate facts.
- Lookup is exact/binary with duplicate-match error and unmatched NULL; it is not the full Excel first/last/approximate XLOOKUP. No implicit normalization of identifiers.
- Current typed SUMIF(S) has stricter precision policy than arbitrary numeric SQL: FLOAT/DOUBLE/UHUGEINT measures refuse. Generic Aggregate/Pivot expressions are not equivalent to newly qualified typed formula UI.
- Next practical priorities remain text cleanup/concatenation, typed IF/COALESCE, then COUNTIFS/distinct. TRIM/CLEAN Unicode policy, concat NULL handling, exact averages/rounding, date/calendar/timezone and deterministic ordering need separate contracts and native evidence. No global IFERROR should mask worker/SQL/IPC failures as success.

The detailed research remains immutable in `formula-roadmap-evaluation.md` SHA256 `4b3845e738d735c27b5fdbd12d2e5b0d84764efae90eeb48c1f8abfcb592d514`, with official documentation links in its sources notes. That report intentionally names its older numeric base and is not rewritten as a historical claim that text COUNT was already implemented there.

Root may inspect this proposed JSON as a reviewable next metadata artifact. Adoption, any fresh final catalog identity/gate and common-provider implementation remain separate work; no new approval flow or release is implied.
