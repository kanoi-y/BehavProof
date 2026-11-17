# Independent suteco study evidence review

Reviewed 2026-11-17, read-only except this report. No tests, source changes, Git mutations, or extra agents were run by this reviewer.

**Verdict: the saved smoke measurement supports three independent original-code defects within the explicitly selected study conditions. No count-changing defect in the measurement bridge or evidence was found.** One methodology sentence should be corrected before publication, and final repeated timings remain pending at review time.

## Evidence checked

- Read `method.ja.md`, `measure.mjs`, `overlay/validation/target.mjs`, the minimal driver and all three fixture files; compared them with original schema/import/provider/digest/repository-facing UI and test setup code in the suteco checkout.
- Read the three investigator reports, eight raw observation files, eight Jest reports and execution logs, summary, assurance map, Collector manifest and collector result.
- Independently recomputed SHA-256 for every one of the **26** copied artifacts listed by the saved manifest. All matched. Manifest subject is clean local study commit `f5f8c9a52e2b339f4ea6e1ac5376c026ddc828b0`; parent target is suteco `79bbcaab65539a1f5d080a98710e52bf06764283`.
- A read-only diff against that suteco parent for `src`, `app`, `datasets`, `drizzle`, `tests`, `package.json`, and `pnpm-lock.yaml` was empty.
- Existing baseline JSON records **32 suites / 181 tests passed**, no failed tests or suites. TypeScript success was supplied by the parent; this reviewer did not rerun or independently establish it.
- Saved smoke reports each contain exactly one executed selected scenario, with other fixture scenarios skipped. Totals agree across observations, independent Jest assertions and BehavProof map: **8 conditions, 5 pass, 3 fail, 0 unknown**. Skipped tests are not additional executed conditions.
- The saved timing is **one** collection, **16.082864834 seconds**. Manifest timestamps span approximately 16.021 seconds, compatible with the measured outer collection duration. This is not yet a three-repetition result and excludes discovery, installation, build and baseline testing time.

## Defect count and requirement fairness

| ID | Independent cause and concrete observation | Necessary claim boundary |
| --- | --- | --- |
| S1 | Import trusts a nested rule municipality ID without checking its ownership. An A dataset overwrites B's existing category/instructions in actual SQLite, and the actual repository returns the overwritten B rule. | One-municipality ownership is derived from the documented separate municipality datasets and municipality-correct information; exact rejection at both schema and import boundaries is a chosen oracle, not a verbatim documented algorithm. B's actual overwrite establishes the defect even though other safe handling strategies could be designed. Synthetic malformed input does not show malformed currently shipped data or a historical incident. |
| S2 | Startup compares a content digest that excludes version and skips the importer when only version changes. Database, Zustand, AsyncStorage and actual Settings rendering retain `2000-01-01` instead of bundled `2025-09-01`. | This is stale **version metadata**, not demonstrated stale disposal instructions. Version-only handling is inferred from the version-display requirement and existing latest-version synchronization behavior. No historical release with this exact prior state is established. |
| S3 | An imported `file:///tmp/suteco-study-only` reference survives schema, import and repository lookup, renders in the actual item-detail screen, and a press passes it unchanged to the recorded native opener. | Safe external-link requirement supports a scheme-validation defect. No actual file access, OS launch, exploit, attacker-controlled supply path, or platform-specific behavior was tested. Count schema acceptance and link dispatch as one issue. |

These causes are independent: import ownership validation, version-change detection and reference-link guarding. Five passing controls are narrow checks of expected behavior; they do not estimate a general false-positive rate. The dangling-item control deliberately supplies invalid input and checks correct rejection, so “five expected-pass controls” is more exact than “five ordinary valid-input cases.”

The same-turn municipality store race is correctly **excluded**. The original synchronous SQLite adapter resolves before later event-turn user input; the included later-turn control confirms B remains selected. A direct same-turn API interleaving does not establish current UI reachability.

## Measurement and authority review

`target.mjs` makes a fresh temporary observation directory, launches the pinned Node20 Jest process, requires exactly one selected executed assertion and reads a fresh matching case observation. Process exit 0/1 is accepted solely as a completed observation process. It does **not** turn Jest exit status, test title, or assertion status into the returned behavioral result. Returned values are projections of actual schema results, SQL/repository state, store/persistence/display, and recorded native-opener arguments.

`measure.mjs` declares expected states outside the target, captures exact diagnostic bytes, invokes the Collector, checks artifact integrity, selected local producer, current subject and collection completion, then invokes the public assurance evaluator against current input identities and approved check hashes. Config/lock values in the manifest expectation come from the fresh Collector, but those same files are also included in the independently pinned input inventory and checked for unchanged bytes; no observed shortcut bypasses current inputs. `authenticatedReportHashes` is supplied only after the local host has validated the collected bundle bytes. Map membership validation reflects this host's already-evaluated objects.

