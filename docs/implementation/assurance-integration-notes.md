# Assurance integration decisions and remaining verification

This is implementation guidance, not acceptance evidence. Specification v0.6 remains authoritative.

- Authenticate Collector Manifest, Vitest JSON and companion reporter artifact against the same current execution, inputs and external producer identity. Never turn serialized provenance or a project `verified:true` into authority.
- Ambiguous nested/repeated/empty-suite JSON needs the runtime reporter's independent suite/test/file inventory. Do not derive that inventory from the JSON summary being checked.
- Binding expectations come from the reporter's copied pre-execution registration snapshot. Bind it to end-of-run rows with canonical tuple keys and current contract revisions. No human needs to transcribe Vite-transformed callback hashes. Registration and execution observation still do not establish production reach.
- Evaluate every rule in the effective protected policy, including all critical obligations. An absent evaluator, scope, observation or authority stays unknown. Do not let contracts.enabled=false, source exclusion or changed risk erase baseline obligations.
- Core's permitted-N/A checks are structural. The host must obtain allowed reasons from effective policy and ensure every referenced scope/evidence record exists and is verified.
- Mutation score is not individual Intent sensitivity. Stryker test titles or its local numeric test IDs cannot alone establish Contract/Case identity. Require target/case-specific authenticated observations or explicit fault canaries for that separate claim.

## Planned Node API acceptance example

Use a real authorization function and HTTP response checks for owner/non-owner. Observe the production function via an explicit test harness/dependency boundary; keep observation counters and cleanup helpers out of production classes. Describe the exact observed target and the injected harness boundary, rather than claim unmodified production deployment coverage.

A target-specific canary may copy the known baseline into a derived scratch variant, intentionally break authorization, and run the same public contract cases. The canary passes only when the intended case actually executes its comparison and fails against the faulty implementation. A load error, missing dependency, zero tests, skip or unrelated failure is not a detected behavioral fault. Record baseline identity, variant/fault identity, case identity and actual comparison outcome; never label the mutated tree as an unchanged clean HEAD.

The canary harness can itself complete successfully after observing the expected negative result. Collector then seals its structured canary report under the baseline command/input identity. This is distinct from collecting a failed ordinary test producer, which seals no success artifacts.

## External verification

The consumer repository is designated by the user. Preserve its main branch and existing protections. Historical checks from an earlier consumer demonstrate API feasibility only; they do not approve BehavProof code or substitute for a BehavProof gate. Prepare concrete isolated validation branches/PRs after local implementation. Human approval and any security-sensitive protection/credential change require a reviewable exact candidate; do not fabricate approval or silently merge.
