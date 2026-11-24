# Shared package interfaces

`@behavproof/core` is ESM on Node 24.x. Its authoritative runtime schemas and inferred types live in `packages/core/src/schemas.ts`; built declarations in `packages/core/dist/*.d.ts` provide exact structural definitions. Later packages must import these types rather than invent another evidence representation. Each persisted format has its own schema version. Configuration, approvals, evidence and gate reports use version 2. Policy presets use profile version 2, while the policy envelope and execution manifests use schema version 1.

## Public exports

Types: `EvidenceStatus`, `Severity`, `Risk`, `Mode`, `RulePolicy`, `Policy`, `Config`, `EvidenceSubject`, `ExecutionManifest`, `SpecificationRegistry`, `Approval`, `Evaluation`, `Provenance`, `Evidence`, `CheckReport`, `ManifestExpected`, `ProducerAuthority`, `ManifestValidation`.

Runtime schemas: `EvidenceStatusSchema`, `SeveritySchema`, `RiskSchema`, `ModeSchema`, `HashSchema`, `CountSchema`, `RelativePathSchema`, `RulePolicySchema`, `RuleIdSchema`, `RulesSchema`, `PolicySchema`, `ConfigSchema`, `EvidenceSubjectSchema`, `ProducerSchema`, `CiIdentitySchema`, `ExecutionManifestSchema`, `SpecificationRegistrySchema`, `ApprovalSchema`, `EvaluationSchema`, `ProvenanceSchema`, `EvidenceSchema`, `CheckReportSchema`, `ManifestExpectedSchema`, `ProducerAuthoritySchema`.

```ts
parseConfig(value: unknown): Config;
parseEvidence(value: unknown): Evidence;
canonicalJson(value: unknown): string;
hash(value: unknown): string;
hashBytes(bytes: Uint8Array): string;
safeRead(root: string, path: string, maxBytes?: number): Promise<Buffer>;
safeReadJson(root: string, path: string, maxBytes?: number): Promise<unknown>;
validateManifest(
  manifest: unknown,
  expected: ManifestExpected,
  artifacts: Readonly<Record<string, Uint8Array>>,
  authority: ProducerAuthority | undefined,
): ManifestValidation;
evaluateGate(evaluations: readonly Evaluation[], mode: Mode): CheckReport;
evaluateThreshold(ruleId: string, value: number | undefined, policy: RulePolicy,
  evidenceIds?: string[], scope?: string[]): Evaluation;
mergeProtectedPolicy(project: Policy, protectedPolicy: Policy): Policy;
mergeEvidence(evidence: readonly Evidence[]): Evidence[];
getProfilePolicy(profile: Risk, profileVersion?: '2'): Policy;
```

`DEFAULT_MAX_BYTES` is 10 MiB. Paths are nonempty scoped relative POSIX paths; traversal, absolute paths, Windows separators, symlink components, nonregular files, oversized files, and observed concurrent file changes are rejected. Invalid input throws; CLI callers map malformed config/report/infrastructure errors to exit 2. Scoped reads are not an OS sandbox against a hostile process concurrently replacing directory ancestors.

`ManifestExpected` requires `executionId`, `subject`, `commandHash`, `configHashes`, and `artifacts: {ref,kind,scope}[]`, with optional `dependencyLockHash`. `ProducerAuthority` is either `{kind:'ci', producer, ci}` or `{kind:'local', producer, executionId, commandHash}`. `producer` matches the manifest producer schema; `ci` includes repository/workflow/run/attempt/job/event identity. `ManifestValidation` contains `artifactIntegrity`, `producerTrust`, `subjectMatch`, `executionStatus`, and sorted `reasons`.

`Policy` contains `{schemaVersion:1, profileVersion:'2', rules:Record<string,RulePolicy>}`. `RulePolicy` contains `severity` and optional percentage `min`, integer `minMutants`, and `allowNotApplicable:string[]`. `Evaluation` follows spec §11 plus optional `notApplicable:{reason,allowedReasons,evidenceIds}`. Hosts derive permitted reasons from the effective protected policy and verify referenced scope evidence. An unpermitted or unsupported N/A cannot satisfy a mandatory rule.

`CheckReport` contains `schemaVersion`, `mode`, `status:'pass'|'fail'|'incomplete'`, `exitCode:0|1|2`, `mandatoryCount`, sorted `evaluations`, and sorted `reasons`. Pure gate evaluation emits exit 0 for audit, and exit 1 for blocked gate. It rejects conflicting rule/scope evaluations and blocks zero mandatory rules. Config/IO errors are exceptions, not synthetic successful audit results.

Evidence supports test, coverage and mutation counts, pipeline checks, approvals, execution manifests, Assurance observations, model-stage reports, trace receipts and implementation replay results. The gate evaluates model checking, implementation conformance and specification approval independently. `mergeEvidence` rejects conflicting records with the same evidence ID.

## Caller trust boundary

