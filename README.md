# BehavProof

Canonical public repository: [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). This repository owns the implementation, tests, examples and product CI. See [repository boundaries](docs/repository-boundaries.md).

TypeScript and Node.js 24 evidence auditing for Vitest, Jest, and Quint specifications. The CLI is available on the public npm registry. Install it with `npm install --ignore-scripts @behavproof/cli`. See the release notes and exact source commit in [GitHub Releases](https://github.com/kanoi-y/BehavProof/releases).

The published npm preview is 0.3.1 on the `next` channel. The commands below describe this development checkout, including native runner receipts, version 2 protected registration, and the new `@behavproof/spec-registry` package. Build this checkout to try those changes.

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run build
npm ci --prefix examples/formal-order --ignore-scripts --cache .npm-cache
npm test
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js init --dry-run
```

The root is a development workspace. Run project commands in a single-package target repository, or pass `--root /absolute/project`. Supported native runners are Vitest 5.1.0 and Jest 29.7.0 / 30.5.2; monorepos and other runners remain unsupported. `check` does not execute tests or configuration code.

```sh
behavproof check --mode audit --base origin/main --head HEAD --format json
behavproof doctor
behavproof explain changed-line-coverage
behavproof formal discover
behavproof formal check
behavproof impact --base origin/main --head HEAD
behavproof docs generate
behavproof docs check
behavproof docs --check
```

`init` preserves existing configuration, installs no dependencies and edits no workflows. Since v0.2.0, it also creates or updates `.gitignore` to exclude `.behavproof/`, preserving existing rules and line endings. Re-running init repairs a missing ignore rule even when configuration already exists. Use `--dry-run` to preview both files. Initial mode is audit. Output supports console, JSON and Markdown, with `--output relative/path`. Documents default to `.behavproof/generated/behavior.{md,html,json}`. Use `--output behavior.md` to select one format. Use `ci enroll` on the protected host to register a reviewed configuration.

Run `behavproof test` for local execution.

```sh
npx --no-install behavproof test
```

The command runs the project-installed Vitest or Jest and returns the runner's exit code. For Vitest it writes `.behavproof/input/vitest.json` and `.behavproof/input/vitest.json.receipt.json` by default. The receipt binds the native report to the runner version, invocation, suite inventory and test inventory. Configure `reports.vitest` or `reports.jest` to select a destination inside `.behavproof/`. Existing runner configuration and test files execute through the selected runner.

`test` supports `--root`, `--config` and `--runner jest|vitest`. With both runners declared, select one explicitly or set `testRunner` in configuration. It is an explicit execution command, separate from audit/gate verification. A successful local test run does not authenticate reports or establish approval authority. To inspect the generated evidence afterwards, run `behavproof check --mode audit` with the intended Git base.

BehavProof 0.3 introduced quality diagnostics and protected CI onboarding. `doctor` always reports the static quality diagnosis. Pass `--quality` to base its exit code on that result.

```sh
behavproof doctor --quality
behavproof doctor --quality --format json
```

A passing project reports `Quality configuration: pass (quality-baseline-v1)` and exits 0. The baseline requires the five ESLint rules (`no-debugger`, `no-dupe-args`, `no-dupe-keys`, `no-unreachable`, `no-constant-condition`) at error severity, TypeScript `strict: true`, at least one discovered test, and no `only`/pending tests. A weakened project fails, for example `fail lint.rules: Required lint rules are missing, disabled or below error severity` and `fail types.strict: Strict compiler settings are missing or overridden`, and exits 1. `doctor` is read-only and static: it never imports project configuration, never runs package scripts, and never downloads packages. Dynamic configuration and unresolvable shared configuration are `unknown`, never pass. Zero tests, broad lint exclusions, swallowed exit codes (`|| true`, `--passWithNoTests`) and cyclic npm-script references never pass. `doctor` requires a Git repository for single-package support; exit 2 is invalid input or an infrastructure error.

Generate and review the deployment plan locally. Follow the GitHub provisioning steps in the guide before initializing the registry and verifying the deployment.

```sh
behavproof ci plan --repository OWNER/REPO --branch main --sdk-sha "$SDK_SHA" --app-id "$APP_ID" > plan.json
behavproof ci apply --plan plan.json --dry-run
behavproof ci apply --plan plan.json
behavproof ci enroll --workflow-sha "$WORKFLOW_SHA" --reviewers alice,bob --registration "$REGISTRATION" --pr 12
behavproof ci init-registry --registration "$REGISTRATION" --digest "$REGISTRATION_DIGEST"
behavproof ci verify --registration "$REGISTRATION" --digest "$REGISTRATION_DIGEST"
```

`ci plan` prints a deterministic plan with the quality policy, workflow and deployment file hashes, prerequisites, and GitHub setup steps. The plan lists unresolved choices in `unresolved`. `ci apply` checks every destination before writing and is idempotent. On an independent host, `ci enroll` records the reviewed source, workflow, file inventory, reviewers, and adopted specifications outside the repository. Configure the App, environment, branch protection, and repository variables in GitHub. `ci verify` then compares that setup and the protected registry with the enrollment. Missing permission or an unobserved attribute yields `unknown`. Follow the [日本語の品質診断・保護CI導入手順](docs/quality-ci.ja.md).

Exit codes: audit normally 0 even when evidence fails; gate 0 only for a complete pass, 1 for mandatory fail/unknown, 2 for invalid configuration, malformed evidence or infrastructure errors. `doctor` returns 1 for unsupported detection and 2 for invalid configuration. Gate requires an explicit external root:

```sh
behavproof check --mode gate --trust-root /opt/behavproof/trust-root.json
```

The trusted invocation must pin that path and the verifier outside the candidate repository. A PR-owned workflow choosing its own arbitrary root is not a trust boundary. See [trust bootstrap](docs/trust-root.md) and [security assumptions](docs/security.md).

The Collector in `@behavproof/adapter-reports` seals native runner reports and invocation receipts. For projects that adopt Quint, the gate separately evaluates configured invariants, Witness reachability, implementation conformance, and approval of the selected specification revision. See [形式検証の導入手順](docs/formal.ja.md) and [Jest の導入手順](docs/jest.ja.md).

The CLI package includes versioned JSON schemas, policy presets, and an audit workflow template. Use `schemaVersion: 2` for `behavproof.config.json` and profile version 2 for protected policy files. The enrollment and trust root also use version 2.

Development packaging checks use `node scripts/package-smoke.mjs --online` for registry dependencies or `--offline` with a seeded cache. Add `--formal` to include the formal adapters and `--jest` to verify native reports and invocation receipts from installed Jest 29.7.0 and 30.5.2.

The producer and publisher workflows are generated by `ci plan`. For the evidence flow and isolation requirements, see [protected collection and check publication](docs/protected-producer.md). The [readiness probe](examples/enforcement-probe/README.md) is a minimal native Vitest example.

See [schema compatibility](docs/schema-compatibility.md) and [evaluation snapshots and historical replay](docs/evaluation-snapshots.md). Console/Markdown reports show each target and action; JSON additionally retains policy comparisons and normalized authority observations.

Initial npm distribution preparation: [日本語の公開・タグ・Release手順](docs/releasing.ja.md) and [配布前セキュリティ点検](docs/security-review-2026-11-15.ja.md). The owner approved initial public publication on the next channel; the helper enforces this policy and refuses to change an existing private package to public. Public GitHub source does not imply an open-source license.

Use `assurance discover|run|map` for condition-scoped state and effect observations, seeded properties and model replay, static import boundaries, observed journeys, and relevant fault sensitivity. Adopted condition gates require current authenticated reports and independently pinned verifier semantics. Run `node scripts/assurance-flow.mjs` after building to exercise the flow with a local trusted host. See the [Assurance guide](docs/assurance.ja.md).
