# Protected trust roots

The Protected Quality CI publisher constructs the trust root from the protected enrollment, active specification registry, Git objects, and authenticated producer archive. The root lives outside the candidate Git checkout. Its structure is in `schemas/trust-root.schema.json`.

A version 2 root contains:

- `policy` and `config` for the protected rules, verification scopes and runner selection.
- `sourceCommit` and `specifications` for the adopted source revision and specification identities. Use an empty specification list for a project with ordinary tests only.
- `runner` for the runner kind, version and expected manifest reference. That manifest binds the native JSON and test receipt to the same invocation.
- `inputs` for the protected source inventory, `configPaths` for the exact configuration files, and `dependencyLockPath` when the host selects a dependency lock.
- `manifests` for the selected artifact inventory, command hash, execution ID, subject, producer and authority. The gate independently computes current input, config and lock hashes.
- `formalEvidenceRef` when the protected producer supplies a formal archive. It binds the model reports, reachability and mutation results, traces and replay observations to the same producer. The archive supplies the formal proof bytes that the gate evaluates.
- `assuranceSources`, `assuranceConfigPath`, and `assuranceEvidenceRef` when the protected deployment adopts Assurance. They identify the approved verification inputs, the reviewed configuration file and the authenticated Assurance archive.
- `github` when the host verifies PR transitions with GitHub. It selects the repository, PR, authorized reviewers and required check issuers.

For hosted CI, the manifest authority identifies the workflow, run, attempt, job and artifact. The publisher verifies the archive digest and exact member inventory. Local collection uses an explicit `local` authority and pins the manifest digest at collection time. Both paths validate the evidence against the current Git subject.

Mandatory rules with missing or stale evidence make the gate incomplete. A digest mismatch or a present authenticated failure blocks the gate. A permitted not-applicable outcome requires a current authenticated evidence reference and the exact reason allowed by the protected policy.

See [Protected Quality CI and specification registration](formal.ja.md) for provisioning, reviewing transitions and advancing the registry after merge. The earlier Contract producer and its validation are recorded in [the historical producer guide](protected-producer.md).