The caller supplies `expected` and `authority` from an independently trusted control plane. Never copy authority from the untrusted manifest/report/project configuration. Hashes establish identity; timestamps, self-declared names, attestation references, serialized provenance statuses, and signatures alone confer no producer authority. `parseEvidence` validates structure and preserves claims; it does not authenticate them. Recompute provenance with external expectations before admitting evidence into mandatory evaluations. Missing manifests remain unknown. Dirty inputs fail subject matching; audit may still display their contents. Failed producer execution stays failed despite matching artifacts.

A gate requires an externally registered trust root; absence is a configuration error (exit 2) in the CLI orchestration layer. Approval and protected policy are separate externally obtained inputs; the core never interprets an approved boolean in a report as authority.

## Explicit adapter SDK

Types: `AdapterFormat`, `DetectContext`, `DetectionResult`, `CollectContext`, `BehavProofAdapter` (see `packages/core/src/sdk.ts` / built declaration).

```ts
interface BehavProofAdapter {
  readonly id: string;
  readonly apiVersion: 1;
  detect(ctx: DetectContext): Promise<DetectionResult>;
  collect(ctx: CollectContext): Promise<Evidence[]>;
}
```

Contexts provide explicit inventories and bounded read functions; no command executor or automatic plugin loader is supplied. Hosts explicitly select supported adapters. Core discovery never imports repository test/config code.

## Profile policy version 2

`getProfilePolicy(profile, '2')` returns an independent policy snapshot. `ConfigSchema` / `parseConfig` apply the selected profile's defaults, then merge individual project rule fields; a partial `rules` object does not delete other preset rules. Numeric thresholds remain explicitly configurable. Protected policy merging enforces externally registered numerical floors. These preset numbers are initial examples, not universal quality guarantees.

| Rule | basic | standard | critical |
| --- | --- | --- | --- |
| testResult | error | error | error |
| changedLineCoverage | warn, min 80 | warn, min 80 | error, min 80 |
| mutationScore | off, min 70, minMutants 10 | warn, min 70, minMutants 10 | error, min 70, minMutants 10 |
| pipelineIntegrity | warn | warn | error |
| policyProtection | absent | absent | error |
| changeImpact | off by default | warn by default | error |

Critical preset severities remain mandatory through project overrides. Additional formal requirements come from the protected required scopes and registered models. Every effective rule with unavailable evidence or authority yields an unknown result.

`RuleIdSchema` and `RulesSchema` reject `prototype` and own names of `Object.prototype` (including `__proto__`, `constructor`, and `toString`). Rule maps are checked before record normalization so reserved JSON keys cannot silently disappear. Both project and protected `PolicySchema` inputs and config rules use this boundary.

## Report adapter and explicit collector

`@behavproof/adapter-reports` exports the following (see built declarations for exact structural result types):

```ts
normalizeVitest(value: unknown, inventory?: VitestInventory): { payload: {total:number;passed:number;failed:number;skipped:number}; status: EvidenceStatus };
normalizeLcov(input: string): CoverageReport;
evaluateCoverage(report: CoverageReport, scope: Scope, min: number, nonExecutable?: Scope, mappingVerified?: boolean): {status:EvidenceStatus;payload:{covered:number;total:number;excluded:number;unobserved:number};score:number|undefined};
normalizeStryker(value: unknown): MutationReport;
evaluateMutation(report: MutationReport, scope: Scope, min: number, minMutants: number, sources?: Readonly<Record<string,string>>, mappingVerified?: boolean): {status:EvidenceStatus;payload:{killed:number;survived:number;noCoverage:number;timeout:number;excluded:number;unobserved:number};score:number|undefined};
sourceTreeHash(root: string, paths: readonly string[]): Promise<string>;
gitDiff(root: string, base: string, head: string): Promise<GitDiff>;
gitSubject(root: string, inputPaths: readonly string[], prHead?: string, base?: string): Promise<EvidenceSubject>;
lineMapping(root: string, prHead: string, testedCommit: string, paths: readonly string[]): Promise<'known'|'unknown'>;
detectProject(root: string): Promise<{support:'single-package'|'monorepo'|'unsupported'; evidence:string[]; reasons:string[]}>;
collect(options: CollectOptions): Promise<ExecutionManifest>;
```

`VitestInventory` is `{suiteCount:number; testCount:number; files:readonly string[]}`. `Scope` maps scoped relative POSIX paths to changed line numbers. `CoverageReport` maps such paths and lines to hit counts. Missing records or changed lines count as unobserved; a caller may supply independently verified non-executable lines as exclusions. A zero denominator remains unknown. `mappingVerified` defaults to false and must be true only with independently established report/source line correspondence, including source maps and merge-commit correspondence. `lineMapping` establishes only whole-file Git blob equality between two fixed commits; it does not validate source maps. Binary diff entries have `ambiguous:true`; missing merge-base gives `status:'unknown'`. Deleted files have no new lines and are not automatically a not-applicable decision. Paths outside the validated relative form, invalid counts, and unsupported report formats throw.

