# M2受け入れ基準と実行証拠

> Repository ownership update: BehavProof is now managed in [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). The copied-source pdd-ts PRs7/8 were closed without merging. Their run/review records below are historical evidence; the old PR8 approval/deployment request is superseded. Future pdd-ts changes are thin consumer integration only. See [repository boundaries](repository-boundaries.md).


基準: `BehavProof_開発仕様書_v0.6.md` §19。必須範囲はM1/M2の45件（AC-01〜30、AC-37〜51）。AC-31〜36は任意M2-Fであり、未実装を合格へ置換しない。

この表の「未検証」は未完了を意味する。実装テストやfixtureの存在だけでは完了にしない。対応する実コマンド・結果・対象の記録を確認してから更新する。GitHub外部保護はローカルHTTP fixtureの成功と区別する。

| ID | 段階 | 条件と期待結果 | 状態 | 実行証拠 |
| --- | --- | --- | --- | --- |
| AC-01 | M1 | `init --dry-run` → 変更を表示しファイルを改変しない | ローカル検証済み | tests/cli/commands.test.ts |
| AC-02 | M1 | `init`を2回実行 → 不要な差分を作らない | ローカル検証済み | tests/cli/commands.test.ts |
| AC-03 | M1 | 正常なVitest JSON → 実行・成功・失敗・skipを正規化 | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-04 | M1 | 必須レポート欠損 → unknown / gate block | ローカル検証済み | tests/cli/commands.test.ts |
| AC-05 | M1 | Manifestの実行対象SHA／ツリーハッシュが評価対象と不一致 → 過去・別対象の証拠を拒否 | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-06 | M1 | 変更行80%、閾値80% → pass | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-07 | M1 | 変更行79%、閾値80% → fail | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-08 | M1 | 変更対象はあるがLCOV欠損 → unknown | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-09 | M1 | 変異対象0 → 100%扱いをしない | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-10 | M1 | Survived mutation → 数と対象を正確に表示 | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-11 | M1 | Policy緩和のPR → 差分を表示し、PR側の閾値・severity・対象除外で保護基準を緩和せず再評価 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-12 | M1 | 必須チェック設定が取得不能 → 設定済みと断定しない | ローカル検証済み | tests/github/authority.test.ts; docs/evidence/github-live-adapter.json |
| AC-13 | M1 | auditでfailがある → レポート生成はexit 0、問題を明示 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-14 | M1 | gateで必須unknownがある → exit 1 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-15 | M1 | 設定パースエラー → 理由とexit 2 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-16 | M1 | 同じ入力で再評価 → 結果が再現 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-17 | M1 | 非対応プロジェクト → 自動設定に失敗した理由を明示 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-18 | M1 | 上流の必須ジョブをskip → 最終ゲートが実行され、ジョブ結果・成果物を照合してblock | 外部実地検証待ち | tests/github/authority.test.ts（ローカル検証済み）。実CIのskipと最終ゲート実行は未検証 |
| AC-19 | M2 | Contract宣言のみ・テスト実行0件 → binding/executionはunknown | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-20 | M2 | Contractの2例を実行 → case別の契約版・bindingハッシュ・実行・比較証拠を記録。本番到達を自動推定しない | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-21 | M2 | `non-owner`をskip → criticalの必須ケースではgate block | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-22 | M2 | Intentを無承認で変更 → 承認状態を未確認としgate block | 外部実地検証待ち | tests/contracts/registry.test.ts（ローカル検証済み）。無承認時のunknownと、PR7の同一HEADへの実Approve後のpassを確認（docs/evidence/github-approval-live.json）。保護CIでの変更検証は未完了 |
| AC-23 | M2 | 期待値`denied`→`allowed`を無承認変更 → 契約緩和を検出してgate block | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-24 | M2 | 振る舞い不変のリファクタ → 契約ファイル変更なしで再検証可能 | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-25 | M2 | Docを生成し再実行 → 差分なし（入力が同じとき） | ローカル検証済み | tests/cli/commands.test.ts |
| AC-26 | M2 | 追跡中の生成Docを手編集 → `docs check`が差異を検出 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-27 | M2 | Contractのファイル移動・ID維持 → 不必要なIntent変更承認を要求しない | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-28 | M2 | 高リスクファイルの影響が不明 → 理由付きunknown、設定によりblock | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-29 | M2 | AIがIntentとテストを同時に生成 → 未承認なら承認済みと扱わない | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-30 | M2 | 同一Contract IDの競合ソース → 明示的な重複エラー | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-31 | M2-F | Quintを未使用 → 依存の追加・既存CIへの影響なし | 任意M2-F（今回の必須範囲外） | — |
| AC-32 | M2-F | モデル違反を注入 → モデル側の失敗を検出 | 任意M2-F（今回の必須範囲外） | — |
| AC-33 | M2-F | 実装のみ違反を注入 → conformance失敗を検出 | 任意M2-F（今回の必須範囲外） | — |
| AC-34 | M2-F | モデルチェックが有界 → 上限を表示し無制限保証としない | 任意M2-F（今回の必須範囲外） | — |
| AC-35 | M2-F | トレース0／比較0 → conformance pass禁止 | 任意M2-F（今回の必須範囲外） | — |
| AC-36 | M2-F | モデル／Driver変更後の旧証拠 → ハッシュ不一致で拒否 | 任意M2-F（今回の必須範囲外） | — |
| AC-37 | M1 | 生レポートのみ、または現在SHAを後付けした記録 → 内容をaudit表示できるが鮮度検証済みにせず、必須来歴はunknown | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-38 | M1 | Manifest確定後に成果物を改変／前回成果物を流用 → 整合不成立でgate block | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-39 | M1 | PR内JSONが信頼済みproducerを自己申告 → 外部信頼基点と照合できなければproducerTrustはunknown | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-40 | M1 | PR先端と実行マージSHAが異なる正常なPR → 両SHAと親関係を記録し、対象一致を誤判定しない | ローカル検証済み | tests/reports/git-collector.test.ts |
| AC-41 | M1 | merge-base取得不能／マージ結果の行対応不明 → 空差分や100%で代替せずunknown | ローカル検証済み | tests/reports/git-collector.test.ts |
| AC-42 | M1 | ローカルdirty入力、または生成後に対象入力を改変 → auditは状態表示、M1 gateは拒否 | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-43 | M1 | 上流failure／cancel、別attemptの成果物、必須成果物欠損 → passにせず、不合格または未完了として扱う | ローカル検証済み | tests/github/authority.test.ts; docs/evidence/github-live-adapter.json |
| AC-44 | M2 | Contractファイル全体を未承認削除／includeから除外／risk引下げ → ベースSnapshotの義務を保持しcriticalをblock | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-45 | M2 | 対象内に静的抽出不能なInline宣言 → 発見のために実行せず、黙って一覧から除外せずunknown | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-46 | M2 | 廃止対象の差分・ハッシュを信頼経路で承認 → 旧義務を失効させ、新しい有効版を評価 | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-47 | M2 | コールバックをモック／期待動作の再実装へ置換 → 比較成功だけで本番対象観測・変異感度をpassにせず、必須観測不足ならblock | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-48 | M2 | 本番対象へ故障を注入し当該ケースが失敗 → 対象・case・故障内容・失敗結果を別Evidenceとして記録 | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-49 | M1 | 変更した対象ソースファイルがLCOVから欠落 → 独立した対象外根拠がなければunknown。分母から黙って除外しない | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-50 | M1 | 最終ゲートskip／削除／偽の同名成功チェック → 保護構成でマージを阻止。保護できない構成を保護済みと表示しない | 外部実地検証待ち | docs/evidence/github-live-adapter.json：BehavProof必須チェック未登録。既存PDD保護を代替証拠にしない |
| AC-51 | M1 | 保護Policyの信頼基点が未登録／PRが参照元を自己変更 → auditは可能、未登録gateは設定エラー。PRの自己変更では基準を置換しない | ローカル検証済み | tests/cli/commands.test.ts |

