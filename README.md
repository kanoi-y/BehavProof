# BehavProof

Canonical public repository: [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). This repository owns the implementation, tests, examples and product CI. [pdd-ts](https://github.com/kanoi-y/pdd-ts) is an application used to evaluate BehavProof; it consumes a pinned BehavProof commit and does not host this product's source tree. See [repository boundaries](docs/repository-boundaries.md).

TypeScript and Node.js 24 evidence auditing for Vitest, Jest, and Quint specifications. Earlier issuer-bound protection runs were recorded on an isolated pdd-ts branch. The published preview uses the `next` channel. See the publication status and exact source commit in [GitHub Releases](https://github.com/kanoi-y/BehavProof/releases).

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

Version0.2.0 also provides `behavproof test` for local execution:

```sh
npx --no-install behavproof test
```

The command runs the project-installed Vitest or Jest and returns the runner's exit code. For Vitest it writes `.behavproof/input/vitest.json` and `.behavproof/input/vitest.json.receipt.json` by default. The receipt binds the native report to the runner version, invocation, suite inventory and test inventory. Configure `reports.vitest` or `reports.jest` to select a destination inside `.behavproof/`. Existing runner configuration and test files execute through the selected runner.

`test` supports `--root`, `--config` and `--runner jest|vitest`. With both runners declared, select one explicitly or set `testRunner` in configuration. It is an explicit execution command, separate from audit/gate verification. A successful local test run does not authenticate reports or establish approval authority. To inspect the generated evidence afterwards, run `behavproof check --mode audit` with the intended Git base.

Version0.2.0 remains an npm public preview on `next`; pin the exact published version. Jest support described here is unreleased.

Exit codes: audit normally 0 even when evidence fails; gate 0 only for a complete pass, 1 for mandatory fail/unknown, 2 for invalid configuration, malformed evidence or infrastructure errors. `doctor` returns 1 for unsupported detection and 2 for invalid configuration. Gate requires an explicit external root:

```sh
behavproof check --mode gate --trust-root /opt/behavproof/trust-root.json
```

The trusted invocation must pin that path and the verifier outside the candidate repository. A PR-owned workflow choosing its own arbitrary root is not a trust boundary. See [trust bootstrap](docs/trust-root.md) and [security assumptions](docs/security.md).

The Collector in `@behavproof/adapter-reports` seals native runner reports and invocation receipts. For projects that adopt Quint, the gate separately evaluates configured invariants, Witness reachability, implementation conformance, and approval of the selected specification revision. See [形式検証の導入手順](docs/formal.ja.md) and [Jest の導入手順](docs/jest.ja.md).

The CLI package includes versioned JSON schemas, policy presets, and workflow templates. Use `schemaVersion: 2` for `behavproof.config.json` and profile version 2 for protected policy files. Use `ci plan`, `ci enroll`, and `ci verify` to set up the independently protected host.

Development packaging checks use `node scripts/package-smoke.mjs --online` for registry dependencies or `--offline` with a seeded cache. Add `--formal` to include the formal adapters and `--jest` to verify native reports and invocation receipts from installed Jest 29.7.0 and 30.5.2.

Protected GitHub integration: [日本語の導入・検証手順](docs/protected-github-deployment.ja.md) and [実地検証結果](docs/github-live-validation.ja.md). The separate [enforcement probe](examples/enforcement-probe/README.md) has an explicit proposed policy and does not alter the approved critical example.

[Actual PDD acceptance experiment](docs/pdd-adoption.md) runs all64 six-condition inputs on PDD's real production predicate, then verifies fake callbacks, an actual always-accept fault and coordinated test/implementation weakening. Product CI and scoped runtime observations remain separate from human approval and live issuer-bound enforcement.

See [schema compatibility](docs/schema-compatibility.md), [evaluation snapshots and historical replay](docs/evaluation-snapshots.md), and [measured adoption footprint/CI time](docs/pdd-adoption-cost.md). Console/Markdown reports show each target and action; JSON additionally retains policy comparisons and normalized authority observations.

Initial npm distribution preparation: [日本語の公開・タグ・Release手順](docs/releasing.ja.md) and [配布前セキュリティ点検](docs/security-review-2026-11-15.ja.md). The owner approved initial public publication on the next channel; the helper enforces this policy and refuses to change an existing private package to public. Public GitHub source does not imply an open-source license.

Version0.2.0 also adds [condition-scoped assurance](docs/assurance.ja.md): `assurance discover|run|map`, state/effect observations, seeded properties and model replay, static import boundaries, observed journeys and relevant fault sensitivity. Current authenticated reports and independently pinned verifier source semantics are required for adopted condition gates. Run `node scripts/assurance-flow.mjs` after building for a real consumer/Collector/local-host acceptance example; this does not establish live external protection.
