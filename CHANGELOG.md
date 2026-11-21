# Changelog

## Unreleased — Quality diagnostics and protected CI onboarding

- Add `behavproof doctor --quality` for versioned static quality diagnostics over the `quality-baseline-v1` policy (ESLint/Biome rules, TypeScript strict, test discovery and settings), with exit codes 0/1/2. `doctor` stays read-only and never imports project configuration, runs package scripts or downloads packages; dynamic or unresolvable shared configuration is `unknown`, never pass.
- Add `behavproof ci plan|apply|enroll|verify` for deterministic protected-CI onboarding of single-package Vitest/Jest projects. `plan` lists unresolved choices, `apply` pre-checks every destination, rejects conflicts and links and is idempotent, `enroll` records the reviewed deployment outside the repository, and `verify` compares the registration with remote GitHub state read-only. A generated plan does not establish protected CI; App, environment, branch protection and repository variables are configured separately in GitHub.
- Generalize the protected producer/publisher execution into reusable components (pdd-ts samples and tests kept); candidate code runs only in a credential-free container, the publisher never executes candidate code, and the test container is network-disabled with read-only dependencies.
- Add versioned JSON schemas for the quality policy, CI registration and deployment (`packages/cli/schemas/quality-policy.schema.json`, `ci-registration.schema.json`, `deployment.schema.json`).
- Document the flow in [README](README.md) and [docs/quality-ci.ja.md](docs/quality-ci.ja.md). Verification: build clean; 59 new tests pass (3 sandbox tests skipped on root/win32); full serial suite 676 pass, 3 fail on pre-existing root-host sandbox staging rejections unrelated to this branch (see `tests/packages/jest-distribution.test.ts`, `tests/acceptance/sandbox-sdk.test.ts`, `tests/acceptance/staged-sdk-validation.test.ts`).

## Unreleased — Jest support

- Add optional native Jest29.7.0 / 30.5.2 contracts, Circus adapter, reporter, CLI execution/detection/init and protected source/canary observations.
- Bind native/contract evidence to the protected runner and invocation; preserve existing Vitest defaults and package publication scope.
- Verify installed package consumers and original suteco: existing181 tests pass; three measured regressions fail through the standard authenticated Jest gate.

## 0.2.0 — public preview (2026-11-17)

- Add optional revision-bound contract conditions, required checks and relevant fault types, preserving non-adopter hashes and documents.
- Add explicit bounded assurance execution and read-only discovery/map, real state/effect, seeded property/sequence, AST import-boundary and correlated journey observations.
- Authenticate condition reports with the existing Collector/root and independently pin verifier semantics; retain baseline/head obligations and critical fault requirements.
- Add verified review maps/documents, a refund HTTP/file-store example and normal/refactor/negative acceptance flow.
- Update all eight packages and their exact internal dependencies to 0.2.0.
- Refuse reused assurance processes when the transitive module snapshot changes.
- Add `behavproof test` to prepare report directories, clear stale managed reports and run installed Vitest with both reporters in one command, preserving test exit codes.
- `init` now prepares `.gitignore` alongside configuration, adding `.behavproof/` automatically without duplicate effective rules. Existing content and line endings are retained; dry-run previews both files.

## 0.1.0 — public preview

Initial release scope. Publication status and the exact tagged source commit are recorded in GitHub Releases; the preview uses npm’s next channel.

- Eight packages: core, report adapters, Contract registry, Vitest integration, GitHub authority/publisher, CLI, and two optional formal adapters.
- Node.js 24.x and single-package Vitest 5.1.0 integration. Schemas, policy presets and protected GitHub workflow templates are included with the CLI.
- Separate evidence for declared Contracts, executed comparisons, production target calls, same-callback canaries and authenticated human approval. Required missing evidence blocks gate mode.
- Explicit Quint 0.33.1 / optional Apalache 0.62.4 model checks and Driver-based replay, bounded to configured models, sources, properties and traces.
- Fix GitHub API encoded-dot URL normalization escaping the configured repository boundary.
- Inspect real npm archives, enforce package entrypoints and internal versions, pin registry routing, disable lifecycle scripts, and verify publication access and SHA-512.

Passing checks do not prove arbitrary program correctness, honest approved specifications or safe candidate code. Candidate execution needs isolated credential-free workers; publisher credentials and gate App identity require separate protection. See the security documentation and Japanese release/deployment guides.
