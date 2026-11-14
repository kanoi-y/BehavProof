# Protected GitHub consumer integration

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

After the reviewed consumer integration and registration are provisioned, protect only the new isolated test base with strict/admin-enforced `{context: "BehavProof protected gate", app_id: 5653976}`. Do not weaken existing main protection. On fresh candidate heads, record actual real-collection success, skipped upstream followed by final-gate failure, missing/deleted dedicated final check, same-name success from another App, and an unapproved Intent/policy change. Confirm merge eligibility/blocking against the dedicated context, retaining actual API/job/check/archive hashes. Do not substitute product CI, the existing PDD check, or local fixtures for these AC-18/22/50 results. Do not merge disposable negative-test PRs.