M0終了条件は `docs/m0-results.md` で管理する。実装タスクとレビューは計画に対応する `.superpowers/sdd/2026-11-13-behavproof-m2/progress.md` に記録する。

ローカル検証の記載は `npm test`、`node scripts/acceptance-flow.mjs`、`node scripts/package-smoke.mjs` の実行に基づく。API fixtureの成功は外部保護の合格を意味しない。検証先のhead285d7f5について、Node24.22.2のWindows/macOS/Linuxで各182テスト・ビルド・新規consumer導入・公開フローが成功し、成果物のdigestと実バイトを照合した（docs/evidence/github-hosted.json）。後続のレビュー修正は新しいHEADで再検証する。AC-18・22・50、M0-03・04・05の外部/人間による確認を含め、M2の完了宣言は保留する。

全体独立レビューで再現した「外部rootを変えずに古いManifestを新しいSHAへ付替える」「レビュー済みPR先端にないマージ専用の契約変更を承認する」の2負例は、`tests/acceptance/local-replay.test.ts` と `tests/acceptance/merge-approval.test.ts` で常時検査する。hostが固定したManifestハッシュと期待対象を保持し、承認可能な変更はPR先端のGitツリーから独立に抽出する。元の攻撃を遮断し、正規の実行・実際にレビュー対象にある変更の正例を維持することも独立再レビューで確認した。

