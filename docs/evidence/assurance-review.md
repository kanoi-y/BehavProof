# Final fix scoped rereview

Review date: 2026-11-17. Scope: the four-file uncommitted fix wave in `final-fix.diff`, against the I1–I4 acceptance criteria in `whole-branch-review.md`. Read the fix report, affected current sources/tests, existing scoped risk selection, map validation/rendering, and recorded focused RED/GREEN/build logs. No source or Git mutation, subagent, test execution, or whole-feature rereview was performed. This report is the only file written by this reviewer.

## Verdict

**I1, I2, I3 and I4: ADDRESSED. No newly introduced Important or Critical breakage found in the fix wave.** The scoped fix was accepted. Subsequent full-suite, package and flow results are recorded separately in assurance-validation.json; they are not claimed by this rereview.

## Findings and evidence

| Finding | Verdict | Evidence |
| --- | --- | --- |
| I1 — critical selector risk | ADDRESSED | `packages/cli/src/assurance-evaluation.ts:38`–`41` now strips the location suffix, constructs the same extension-stripped module target as `scopes.ts`, resolves protected selectors for that target, and supplies the resulting protected risk as the current resolver's floor. Declaration risk remains in the target. The table regression in `tests/cli/assurance.test.ts:84`–`100` covers normalized path, actual inline TypeScript module, and protected-only path selection under basic current configuration; each asserts mandatory error/unknown sensitivity and unknown affected check/condition. Lines 121–131 cover a path-selected positive case with a real declared/detected fault. |
| I2 — known indirect Node loaders | ADDRESSED | `packages/contract-registry/src/architecture.ts:27`–`56` recognizes explicit named/aliased factory bindings, Node module namespace/default bindings, CommonJS module bindings and destructured factories; known loader aliasing is unsupported. Lines 63–68 make known factory creation unsupported while retaining direct static require and existing indirect-loader checks. The 14 cases at `tests/assurance/runtime.test.ts:127`–`148` assert unsupported observations plus unknown check and condition results. Direct static import/export/require remains covered at lines 175–179; the existing dynamic-import-unknown regression is unchanged. Recognition is syntactic and conservative and does not execute sources. |
| I3 — condition/map false pass | ADDRESSED | `assurance-evaluation.ts:40`, `:49` and `:65`–`69` derive per-condition/check missing obligations, attach explicit reasons, downgrade passing affected checks to unknown, then recompute condition/aggregate statuses before gate rows and result publication. Existing fail/unknown statuses are retained; declared fault inventory is unchanged. The mixed regression at `tests/cli/assurance.test.ts:101`–`119` verifies an unrelated covered check/condition stays pass, with JSON and rendered HTML reporting the missing-fault condition unknown. Evidence refs and a nonzero comparison count are retained, demonstrating acceptance by `buildAssuranceMap`'s structural/status recomputation rather than a fallback unknown map. The positive test also verifies a passing real fault in JSON and HTML. |
| I4 — built-in spelling identity | ADDRESSED | `architecture.ts:22` preserves raw spelling and supplies the counterpart identity only when both the observed and unprefixed spellings are recognized built-ins. Existing raw/resolved prefix matching at line 75 therefore catches both directions and subpaths without rewriting arbitrary packages. Six runtime cases cover imports/exports/require and both spellings/subpaths; three exclusions cover `fs-extra`, an invented `fs` subpath and prefix-only `node:test`. The shipped UI normal source and actual substituted fault are inspected with both filesystem spellings at `tests/assurance/runtime.test.ts:181`–`192`. |

## Verification claim audit

- `/tmp/behavproof-final-fix-red.log` records **16 failed / 1 passed / 27 skipped**. Its failure list matches the original selector, condition/map, loader and spelling regressions. The protected-only case initially fails in fixture setup, as the fix report openly records; the separate `/tmp/behavproof-final-fix-protected-red.log` then records **1 failed / 13 skipped**, failing specifically because the mandatory sensitivity row is absent.
- `/tmp/behavproof-final-fix-loader-forms-red.log` records **10 failed / 4 passed / 26 skipped** and names the additional parenthesized/assignment/namespace/default/computed/CommonJS/factory forms.
- `/tmp/behavproof-final-fix-green.log` records **2 passed test files / 54 passed tests**, duration **17.96s**. This matches the final two focused files and the reported decisive GREEN result. No unhandled errors appear in that log.
- `/tmp/behavproof-final-fix-module-green.log` records the subsequent fixture-only module regression run: **1 passed / 13 skipped**, duration **1.43s**. The current fixture uses supported inline TypeScript discovery and the actual `src/contract` selector.
- `/tmp/behavproof-final-fix-build.log` contains the expected workspace build invocation (`tsc -b && node scripts/build-artifacts.mjs`) and no compiler/build diagnostics. This is consistent with the reported successful build; the text log itself does not independently encode its process exit status.
- The intermediate restricted-listener timeout and corrected temporary module fixture are not counted as successful verification. This rereview did not rerun tests, build, package smoke, or acceptance. The parent owns final full-suite/package evidence.

## Newly introduced Important/Critical breakage

None identified. The fix does not alter non-adopter metadata/revision generation, authority selection, baseline/declaration transition protection, or approval checks. New missing-fault processing can only retain a previous fail/unknown or downgrade pass, and executes before the existing independent-authority downgrade. The architecture additions observe AST structure and Node's built-in identity table; they add no discovery/check-time consumer code execution.

## Out-of-scope observations and limits

- Loader handling remains bounded syntactic recognition. Universal alias/data-flow analysis and arbitrary JavaScript closure proof were explicitly excluded from acceptance and are not newly demanded here.
- A check reused by multiple conditions is a shared evaluation row. A missing critical obligation downgrades that shared check and consequently every condition depending on it; conditions using separate satisfied checks remain pass, as tested. This is conservative and consistent with the existing map validator's aggregation model.
- Evaluator fixture authentication is caller-supplied to isolate policy/map behavior. The tests and this rereview do not independently establish Collector authentication or a new human approval.
- Untouched feature behavior and final whole-suite/package outcomes were not re-reviewed in this scoped pass.
