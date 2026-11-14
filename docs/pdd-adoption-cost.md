# Observed adoption footprint and CI time

The actual measurements are retained in [pdd-adoption-cost.json](evidence/pdd-adoption-cost.json), tied to SDK `6b594be5e54cd7caea282ff9ecf215f52577e550` and consumer PR10 head `13c182d97a359b97a8c61a7e026d9e58ef380f4b`. Later source changes require their own validation; these times are historical observations.

| Workload | Observed wall time |
| --- | --- |
| Product Linux job, including Docker validation | 107s |
| Product Windows job | 182s |
| Product macOS job | 97s |
| Sum of the three product job durations | 386 runner wallseconds |
| Existing PDD CI: build/proof/280 tests, demos and installed CLI | 480s |
| Linux container block including staging/pull, other probes and protocol | 46s |
| Actual PDD normal/fake/fault/unapproved-weakening experiments | 3205 / 3075 / 2252 / 3015ms |

The consumer integration adds two workflows and four contract/config/test data files. It modifies zero production files; one separate existing CI-support file changes the root demo's outer time limit and diagnostics. It requests one actual human source review, external enrollment and separately authorized protected provisioning. These are a counted integration footprint, not measured human editing/review time.

## First audit and maintenance measurements

[first-audit-onboarding.json](evidence/first-audit-onboarding.json) records the actual supported `examples/node-api` project in Git. With Node24/Git installed and six built local SDK tarballs already available, the first audit takes five user command invocations:

1. Install the six reviewed tarballs with `npm install --offline --ignore-scripts`.
2. `behavproof init --dry-run`.
3. `behavproof init`.
4. `behavproof doctor`.
5. `behavproof check --mode audit --base HEAD --head HEAD --format json`.

The measured invocations were automated, with each command's walltime and package hashes retained. SDK building/packing and an existing Git/sample checkout are stated prerequisites, not hidden steps in that count. The first audit returns exit0/incomplete: it has generated a report, without claiming execution/approval evidence or a successful gate. Full protected deployment is a separate procedure and is not claimed to take five steps.

The [real PDD experiment](evidence/pdd-acceptance-flow.json) records tracked-file differences from the proposed baseline for maintenance scenarios. The behavior-preserving refactor changes one production file, no Contract file, and reruns all64 cases with the same Contract revision and fresh calls/canaries. A fake callback edits one Contract source; the actual fault edits one production file; coordinated expectation weakening edits both. These automated edit footprints and execution times measure the experiment, not a person's active editing time.

The product jobs and existing PDD job are different workloads and cannot be subtracted to claim incremental overhead. Their API timestamps have second precision, are not CPU usage or billed minutes, and cover one run rather than a distribution. Comparable consumer baseline/added producer/publisher time and human onboarding/change/review effort remain unmeasured. Actual GitHub charges are outside this measurement.

The adoption decision is conditional: continue the scoped real-function integration because it distinguishes real comparisons/calls, false acceptance and coordinated expectation weakening. Keep production L3 adoption and M2 completion open until current human enrollment and issuer-bound enforcement are verified. Full consumer costs and operator effort must be recorded before closing M0-05; the small local/container case durations alone do not establish acceptable total rollout cost.