最新修正HEAD `5cb1133e45d3fe73974401d8c666ad1eab6fff78` では [run43548473145](https://github.com/kanoi-y/pdd-ts/actions/runs/43548473145) の3 OSで各192テスト・ビルド・新規consumer導入・公開フローが成功。成果物ZIPのdigest/内容と、non-ownerの実際の1回の失敗比較まで照合した（`docs/evidence/github-hosted-review-fixes.json`）。PR7の同一HEADに対するkanoi-yのApproveを実APIで確認し、Policy・Intent・Contractの承認済み基準を外部hostへ登録した（`docs/evidence/registered-baseline.json`）。BehavProof必須ゲートの登録・skip/削除/偽発行元の外部実地試験は引き続き未完了。

新しい `scripts/protected-probe-flow.mjs` は、保護hostが選んだworkerの実Vitest・変換receipt・case別呼び出しと、同一bindingの実失敗比較をCollector経由で照合する。正常な局所観測・カナリアはpass、偽物はunknown、通常失敗/skipは成功artifactなし、ケース削除は義務を保持してblockを確認した（docs/evidence/protected-probe-flow.json）。さらに実PR7の承認済み5cbと外部登録digestに結び付けて実行した（approved-probe-live.json）。これらはAC-47/48とM0-02/03のローカル収集・実承認結合の証拠であり、AC-18/50の外部保護試験を代替しない。

後続head `16164ab99f587c8791d50f917897da967ad8cc3d` の [run43577566086](https://github.com/kanoi-y/pdd-ts/actions/runs/43577566086) はWindows/macOS/Linuxの検証が成功し、Linuxでは固定イメージの隔離コンテナによる正常・偽物・故障・skip・削除も成功した（`docs/evidence/github-hosted-producer.json`）。初回run43559481335のWindows改行依存fixture失敗は修正済み。保護された実producer/publisherの後続実装・導入・App発行元付き外部マージ保護試験は別の検証として残す。

保護CI導入案の最終head `7bcfa1d71bbd1686cc2bc5c32721681e6dc3c3d2` は [run43579133741](https://github.com/kanoi-y/pdd-ts/actions/runs/43579133741) が成功。Linux/macOSは各287成功、Windowsは284成功・POSIX限定3件skip。各OSの新規consumer導入・公開フロー・新しいprobeの正常/無承認Intent変更、Linux Dockerも成功した。3 ZIPを独立ダウンロードしAPI digestと実バイト、実フロー記録を照合した（`docs/evidence/github-hosted-protected-proposal.json`）。[PR8](https://github.com/kanoi-y/pdd-ts/pull/8) はこのHEADでレビュー可能。実Approve後の新Policy登録・main導入・App read権限/保護変数・隔離baseの専用チェック保護と、AC-18/22/50の実地試験を未完了として保持する。

分離後の接続検証では、実Git/実Vitest/Collectorから得たCI形状の成果物を別checkoutへ復元して実CLIで照合する検査を追加した。GitHub control-planeの応答はfixtureであり、外部AC-18/22/50の実証に昇格しない。実PDD main185ファイルのコード非実行auditは未検証runnerを明示しincomplete（`docs/evidence/pdd-adoption-audit.json`）。保護されたrunner選択でwrapper推定を置換する経路は、現在の認証済みmanifestとtest artifactに結合した場合だけ使用できる。
