# Capturing and replaying an evaluation

The external host loads the trust root once, fixes the current source/configuration/subject, captures report bytes and obtains normalized authority observations. The report retains the trust-root, baseline and policy hashes in `authoritySnapshots`, accepted and rejected producer/approval observations, and the upstream/protection observations in `pipelineObservation`. Their source endpoints, reasons, values and snapshot hashes identify the facts used by that evaluation. They contain no request headers or tokens. Observations that could not be obtained remain unknown.

Optional host-owned `policySource` names the source repository, immutable commit, policy path, raw source-file hash and parsed policy hash. The reference verifier obtains these from its independently verified registration. The schema checks that the recorded parsed policy hash matches the selected policy. Generic local roots may omit a Git origin; the report then has a null source and retains the external root/policy hashes rather than inventing a Git SHA. These fields describe host-selected provenance; a candidate copying them cannot authenticate itself.

Keep the following together in a private, protected host capture:

1. The pinned SDK revision and installation/lock inventory, immutable Git inputs and tested subject.
2. The exact external trust-root snapshot, policy, baseline, source configuration and command/inventory expectations.
3. Collector manifests, independently downloaded archives and their recorded hashes, and the retained bytes of all evaluated reports.
4. The emitted JSON report, normalized authority observations and an independently captured hash of that report.

For a historical replay, first check the host's independently retained hashes. Reparse the retained evidence with the same SDK, use the fixed approved-target membership from the authenticated host capture when calling the deterministic registry APIs, and keep the captured external observations fixed. Do not derive an approval membership set from a new candidate-owned JSON file. Reconcile the same baseline/head, evaluate the same contract/case bindings and protected policies, then use `evaluateGate(evaluations, mode)` from `@behavproof/core` to reproduce the final decision. A replay that starts with the report's evaluation rows tests only gate aggregation; it does not revalidate source/report parsing or external authority.

An offline historical replay supplies no current GitHub authority. Fresh `check` and reference publication obtain current APIs again, may legitimately differ after an approval/protection/run update, and retain those new observations separately. The publisher re-evaluates the decision and checks the live PR head/base/protection/issuer immediately before publication. A saved report or matching hash cannot be substituted for that live process.

`changeImpact` reports static candidates and unresolved edges, not behavioral equivalence. It reads code only from the hashed inventory and records unavailable/deleted/out-of-scope inputs. Unknown Git or synthetic-merge graph correspondence remains unknown. An independently registered target mapping retains affected Contract IDs even if discovery is indirect. Global/basic defaults are off, standard warns and critical is mandatory; an explicit protected rule can require it more broadly. Protected and declared critical scopes cannot lower it to off. The version1 serialized profiles are unchanged, preserving existing registration digests.
