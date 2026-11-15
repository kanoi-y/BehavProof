# Protected GitHub consumer integration

[日本語の具体的な導入・実地検証手順](protected-github-deployment.ja.md)

Rollout checkpoint (2026-11-15): consumer PR10 was squash-merged at `cbafb22fb314c6abf90e624cb5f20d71a4c98175`; the three repository variables and isolated issuer-bound branch protection are configured. PR11's registered producer and publisher verify succeeded, but final gate token creation returned HTTP422 because the installation lacks the requested App read permissions. PR12's same-name success from GitHub Actions App15368 still left GitHub merge state blocked; the disposable PR was closed without merging. See [recorded observations](evidence/github-protected-rollout.json). The complete positive control and remaining live matrix are still pending.

Status: reviewed integration components; live dedicated-check acceptance remains incomplete. The product lives in [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof); [pdd-ts](https://github.com/kanoi-y/pdd-ts) is the application under evaluation. See [repository boundaries](repository-boundaries.md). Earlier copied-source PRs7/8 were closed without merging; their approval/deployment request is superseded.

## Separate product and consumer

BehavProof owns the six packages, CLI, collector/probe/publisher code and product CI. A consumer checks out `kanoi-y/BehavProof` at an explicitly protected full SDK commit into `sdk/`. It installs/builds there with lifecycle scripts disabled. It never copies the product implementation into its application tree.

`node scripts/prepare-validation.mjs --sdk-sha <BehavProof-commit> --output <directory>` prepares only `.github/workflows/behavproof-producer.yml`, `.github/workflows/behavproof-publisher.yml`, and four contract/config files under `validation/behavproof-probe/` for the real PDD acceptance function. Review that consumer-only payload independently. No remote settings or branches are modified by the generator. The64 Boolean cases execute the actual PDD acceptance predicate; whole-PDD coverage/mutation quality remains separate. The toy positive control remains available with `--fixture enforcement-probe`.

## Trust and execution

The producer/publisher templates remain main-dispatch-only in the consumer repository. Their main-only environment and registered workflow SHA are independent of the product SDK SHA. `assertSdkRevision` checks the selected BehavProof checkout, while live producer authority checks the consumer workflow/run/latest attempt/job and unique archive digest.

The protected producer materializes every candidate-project file directly from raw Git blobs at the actual PR head, retaining the real Git index/HEAD. Symlinks, submodules, attributes/filters, reserved paths, ambiguous paths and excessive inputs are rejected. Candidate profile/risk/rules/contract sources are preserved in the generated config, with only host-selected base/report overrides; protected floors and the enrolled config remain authoritative. A changed enrolled policy file requires new human enrollment.

Candidate execution occurs only in a credential-free, network-disabled, non-root Docker container with read-only source/public SDK/control mounts, fresh writable output, bounded resources and checked cleanup. The fixed linux/amd64 runtime is `node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec`. The host creates its manifest/context after the container is gone and copies only explicit sealed bytes. Installed SDK dependencies must be trusted/public; staging does not scrub arbitrary files inside allowed dependencies.

The verifier authenticates the completed registered producer and independently downloaded archive digest before reading its context. ZIP decoding is bounded, in memory, without extraction. Current raw source, complete inputs, config, subject and obligations are independently matched. The privileged verifier never executes candidate code.

The final `gate` job uses `if: always()` and the actual unconditional `behavproof check --mode gate`. It checks completed upstream verification, live protection and pinned consumer workflow bytes. Publication re-evaluates using the protected SDK and compares the captured report. Missing evidence has an explicit failure-only path, without inventing producer/subject facts. Repository/current PR head/base and returned check issuer are checked again. The probe limitations in [protected-producer.md](protected-producer.md) remain applicable.

## Consumer-specific provisioning, still pending

The existing experimental adapters target `kanoi-y/pdd-ts` (ID1449042266), isolated base `behavproof-enforcement-test`, context `BehavProof protected gate`, App5653976 and main-only `pdd-publisher`. These are test-environment selections, not BehavProof product ownership. Existing main/PDD/environment protections must remain enforced.

A future thin integration requires its own review and provisioning:

- SDK source: the reviewed full commit from **kanoi-y/BehavProof** is embedded literally in generated workflows; it cannot be redirected through a repository variable. Raw generic templates may still be provisioned with an explicit protected SDK variable.
- `BEHAVPROOF_WORKFLOW_SHA`: reviewed consumer main commit with the two thin workflows.
- `BEHAVPROOF_REGISTRATION_JSON` and `BEHAVPROOF_REGISTRATION_DIGEST`: admin-controlled immutable output of actual same-head Policy/Intent/Contract review, never a PR-owned self-declaration.
- App Checks write, Contents/Pull requests/Actions/Administration read and implicit Metadata read. Confirm read grants separately; never read/copy private key values or expose credentials to the candidate container.

`enroll-enforcement-probe.mjs` defaults to the actual PDD repository root, with contract/policy/config data at `validation/behavproof-probe` and `source.configRef` selecting that enrolled config. `--fixture enforcement-probe` selects the old toy. It verifies source hashes for the actual function, package/lock, declarations and policy before source-bound human approval. It does not set variables or merge. The existing critical Node API registration remains historical and unchanged; it is not silently reassigned to another repository or source.

## Required live acceptance

After the reviewed consumer integration and registration are provisioned, protect only the new isolated test base with strict/admin-enforced `{context: "BehavProof protected gate", app_id: 5653976}`. Do not weaken existing main protection. Use fresh candidate heads for this complete live matrix:

| Scenario | Required observation |
| --- | --- |
| Normal real collection and verification | Registered producer/archive/current subject/case evidence pass; dedicated App success; GitHub merge eligibility recorded |
| Upstream verify skipped (`skip_verify`) | Verify skipped; unconditional gate executes and fails; dedicated failure or missing required result blocks |
| Upstream verify failure | Select an unavailable/unregistered producer run; record verify failure, unconditional gate outcome and dedicated-check merge block |
| Upstream workflow cancellation | Cancel the controlled publisher while verify runs; record actual job outcomes and merge block from failure or absent dedicated result. Do not assume GitHub runs a canceled workflow's gate |
| Required archive/report missing | Use a disposable successful producer, retain its original evidence, then remove its test artifact or run a producer with no required result; verification fails and merging is blocked |
| Old attempt remains after a canceled rerun | Keep attempt1's artifact, start and cancel attempt2, then verify the same run ID; old artifacts must not supply current-attempt authority |
| Dedicated gate absent/skipped | Before dispatch on a fresh head, no required App result exists and GitHub blocks merging |
| Candidate deletes/replaces gate workflows | Candidate-owned changes cannot alter the protected main publisher or supply its required result; missing/failed dedicated context blocks |
| Same context succeeds from another App | A GitHub Actions success with the same name cannot satisfy App5653976's required context |
| Intent/expectations/policy weakened without approval | Retained obligations/current source approval checks reject the change; dedicated failure or missing result blocks |

Record each head/base, workflow/run/attempt/job, internal result or reason it did not run, dedicated issuer/result or absence, GitHub merge state, branch-protection snapshot, and relevant API/artifact hashes. Use a positive control to distinguish the dedicated context from unrelated review/check blockers. Simulated wrong-attempt or missing-result fixtures remain labeled local if no corresponding live manipulation was performed. All live rows are pending; product CI and the existing PDD check do not replace them. Do not merge disposable negative-test PRs.