The collection producer returns success after copying a completed assurance report with `assuranceExit: 1`. This correctly separates successful evidence collection from three failed product conditions. No evidence is relabeled as Vitest or project-gate success. The explicit local producer is a study authority, not independent CI approval, external sign-off, or production certification. The bridge receipt identifies the wrapper invocation; inspection of the wrapper and raw records supplies evidence that original modules actually ran, rather than implying that a wrapper receipt proves every downstream operation by itself.

Jest remains **unsupported by the standard CLI project gate**, as saved project detection reports. The study fairly uses `assurance run` plus public evaluator/map APIs with an explicitly selected local host. All native boundaries and dataset discovery remain the project's Jest adapters; SQLite SQL runs through better-sqlite3, but this is not device validation, navigation end-to-end validation, actual AsyncStorage durability, camera/Gemini behavior or native URL execution.

## Publication correction and completion checks

1. `method.ja.md` says `品目検索の正常系も対照に含める。` The eight final conditions do not exercise item search. Replace this with the actual expected-pass controls: valid import, dangling-item rejection, changed-content startup, HTTPS link dispatch and later-event-turn municipality selection. This is a documentation scope mismatch, not a reason to alter the three-defect count.
2. Replace smoke timing/SDK identity with final measurement outputs after the parent's three timed repetitions. Do not describe this review as already validating those future runs.
3. Say “human-defined conditions reproduced and BehavProof evaluated three existing-code defects” rather than autonomous discovery, three production incidents, or a whole-project detection rate. Whole-project recall has no established denominator. Baseline green tests plus newly written cases demonstrate coverage gaps; they do not isolate an incremental defect-discovery advantage over writing the same Jest assertions alone.

Suggested Japanese result wording: **「既存テスト181件はすべて成功した状態で、人が仕様と実装から定めた8条件を追加検証した結果、独立した既存コードの不具合3件を再現し、BehavProofでfailとして記録できた。期待どおりに動く対照5条件はpassだった。対象はJestの既存ネイティブ代替環境内であり、全体の発見率や実機での不具合発生を示すものではない。」**

## Final measurement delta audit — 2026-11-17

**Verified:** the final saved evidence replaces the one-run smoke figures above with **three consistent repetitions**. This was a read-only artifact and document audit; no product tests or measurement runs were repeated by the reviewer.

- Final `summary.json` records BehavProof SDK `d15d08d961712877bd318245fb5d068581d890f4`. Suteco's local study commit remains `f5f8c9a52e2b339f4ea6e1ac5376c026ddc828b0`, independently matched to checkout HEAD and the clean manifest subject. The source/dependency/existing-test diff against original `79bbcaab65539a1f5d080a98710e52bf06764283` remains empty for the originally reviewed paths.
- All **26** artifact-index entries are unique and correspond to the saved manifest inventory. Every saved file's independently recomputed SHA-256 matches both its index entry and manifest artifact hash. Eight `.execution.log` source artifacts are saved as `.execution.txt`; only filenames changed, not evidence bytes.
- Independently computed canonical hashes for the saved `assurance.json` and `manifest.json` match the **first final trial's** `reportHash` and `manifestHash`. The published detailed artifacts represent this first final trial; trial summaries record all three repetitions.
- The three durations are **13.370930334**, **13.292939084**, and **13.250578749999997 seconds** (last value rounds to 13.25057875). Each trial reports exactly **8 conditions, 5 pass, 3 fail, 0 unknown**, with all four manifest-validation statuses `pass`. Independently computed median is **13.292939084 seconds**, matching the summary. These are collection durations, not total study effort.
- `added-jest.json` independently records exactly the same eight selected case IDs and the same five passing / three failing outcomes. The ninth fixture test is the excluded `municipality-late-load` exploratory observation and is `pending`, not executed or counted. `added-jest-timing.json` records direct Jest wall time **3.339011458 seconds**, exit 1, 8 selected and 1 excluded. This direct comparison confirms that the same assertions detect the three issues without BehavProof; it does not establish an additional defect-discovery advantage for BehavProof. The direct timing is one run and the study bridge uses a separate process per condition, so avoid interpreting the ratio as universal framework overhead.
- The methodology's incorrect item-search control claim is corrected: it now lists the actual five controls and explicitly excludes item search. The draft report accurately preserves the native/mock boundaries, derived requirements, excluded race, lack of historical incident evidence, unsupported standard Jest project gate, and lack of a whole-project discovery-rate denominator.

One documentation consistency issue remained when this audit was written: the first paragraph of `method.ja.md` still named initial SDK `6063bcd`, while final measurement records `d15d08d`. The parent was notified to state the final measured SDK or distinguish initial plan and final measurement revisions. Quantitative timing/footprint text the parent adds after this audit is not independently reviewed here.

## Controller completion note

Both documentation corrections were applied: the method now lists the actual five controls and distinguishes the initial SDK6063bcd from the final measured d15d08d. Final timing and the separately recorded direct-Jest comparison appear in report.ja.md and results/context.json. No measured condition logic or outcomes were changed by these wording updates.