Vitest checks internally consistent suite-summary counts, ensures reported file records do not exceed the suite total, and checks test counts against individual assertion statuses; declared suite failures fail; failed suites or `success:false` fail, while zero or skipped tests are unknown. Mutation scores use `(Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) * 100`; CompileError and Ignored are disclosed exclusions, RuntimeError and Pending are unobserved, and unknown statuses are invalid. Zero or fewer than `minMutants` scored mutants and missing scoped files are unknown. Each Stryker file retains its reported source; every scoped file requires exact equality with independently supplied evaluated source and `mappingVerified: true`, otherwise the result is unknown. That flag must reflect independent line-mapping verification, including source maps; matching content does not establish provenance. Appropriateness of exclusions is a caller responsibility. Vitest JSON does not uniquely identify repeated or empty suites. If suite totals and flat file records do not establish an unambiguous flat observation, the result is unknown unless a caller-supplied inventory exactly matches the suite count, test count and file identities; an inconsistent supplied inventory also yields unknown. The inventory must be obtained and authenticated independently through a trusted execution/reporting path, never inferred from the report or a project `complete:true` flag. Even a flat passing observation does not authenticate the report or establish expected test scope; the CLI must verify completeness, scope and provenance independently before treating it as gate evidence. These raw statuses are content observations, never producer authority or evidence freshness. Callers must apply core manifest validation and protected policy before using them as gate evidence.

`CollectOptions` contains `root`, `executionId`, `command`, argument array `args`, explicit `inputPaths`, `configPaths`, existing `outputRoot`, expected `artifacts: {ref,kind,scope}[]`, and `producer`; optional `dependencyLockPath`, `ci`, `prHead`, `base`, and `timeoutMs`. The caller must enumerate all meaningful source, test, config, generated and ignored inputs. A fresh output directory is created as `<outputRoot>/<executionId>` and its absolute path is passed as `BEHAVPROOF_OUTPUT_DIR`; artifacts must be written there. Execution ID reuse fails, nonzero/signal/timeout seals no artifacts, input/config/lock changes reject the result, and timeout defaults to 10 minutes with a one-hour maximum. `collect` runs only the explicitly supplied executable and argument array, without a shell. Discovery and report evaluation do not execute project commands or import project configuration. Detection requires a bounded, scoped package manifest, Git, a declared Vitest dependency, and a test script exactly `vitest` or `vitest run` (allowing surrounding/inter-token whitespace); all other scripts, including missing or complex wrappers, are unverified/unsupported, and reports workspace markers and reasons explicitly. Git disables external diff, text conversion and fsmonitor hooks during analysis. CI identity, tool versions, scope, and the executable selection are caller assertions requiring independent authority. This wrapper is not a sandbox: it cannot prove the absence of transient input changes or prevent a runner/descendant from writing elsewhere. Run it in an appropriately isolated trusted execution environment; `check` must never invoke it implicitly.

## Specification registry, impact and Assurance

`@behavproof/spec-registry` exports `SpecificationRegistrySchema`, `specificationTransitionTarget` and `reconcileSpecification`. A registry entry holds its logical model ID and revision digest. The digest covers configuration and selected model, dependency, Driver, tool and mutation inputs. A transition target binds the previous and proposed digests, change type, repository and PR HEAD. The verifier recomputes the reviewed revision from immutable Git objects before consulting independent approval. A synthetic merge must produce the same reviewed transition.

`analyzeImpact` follows literal imports, re-exports, requires and dynamic import paths through the static dependency graph. It returns affected files, observed call names and unresolved paths. The CLI associates affected files with configured Quint sources, Drivers, implementations and their selected dependencies. Path and module risk overrides select scoped obligations. An unresolved graph is an error at critical risk and a warning at standard risk unless policy sets a stricter requirement.

`buildAssuranceMap`, `renderAssuranceMap`, `runAssurance` and `inspectArchitecture` expose the separate Assurance workflow. Map rows bind results to the selected definition revision. An externally authenticated membership predicate determines which evaluations can be shown as verified. The CLI can render current specification and Assurance information in Markdown, HTML or JSON.

## Protected Quality CI

`@behavproof/cli` exports `check`, `TrustRootSchema`, `loadTrust`, `CIRegistration`, `registeredCI` and the registry state readers. The version 2 enrollment binds the protected policy, project configuration, reviewer and issuer selection, immutable source commit, adopted specification inventory and integration file hashes. The host constructs a version 2 trust root from the enrollment, active registry and authenticated evidence. Ordinary Jest and Vitest projects use an empty specification inventory and a selected runner manifest with a matching report and receipt.

`@behavproof/adapter-github` exports `GitHubAuthority`, `GitHubCheckPublisher`, `prepareCheckPublication` and `readArtifactArchive`. Approval verifies current head and base, protected review requirements and authorized independent reviewers. Producer verification binds the independently pinned workflow, successful run attempt, job and archive digest. The registry writer checks the issuer-bound successful result, Git merge identity and previous registry digest before updating the protected branch with compare-and-swap.

See [trust roots](../trust-root.md), [formal verification and registration](../formal.ja.md), [Assurance](../assurance.ja.md) and [schema compatibility](../schema-compatibility.md).
