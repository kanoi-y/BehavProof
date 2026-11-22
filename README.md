# BehavProof

Canonical public repository: [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). This repository owns the implementation, tests, examples and product CI. See [repository boundaries](docs/repository-boundaries.md).

TypeScript / Node.js 24 / Vitest and Jest evidence auditing and executable contract registry. This checkout implements the mandatory M1/M2 libraries and CLI, with issuer-bound protection verified on an isolated consumer branch. The npm release remains a public preview on the `next` channel; publication status and the exact source commit are recorded in [GitHub Releases](https://github.com/kanoi-y/BehavProof/releases). Use an explicit published version when installing.

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run build
npm test
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js init --dry-run
```

The root is a development workspace. Run project commands in a single-package target repository, or pass `--root /absolute/project`. Supported native runners are Vitest 5.1.0 and Jest 29.7.0 / 30.5.2; monorepos and other runners remain unsupported. `check` does not execute tests or configuration code.

```sh
behavproof check --mode audit --base origin/main --head HEAD --format json
behavproof doctor
behavproof explain changed-line-coverage
behavproof baseline create
behavproof contracts discover
behavproof contracts list
behavproof contracts validate
behavproof intent diff --base origin/main --head HEAD
behavproof impact --base origin/main --head HEAD
behavproof docs generate
behavproof docs check
behavproof docs --check
```

`init` preserves existing configuration, installs no dependencies and edits no workflows. Since v0.2.0, it also creates or updates `.gitignore` to exclude `.behavproof/`, preserving existing rules and line endings. Re-running init repairs a missing ignore rule even when configuration already exists; `--dry-run` previews both files without writing. Initial mode is audit. Output supports console, JSON and Markdown, with `--output relative/path`. Documents default to `.behavproof/generated/behavior.{md,html,json}`; `--output behavior.md` generates/checks one format. Generated declarations alone do not prove test execution. A baseline created in the candidate checkout is proposed data until a trusted host registers it.

Version0.2.0 also provides `behavproof test` for local execution:

```sh
npx --no-install behavproof test
```

It prepares `.behavproof/input/`, removes the previous two managed report files, runs the project-installed Vitest 5.1.0 with both JSON and BehavProof reporters, and returns Vitest's exit code. The default outputs are `.behavproof/input/vitest.json` and `.behavproof/input/contracts.json`. A configured `reports.vitest` path is supported inside `.behavproof/`; unsafe links, overlapping outputs and unmanaged destinations are rejected. No packages are downloaded. Existing Vitest configuration and test files execute through Vitest, as with running Vitest directly; use a credential-free isolated worker for untrusted candidate code.

`test` supports `--root`, `--config` and `--runner jest|vitest`. With both runners declared, select one explicitly or set `testRunner` in configuration. It is an explicit execution command, separate from audit/gate verification. A successful local test run does not authenticate reports or establish approval authority. To inspect the generated evidence afterwards, run `behavproof check --mode audit` with the intended Git base.

Quality diagnostics and protected CI onboarding are available in this unreleased source. `doctor` always reports the static quality diagnosis; `--quality` additionally gates its exit code on the result:

```sh
behavproof doctor --quality
behavproof doctor --quality --format json
```

A passing project reports `Quality configuration: pass (quality-baseline-v1)` and exits 0. The baseline requires the five ESLint rules (`no-debugger`, `no-dupe-args`, `no-dupe-keys`, `no-unreachable`, `no-constant-condition`) at error severity, TypeScript `strict: true`, at least one discovered test, and no `only`/pending tests. A weakened project fails, for example `fail lint.rules: Required lint rules are missing, disabled or below error severity` and `fail types.strict: Strict compiler settings are missing or overridden`, and exits 1. `doctor` is read-only and static: it never imports project configuration, never runs package scripts, and never downloads packages. Dynamic configuration and unresolvable shared configuration are `unknown`, never pass. Zero tests, broad lint exclusions, swallowed exit codes (`|| true`, `--passWithNoTests`) and cyclic npm-script references never pass. `doctor` requires a Git repository for single-package support; exit 2 is invalid input or an infrastructure error.

Protected onboarding generates the deployment plan locally, then verifies the remote state read-only:

```sh
behavproof ci plan --repository OWNER/REPO --branch main --sdk-sha <40-hex> --app-id <id>
behavproof ci apply --plan plan.json --dry-run
behavproof ci apply --plan plan.json
behavproof ci enroll --workflow-sha <40-hex> --reviewers alice,bob --registration /outside/repo/registration.json --pr 12
behavproof ci verify --registration /outside/repo/registration.json --digest <sha256>
```

`ci plan` writes nothing; it prints a deterministic plan with the quality policy, producer/publisher workflows, deployment file contents and SHA-256 hashes, prerequisites and GitHub setup steps. Choices it could not resolve are listed in `unresolved` (`runner`, `sources`, `workflowSha`). `ci apply` writes only the reviewed plan, checks every destination before writing anything, rejects conflicts, symlinks and hardlinks, and is idempotent. `ci enroll` runs on an independent host and records the reviewed workflow, file inventory, reviewers and baseline outside the repository. `ci verify` compares that registration with remote GitHub state and reports each observation separately; missing permission, unsupported protection, a missing App ID or an unobserved attribute stays `unknown`. A generated plan does not establish protected CI: the App, environment, branch protection and repository variables are configured separately in GitHub, and `ci verify` reports whether that setup is present. See [日本語の品質診断・保護CI導入手順](docs/quality-ci.ja.md). The new versioned schemas are `packages/cli/schemas/quality-policy.schema.json`, `ci-registration.schema.json` and `deployment.schema.json`.

Version 0.3.0 adds quality diagnostics and protected CI onboarding. Use the `next` channel after publication and pin the exact published version. The optional Jest adapter is available from a source build.

Exit codes: audit normally 0 even when evidence fails; gate 0 only for a complete pass, 1 for mandatory fail/unknown, 2 for invalid configuration, malformed evidence or infrastructure errors. `doctor` returns 1 for unsupported detection and 2 for invalid configuration. Gate requires an explicit external root:

```sh
behavproof check --mode gate --trust-root /opt/behavproof/trust-root.json
```

The trusted invocation must pin that path and the verifier outside the candidate repository. A PR-owned workflow choosing its own arbitrary root is not a trust boundary. See [trust bootstrap](docs/trust-root.md) and [security assumptions](docs/security.md).

Use `@behavproof/vitest` with literal `defineContract` and `contractTest.each` declarations. Add `@behavproof/vitest/reporter` alongside Vitest's JSON reporter, and set `BEHAVPROOF_REPORT` to a fresh output path. The resulting report records registration-time bindings, case comparisons and actual suite/test inventory. Seal both reports with the explicitly invoked Collector API from `@behavproof/adapter-reports`; `check` never reruns them. See [Node service example](examples/node-api/README.md) and [Next-compatible route](examples/nextjs/README.md).

Claims remain separate: declared contracts, binding verification, executed cases, production target observations, mutation sensitivity and human approval. A fake callback can pass comparisons while production reach and sensitivity remain unknown. Global LCOV or mutation scores cannot establish individual contract claims. M2-F adds explicitly installed Quint and model-replay adapters, keeping model properties, observed conformance and approved model meaning separate. See [日本語の形式検証導入・検証手順](docs/formal.ja.md) and [tool compatibility](docs/formal-compatibility.md).

The CLI package includes versioned JSON schemas, basic/standard/critical presets and an internal audit workflow template. The template requires a pinned verifier/root deployment; it does not establish externally protected checks itself. See [acceptance status](docs/acceptance.md) and [M0 experiments](docs/m0-results.md).

Jest support is available in this unreleased source through the optional `@behavproof/jest` package. See [日本語のJest導入・検証手順](docs/jest.ja.md) for native CJS/ESM/TypeScript usage, protected selection and the suteco measurement. Existing Vitest defaults remain unchanged.

Development packaging checks: `node scripts/package-smoke.mjs --online` tests a fresh consumer using registry metadata; `--offline` requires a fully seeded npm cache. Both disable lifecycle scripts and install the six local tarballs without publishing. Add `--formal` to explicitly test the eight-package consumer; Quint and external runtimes remain separately installed in the opt-in project. Add `--jest` to explicitly pack/install the seventh, optional Jest package and test actual Jest 29/30 consumers; ordinary CLI consumers do not install Jest. The existing publication allowlist is unchanged; the new package has not been published.

The explicit [protected producer components](docs/protected-producer.md) add case-scoped production-call observations, same-callback fault probes, live upstream-job verification and a dedicated App check publisher. `node scripts/protected-probe-flow.mjs` exercises the real Collector/worker/CLI path.

[Next-compatible route handler example](examples/next-route/README.md) uses native Web APIs and four executable contract cases without installing Next. Framework server/session/database verification remains an application responsibility.

Protected GitHub integration uses the workflow templates under templates/ and the [protected producer components](docs/protected-producer.md). The separate [enforcement probe](examples/enforcement-probe/README.md) has an explicit proposed policy.

See [schema compatibility](docs/schema-compatibility.md) and [evaluation snapshots and historical replay](docs/evaluation-snapshots.md). Console/Markdown reports show each target and action; JSON additionally retains policy comparisons and normalized authority observations.

Initial npm distribution preparation: [日本語の公開・タグ・Release手順](docs/releasing.ja.md) and [配布前セキュリティ点検](docs/security-review-2026-11-15.ja.md). The owner approved initial public publication on the next channel; the helper enforces this policy and refuses to change an existing private package to public. Public GitHub source does not imply an open-source license.

Version0.2.0 also adds [condition-scoped assurance](docs/assurance.ja.md): `assurance discover|run|map`, state/effect observations, seeded properties and model replay, static import boundaries, observed journeys and relevant fault sensitivity. Current authenticated reports and independently pinned verifier source semantics are required for adopted condition gates. Run `node scripts/assurance-flow.mjs` after building for a real consumer/Collector/local-host acceptance example; this does not establish live external protection.
