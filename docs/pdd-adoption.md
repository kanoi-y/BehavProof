# PDD adoption observations

The immutable real `kanoi-y/pdd-ts` main source at `dd06da788bef5cfbe7f9131fe5609a61cefbd458` was fetched as Git objects and all185 tracked files materialized without checkout filters or executing its code. The built public BehavProof CLI ran `doctor` and `check --mode audit --base <sha> --head <sha> --format json`. Actual results are in [pdd-adoption-audit.json](evidence/pdd-adoption-audit.json).

PDD is a single-package Node/Vitest project, but its package test command is `pnpm build && vitest run`. The conservative default detector therefore reports an unverified runner; audit stays incomplete and exit0 makes no test/quality success claim. No PDD test, build, config code or proof tool was executed by this audit. This is a concrete adoption limit, not proof of BehavProof's value on PDD behavior.

The protected integration now supports an explicit external trust-root `runner` selection tied to one authenticated manifest and its exact selected test artifact. Only after current artifact/producer/subject/execution verification passes, with `package.json` in the hashed input scope, may that selected Vitest runner replace the package-script heuristic. It does not execute the wrapper, certify a build, or trust a candidate-owned runner declaration. Missing selection, a different manifest, or unverified producer retains unsupported/unknown.

`tests/acceptance/protected-protocol.test.ts` exercises the same capture/restore functions used by live controller scripts with real fetched Git commits, actual Vitest/probes/Collector, a ZIP transported to a second clean checkout, and CLI evaluation. It uses a wrapped package command but deliberately runs only the host-selected SDK Vitest. Control-plane CI responses are explicit fixtures; this test is not live GitHub producer authority. It verifies current real comparisons/reach/canary preservation, tampered context/archive/report rejection, missing reports, absent/wrong/unverified runner selection, and no sealed context after cleanup failure. The complete gate still blocks when external pipeline authority is absent.

The thin consumer PR and its `validation/behavproof-probe` fixture are isolated enforcement controls. Remaining work includes actual PDD test/coverage/mutation collection under a reviewed protected runner and the live dedicated-check skip/deletion/wrong-issuer tests. The toy and library CI cannot replace those results.

## Actual production acceptance experiment

`node scripts/pdd-acceptance-flow.mjs` fetches that immutable PDD commit as raw Git objects and overlays only the reviewed four contract/config data files on a real temporary integration commit. It directly imports PDD's actual `src/verification/acceptance.ts#canAcceptEvidence`; no implementation is copied into BehavProof. All185 original tracked files remain in the source snapshot and all189 files are hashed for execution. The built public CLI uses an explicit local host and selected SDK Vitest, without executing the package wrapper.

Actual results in [pdd-acceptance-flow.json](evidence/pdd-acceptance-flow.json):

| Scenario | Actual ordinary comparisons | Separate observations | Protected result |
| --- | --- | --- | --- |
| Original PDD conjunction | 64 pass, one comparison per input | Per-case target calls and64 real fault comparisons | Required behavioral evidence passes; missing external pipeline blocks full gate |
| Callback returns expected value | 64 pass | Target/sensitivity unknown | Block |
| Actual function changed to always accept | 63 fail, one pass; no sealed success artifacts | Ordinary failure, not canary success | Block |
| Always-accept plus all expectations changed to true | 64 pass | New unapproved contract revision cannot borrow old observations | Contract/Intent transition fail, block |

The record includes actual subjects, source hashes, artifact hashes, binding/revision hashes, injected fault details, failed canary comparisons and measured duration. Local temporary integration commits are explicitly distinguished from remote PR commits. This establishes scoped value on the real acceptance predicate; it does not establish whole-PDD correctness, coverage/mutation scores, human approval or live protected CI authority.

On Linux product CI, `--sandbox-sdk <validated-linux-sdk>` repeats the experiment through the same network-disabled/read-only/non-root container runner used by the live producer. The parent fetches the immutable public source before candidate execution. The Node-only default is an explicit local experiment, not an OS sandbox.

The default consumer payload now targets this real PDD contract and consists of two thin workflows plus four data/test files. `--fixture enforcement-probe` retains the separate toy positive control when needed. The SDK commit is embedded literally in the generated workflows for review.
