# Formal tool compatibility

M2-F uses two optional adapters. Core contains tool-independent schemas and pure evaluators. A CLI consumer without these adapters can still load, inspect projects and use the existing commands. Formal execution requires explicit installation and configuration.

| Component | Selected version | Role |
| --- | --- | --- |
| Node | 24.x | CLI, isolated replay worker and TypeScript simulator |
| Quint | 0.33.1 | Explicit parse, typecheck, test, run and verify commands |
| Apalache | 0.62.4 | Bounded model checking, separate from simulation |
| Java | 21 | Opt-in Apalache runtime |
| ITF parser | `@firfi/itf-trace-parser` 0.1.2 | Optional replay adapter dependency |
| Community Connect | `@firfi/quint-connect` 2.1.0 | Separate compatibility experiment, not a Core or CLI dependency |

Quint output decoding is version-specific. An exit-zero process without an explicit completed stage/result cannot produce model success. Unsupported versions, tool absence, interrupted execution, backend errors and timeouts remain unknown. Source-bounded parsing of Quint imports requires literal imported files to be included in `modelSources`.

The simulator records the configured invocation seed separately from the selected trace seed in Quint output. These can differ: the checked model-fault example requested seed 42 and selected trace seed 74. Repeating identical model/seed/settings reproduced the same counterexample. Do not compare these two different seed meanings as if they were interchangeable.

ITF compatibility uses `mbt::actionTaken`, `mbt::nondetPicks`, contiguous state indices and the complete declared variable inventory. Arbitrary integers, sets and maps keep tagged JSON representations. Empty, malformed, truncated or oversized traces cannot become success. The replay adapter owns expected-state comparisons and observes wrapped implementation-function calls. A Driver receives action parameters and wrapped functions rather than a callback for asserting success.

The public external Driver interface is `createDriver(implementation)`, returning `dispatch(action, parameters)` and `observe()`. It is intentionally independent of community Connect. The Connect experiment enables actual `stateCheck` comparisons; it checks both a normal implementation and a faulty one. A community runner's returned count alone is not accepted as authenticated conformance evidence. See [experiment](../examples/formal-order/connect-compatibility.mjs) and [observed record](evidence/formal-connect-compatibility.json).

The selected approach adopts Quint with limited scope and retains the small external Driver interface. Community Connect remains a compatibility experiment: its complete output is not substituted for BehavProof's separately authenticated model and implementation claims. Updating either tool requires re-running actual raw-output compatibility, counterexample, observed replay, canary and gate checks.

The protected config retains adopted models, bounds, property/check inventories, source lists, replay minima and report locations. Contract revisions include the model/Driver/property mapping. An independently verified registration must match the real selected source hashes. A fresh successful report does not approve a changed model meaning.

Evidence and reproducible entry points:

- [Japanese setup and verification](formal.ja.md).
- [Full tool → replay → Collector → authenticated local gate](../examples/formal-order/formal-flow.mjs).
- [Optional CI](../.github/workflows/formal.yml), selected only for explicit dispatch or formal-project PR changes.
- [Default packed consumer](evidence/package-smoke.json) and [explicit optional packed consumer](evidence/formal-package-smoke.json).
- [Model fault and deterministic simulation](evidence/formal-model-canary.json).
- [Observed implementation replay and canary](evidence/formal-replay-local.json).

The evidence scope must be read literally. A local fixture host is not an actual human approval or issuer-bound GitHub enforcement observation. A bounded model result is not an unbounded proof. Calls and selected fault sensitivity do not prove a complete or honest Driver, production reach, runtime isolation or coverage of external services. Explicit source lists must include reviewed runtime dependencies; arbitrary dynamic imports are not automatically discovered.

Automation duration, initial tool download, selected model/Driver/implementation line counts and CI job duration are separate costs. None measures human implementation or review time. Cold tool download can exceed a model-stage deadline; pre-provision a verified cache or retain unknown and retry after setup, rather than treating timeout as a clean model result.
