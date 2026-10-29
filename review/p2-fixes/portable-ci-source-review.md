# Portable P2 smoke probe — source review

**Suitable for its explicitly bounded eight-group portable smoke scope.** No concrete blocker was found in the inspected test source. Author of the probe: Root/coordinator. Reviewer: p2_review. This is a read-only source/oracle review, not an independent execution or replacement for the separately accepted contract/App gates.

Inspected `candidate/review/p2-regression.mjs`, SHA256 **`c2f1da839d50f805f0d4aefb95d4f1b19f23b15e4e1e23e1c98e140fb65a29ad`**, complete current source, relevant actual contract/copied-consumer/import-helper APIs and workflow context. The coordinator reports a local passing run; this review did not rerun Node, CI, native code, GUI, SQL, child processes or cancellation.

## Actual scope and oracle quality

The probe imports the real pure shared contract, copied consumer and import-shape helper. It installs no application dependencies, never imports App JSX and launches no worker/real interval. Its copied consumer uses an explicit asynchronous provider/close double; all cancellation and active ownership observations are modeled. File reads are limited to comparing the two contract source files. No files/data/evidence are deleted or rewritten.

Eight groups require concrete assertions before recording success:

- Shared/reference contract bytes and public execution-contract version agree.
- Six native signed/unsigned8/16/32 result ranges accept exact endpoints/zero/nullable values and refuse below/above bounds; wide integer/decimal/text/false values retain exact representations.
- Valid unsettled terminal/running states remain pending; final settled success is admitted.
- Contradictory final status/error/identity controls refuse.
- All six actual producer cancellation forms are accepted distinctly.
- Truthy confirmation, foreign job and contradictory worker/confirmation values refuse.
- The actual copied consumer rejects malformed status, refuses malformed cancellation as stop proof, keeps its active owner when owned close is false, then accepts a genuine cancellation retry.
- Pure shape validation refuses the original wrong types/null entries and preserves an incomplete/cyclic structured draft without mutation.

Result corruptions in the direct validator checks do not need a stale-checksum trick: the called validators check semantic fields. The consumer ownership scenario tests a malformed status before result projection. Fixture catalog hashes come from a coordinator-authored canonical encoder. Neither a digest nor these controls authenticates a provider.

The check helper records a pass only after awaited assertions finish. An uncaught failure prevents the final success output. The exact final roster length must equal eight. This is meaningful smoke evidence, but it does not cover every typed boundary, provider-frame permutation, poll ordering, callback/effect interaction or lifecycle case. Those wider independent controls remain separate; no artificial total combines them.

## CI integration and limits

The script uses stock Node APIs and relative module URLs; no Windows absolute paths or native binary imports are required by this route. Source portability is not a claim that Linux/GitHub executed it. At inspection, `candidate/.github/workflows/source-review.yml` still invokes only `check-source.mjs` and `critical-regression.mjs`; the new P2 command must be wired before claiming GitHub ran these eight groups. This is an integration step, not a test-source defect.

No React polling/import reachability, actual service/RPC/native job, real cancellation/process termination, mounted UI/toolbar, OS dialog, physical save/reopen, authority migration, package/install or release qualification follows. Export-stage retention remains OPEN under its separate policy/design work; the smoke probe does not delete or resolve it. Actual UI Builder and Terminal sources are outside this probe and were not modified by this reviewer.
