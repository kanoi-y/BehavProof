# M2受け入れ基準と実行証拠

> Repository ownership update: BehavProof is now managed in [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). The copied-source pdd-ts PRs7/8 were closed without merging. Their run/review records below are historical evidence; the old PR8 approval/deployment request is superseded. Future pdd-ts changes are thin consumer integration only. See [repository boundaries](repository-boundaries.md).


基準: `BehavProof_開発仕様書_v0.6.md` §19。既存M1/M2の45件（AC-01〜30、AC-37〜51）に、今回明示選択したM2-Fの6件を追加する。各範囲の実地・実ツール・ローカル検証を区別する。

現在の必須45件は、下記の実行証拠で検証済み。ローカル検査と実GitHub保護を区別する。実地検証の対象はpdd-tsの受理関数と隔離した検証用ブランチであり、全PDDの品質やmainへの追加保護を意味しない。詳しくは[実地検証結果](github-live-validation.ja.md)。

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
| AC-11 | M1 | Policy緩和のPR → 差分を表示し、PR側の閾値・severity・対象除外で保護基準を緩和せず再評価 | 外部実地・ローカル検証済み | tests/cli/commands.test.ts; [設定/Policy未承認変更](evidence/github-protected-rollout.json)。設定offでも保護基準を保持、Policyファイル変更は再登録を要求 |
| AC-12 | M1 | 必須チェック設定が取得不能 → 設定済みと断定しない | ローカル検証済み | tests/github/authority.test.ts; docs/evidence/github-live-adapter.json |
| AC-13 | M1 | auditでfailがある → レポート生成はexit 0、問題を明示 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-14 | M1 | gateで必須unknownがある → exit 1 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-15 | M1 | 設定パースエラー → 理由とexit 2 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-16 | M1 | 同じ入力で再評価 → 結果が再現 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-17 | M1 | 非対応プロジェクト → 自動設定に失敗した理由を明示 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-18 | M1 | 上流の必須ジョブをskip → 最終ゲートが実行され、ジョブ結果・成果物を照合してblock | 外部実地検証済み | publisher [43666062415](https://github.com/kanoi-y/pdd-ts/actions/runs/43666062415)：verify skipped、最終CLI実行exit1、App failure、GitHub blocked |
| AC-19 | M2 | Contract宣言のみ・テスト実行0件 → binding/executionはunknown | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-20 | M2 | Contractの2例を実行 → case別の契約版・bindingハッシュ・実行・比較証拠を記録。本番到達を自動推定しない | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-21 | M2 | `non-owner`をskip → criticalの必須ケースではgate block | ローカル検証済み | scripts/acceptance-flow.mjs; docs/evidence/public-flow.json |
| AC-22 | M2 | Intentを無承認で変更 → 承認状態を未確認としgate block | 外部実地・ローカル検証済み | tests/contracts/registry.test.ts; publisher [43666057505](https://github.com/kanoi-y/pdd-ts/actions/runs/43666057505)：未承認宣言変更を拒否。Contract版も変わるためIntent単独の失敗原因とは断定しない |
| AC-23 | M2 | 期待値`denied`→`allowed`を無承認変更 → 契約緩和を検出してgate block | 外部実地・ローカル検証済み | tests/contracts/registry.test.ts; [43669115818](https://github.com/kanoi-y/pdd-ts/actions/runs/43669115818)：本番と期待値を同時緩和、通常64成功でもgate failure |
| AC-24 | M2 | 振る舞い不変のリファクタ → 契約ファイル変更なしで再検証可能 | 外部実地・ローカル検証済み | scripts/acceptance-flow.mjs; [43666066341](https://github.com/kanoi-y/pdd-ts/actions/runs/43666066341)：本番1ファイル変更、Contract変更0、同版の64比較/観測/カナリア成功 |
| AC-25 | M2 | Docを生成し再実行 → 差分なし（入力が同じとき） | ローカル検証済み | tests/cli/commands.test.ts |
| AC-26 | M2 | 追跡中の生成Docを手編集 → `docs check`が差異を検出 | ローカル検証済み | tests/cli/commands.test.ts |
| AC-27 | M2 | Contractのファイル移動・ID維持 → 不必要なIntent変更承認を要求しない | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-28 | M2 | 高リスクファイルの影響が不明 → 理由付きunknown、設定によりblock | ローカル検証済み | tests/cli/impact-gate.test.ts：実CLIの解決済み変更gate0→不明変更gate1、criticalの保護floor、実対象の明示対応。従来のRegistry単体検査だけではgate接続を証明できなかった |
| AC-29 | M2 | AIがIntentとテストを同時に生成 → 未承認なら承認済みと扱わない | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-30 | M2 | 同一Contract IDの競合ソース → 明示的な重複エラー | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-31 | M2-F | Quintを未使用 → 依存の追加・既存CIへの影響なし | ローカル検証済み（最終CI確認中） | scripts/package-smoke.mjs; docs/evidence/package-smoke.json; docs/evidence/formal-package-smoke.json：通常6個では任意アダプターも未導入、任意8個でもQuint/Connectの必須依存なし。既存CIにJava導入なし |
| AC-32 | M2-F | モデル違反を注入 → モデル側の失敗を検出 | 実ツール・ローカル検証済み（最終CI確認中） | docs/evidence/formal-flow.json：実Quint simulationの2回再現と実Apalache bounded verifyでモデル故障を検出 |
| AC-33 | M2-F | 実装のみ違反を注入 → conformance失敗を検出 | 実ツール・ローカル検証済み（最終CI確認中） | docs/evidence/formal-flow.json：同じDriver・10トレースで故障実装を90比較し5不一致。モデル検査とは別のconformance |
| AC-34 | M2-F | モデルチェックが有界 → 上限を表示し無制限保証としない | 実ツール・ローカル検証済み（最終CI確認中） | docs/evidence/formal-flow.json; tests/cli/formal.test.ts：Apalache bounded_model_check、maxSteps=8、simulation maxSamples=100/seed42、再生10件90比較を分離。console/JSON/Markdownもunbounded=false |
| AC-35 | M2-F | トレース0／比較0 → conformance pass禁止 | ローカル検証済み（最終CI確認中） | tests/formal/evidence.test.ts; tests/formal/replay.test.ts; tests/cli/formal.test.ts：0トレース/0比較/0呼出、未到達、最低件数以上でのsuffix欠落も拒否 |
| AC-36 | M2-F | モデル／Driver変更後の旧証拠 → ハッシュ不一致で拒否 | ローカル検証済み（最終CI確認中） | tests/cli/formal.test.ts; tests/cli/registration.test.ts：モデル/Driver/実装/config/trace/canary変更と、現在producerで旧結果を再sealする負例を拒否 |
| AC-37 | M1 | 生レポートのみ、または現在SHAを後付けした記録 → 内容をaudit表示できるが鮮度検証済みにせず、必須来歴はunknown | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-38 | M1 | Manifest確定後に成果物を改変／前回成果物を流用 → 整合不成立でgate block | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-39 | M1 | PR内JSONが信頼済みproducerを自己申告 → 外部信頼基点と照合できなければproducerTrustはunknown | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-40 | M1 | PR先端と実行マージSHAが異なる正常なPR → 両SHAと親関係を記録し、対象一致を誤判定しない | ローカル検証済み | tests/reports/git-collector.test.ts |
| AC-41 | M1 | merge-base取得不能／マージ結果の行対応不明 → 空差分や100%で代替せずunknown | ローカル検証済み | tests/reports/git-collector.test.ts |
| AC-42 | M1 | ローカルdirty入力、または生成後に対象入力を改変 → auditは状態表示、M1 gateは拒否 | ローカル検証済み | tests/core/trust.test.ts; tests/cli/commands.test.ts |
| AC-43 | M1 | 上流failure／cancel、別attemptの成果物、必須成果物欠損 → passにせず、不合格または未完了として扱う | 外部実地・ローカル検証済み | tests/github/authority.test.ts; [実地記録](evidence/github-protected-rollout.json)：上流失敗/キャンセル、必須archive削除、成功attempt3のarchiveを残した最新attempt4キャンセルをすべてblock |
| AC-44 | M2 | Contractファイル全体を未承認削除／includeから除外／risk引下げ → ベースSnapshotの義務を保持しcriticalをblock | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-45 | M2 | 対象内に静的抽出不能なInline宣言 → 発見のために実行せず、黙って一覧から除外せずunknown | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-46 | M2 | 廃止対象の差分・ハッシュを信頼経路で承認 → 旧義務を失効させ、新しい有効版を評価 | ローカル検証済み | tests/contracts/registry.test.ts |
| AC-47 | M2 | コールバックをモック／期待動作の再実装へ置換 → 比較成功だけで本番対象観測・変異感度をpassにせず、必須観測不足ならblock | 外部実地・ローカル検証済み | scripts/acceptance-flow.mjs; [43666070395](https://github.com/kanoi-y/pdd-ts/actions/runs/43666070395)：偽callbackで通常64成功、観測/カナリアunknown、gate failure |
| AC-48 | M2 | 本番対象へ故障を注入し当該ケースが失敗 → 対象・case・故障内容・失敗結果を別Evidenceとして記録 | 外部実地・ローカル検証済み | scripts/acceptance-flow.mjs; [producer ZIP照合](evidence/github-protected-rollout.json)：実対象・case・故障のハッシュと64件の失敗比較を別Evidenceとして検証 |
| AC-49 | M1 | 変更した対象ソースファイルがLCOVから欠落 → 独立した対象外根拠がなければunknown。分母から黙って除外しない | ローカル検証済み | tests/reports/adapters.test.ts |
| AC-50 | M1 | 最終ゲートskip／削除／偽の同名成功チェック → 保護構成でマージを阻止。保護できない構成を保護済みと表示しない | 外部実地検証済み | [実地記録](evidence/github-protected-rollout.json)：専用結果欠損はblock、候補publisher削除でmainの権威は変わらない。同名App15368 successも必須App5653976を満たさずblock |
| AC-51 | M1 | 保護Policyの信頼基点が未登録／PRが参照元を自己変更 → auditは可能、未登録gateは設定エラー。PRの自己変更では基準を置換しない | ローカル検証済み | tests/cli/commands.test.ts |

M0の5条件と採用判断は[m0-results.md](m0-results.md)、操作数・CIコストは[pdd-adoption-cost.md](pdd-adoption-cost.md)に記録した。

製品のコード修正 `b049d3770c5ee7a298b7c829119e52f069f1b9db` は[3 OS CI43662903592](https://github.com/kanoi-y/BehavProof/actions/runs/43662903592)で成功。Linux/macOS各306件、Windows302件成功・POSIX限定4件skip。各OSのビルド、6パッケージの新規consumer導入、公開フロー、およびLinuxの実PDD隔離コンテナ検証を実行した。ローカル全体検査は直列実行で306/306成功。既定並列実行時の既存CLIテスト1件の15秒超過は記録し、そのテスト単独と直列全体では成功した。時間枠・品質assertionを弱めていない。

消費側PR10は同一HEADへの実Userレビューから登録e236を作り、通常の保護付きSquash mergeで統合した。後続PR16も最新HEAD c4efdfaへの実User Approve、[既存CI43663733427](https://github.com/kanoi-y/pdd-ts/actions/runs/43663733427)の280テスト/proof/配布検証、[PDD保護CI43665330524](https://github.com/kanoi-y/pdd-ts/actions/runs/43665330524)の成功後に通常マージした。現在の保護workflow SHAはc9bf2a1a262248540efda0f89d7ed24e5aa566e5。SDK参照a943と登録e236は保持した。

実GitHubで正常系の専用App successとマージ可能状態（PR19 CLEAN）を確認した後、負例ごとに新HEADを使って失敗/欠損・merge blockを記録した。上流失敗やarchive欠損ではCLI自体が準備不足でskipされるため、実行したかのような内部判定を記載しない。キャンセル時は今回観測したgate実行結果を記録し、GitHubが常にgateを実行するとは一般化しない。

全体独立レビューで再現したManifestのSHA付替えとマージ専用の契約変更による承認流用は、tests/acceptance/local-replay.test.tsとmerge-approval.test.tsで回帰検査する。AC-44/46等の契約削除・廃止承認はRegistryの実行済み自動検査を根拠とし、未実施の外部操作へ置換しない。

旧pdd-ts PR7/8と初期の失敗runは履歴資料である。旧承認を新HEADへ流用せず、HTTP422/CLI127による導入途中の失敗はIntent等の負例検知に数えない。過去の記録は各evidence JSONに保持している。[リポジトリ境界](repository-boundaries.md)のとおり、製品本体は別のpublicリポジトリで管理する。
