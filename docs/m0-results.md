# M0検証記録

> Repository ownership update: BehavProof is now managed in [kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof). The copied-source pdd-ts PRs7/8 were closed without merging. Their run/review records below are historical evidence; the old PR8 approval/deployment request is superseded. Future pdd-ts changes are thin consumer integration only. See [repository boundaries](repository-boundaries.md).


対象仕様: `BehavProof_開発仕様書_v0.6.md`。この記録は実装・検証に応じて更新する。未検証を合格として扱わない。

| 条件 | 現在の状態 | 証拠・次の確認 |
| --- | --- | --- |
| M0-01 生成記録と対象の結合 | ローカル正負検証・CI成果物の同一性を検証 | 公開Collectorの正負例と3 OSの実CI・ZIP digest/内容を確認。独立した本番用producer権威の登録は未完了 |
| M0-02 認可の最小縦スライス | 実承認ソースのケース別観測・カナリアをローカル検証済み | 実Vitestで正常実装2成功、本番故障1失敗、偽物コールバック2成功。公開ヘルパー＋Collector＋CLIで実行。新workerで本番呼び出し・同一callback故障を別観測し、偽物はunknown。外部CI/保護は未完了 |
| M0-03 外部承認とPolicy更新 | 実Approveと固定基準の結合済み・保護CI更新待ち | PR #7の実ソースから契約ハッシュを計算。未承認時unknownから、実User Approve後Policy/Intent/Contract passを確認。登録digest固定で実5cbソースを再実行した（approved-probe-live.json） |
| M0-04 最終ゲートと外部保護 | 事前調査のみ | mainは発行元に結合した2チェックとレビューを必須としている。BehavProof自身のskip・削除・同名偽装への耐性は未検証 |
| M0-05 作業量・CIコスト | ローカルと3 OS CIの実行時間を計測 | public-flow.json/github-hosted.jsonに時間、audit-throughput.jsonに約10MB解析の中央値。人間の作業時間・料金/CPUは未計測 |

## GitHub事前調査（2026-11-13）

ユーザー指定の検証先は `https://github.com/kanoi-y/pdd-ts`。mainの観測SHAは `dd06da788bef5cfbe7f9131fe5609a61cefbd458`。既存のmainや保護設定は変更していない。

接続ツールでは一般のbranch情報は取得できたが、branch-protection詳細は403だった。権限を持つGitHub CLIのGETで、必須チェック名／App ID、strict、admin適用、承認数、古いレビューの失効を確認できた。これらは検証先の現状であり、BehavProofの完成証拠ではない。

構造化した観測値は `docs/evidence/github-preflight.json` に記録した。秘密情報や認証トークンは記録していない。実地検証は独立した候補を準備してから行い、必要な人間のレビューや保護設定変更を自動的に代行・捏造しない。

## コールバックの保証限界の予備実験

実行: `node scripts/spikes/binding-limit.mjs`。Node.js v24.14.1／Vitest 5.1.0で、実際のVitestプロセスとJSON reporterを使った。

| 入力・操作 | 実際の結果 |
| --- | --- |
| 正常な本番関数を呼び、owner／non-ownerを比較 | exit 0、2成功 |
| 本番関数を常にallowedへ変更し、同じ関数を呼ぶ | exit 1、owner成功／non-owner失敗 |
| 本番関数を壊したまま、コールバック内で期待動作を再実装 | exit 0、2成功 |

実装とレポートのハッシュ、ケース別状態、実行時間は `docs/evidence/m0-binding-spike.json` に記録した。実験コードはthrowawayと明記している。これは比較成功から本番到達を推論できないことの観測であり、まだ製品のContractヘルパー・Collector・外部承認の完成証拠ではない。

## 実ツールのレポート形式

同じ認可2ケースについてVitest 5.1.0（coverage-v8 5.1.0）とStrykerJS 10.1.1／Vitest runner 10.1.1を実行した。Vitestは2成功・0失敗、Strykerは6変異を生成して6件Killed、Survived／Timeout／NoCoverage／Errorsは0件だった。これは当該小規模関数の観測であり、製品や要求全体の完全性を示さない。

生成したJSON／LCOVを `tests/fixtures/reports/` に置いた。機械固有の絶対パスだけを `<project-root>` へ正規化し、元の成果物とfixtureのハッシュ・変換内容を `docs/evidence/m0-report-formats.json` に記録した。製品Collectorによる生成記録の検証は未完了であり、レポートの存在だけを来歴の証拠とはしない。

追加実行: `node scripts/spikes/report-variants.mjs`。1件成功・1件skipでもVitestはexit 0／success=true、`passWithNoTests`で0件でもexit 0／success=trueとなった。結果は `docs/evidence/m0-report-variants.json` と実JSON fixtureに保存した。アダプターはツール全体のsuccessだけを見ず、必須ケース一覧・実行件数・skipを別に検査する必要がある。

## IDバインディングに使うVitest API

実行: `node scripts/spikes/metadata-binding.mjs`。Vitest 5.1.0の`test`オプションの`meta`へContract ID／Case ID／契約版を登録した。表示名をこれらと無関係にしても、JSON reporterは実行したownerとskipしたnon-ownerの両方で同じIDメタデータを保持した。5.1.0のケース状態はskip時に`skipped`であり、古い形式を想定した予備実験の`pending`期待値を実レポート確認後に修正した。

結果は `docs/evidence/m0-metadata-binding.json`。登録時メタデータは宣言にすぎず、比較処理の実行数・結果・バインディングハッシュは製品ヘルパーが別途記録・検証する。本番実装への到達はこのメタデータから推定しない。

## 外部権威のAPI形状の確認

検証先の過去PR #6について、PR作成者がgithub-actions[bot]、承認者がkanoi-y、レビュー対象コミットが当該PR先端と一致していることをRESTの実データで確認した。同じコミット上に独立したApp ID 5653976のPDDチェックがあることも確認した。観測値は `docs/evidence/github-historical-authority.json`、元の公開API応答は `tests/fixtures/github/` に保存した。

これは外部レビュー・発行元・コミットの識別が取得できるという実現性確認である。過去のPDD承認／チェックを、新規BehavProof契約の承認やBehavProofの合格として流用しない。新しい変更に対する実地検証は未完了。

## 公開Collectorと生成記録のローカル検証

実行: `node scripts/spikes/collector-integrity.mjs`。クリーンな一時Gitリポジトリを作り、公開`collect` APIで実Vitestの認可2ケースを実行した。期待する入力ツリー・設定・実行ID・コマンド・出力一覧・ローカルproducer権威は、呼び出し側で実行前に決めた。Manifest自身の値から権威を作ってはいない。

| 操作 | 実際の結果 |
| --- | --- |
| 正常な実行・生成記録・成果物を照合 | integrity／producer／subject／executionの各軸がpass |
| JSONとして有効な空白を成果物に追加 | integrity fail |
| 現在の必須実行IDを別runへ変更 | subject fail |
| 呼出側のproducer権威を与えない | producer unknown |
| producerをexit 7で終了 | sealed artifact 0件 |
| 実行中に入力ソースを変更して残す | Collectorが入力変更を拒否 |

結果は `docs/evidence/m0-collector-integrity.json`。ローカル呼出側が明示的に選んだ権威と共有依存を使った実験であり、CI認証・人間の承認・一時的に変更して戻す攻撃・悪意ある子孫プロセスの隔離を実証したものではない。最終版でも同じ実験を再実行して確認する。

## 製品の公開フロー（現行版）

`node scripts/acceptance-flow.mjs` は公開Collector・Vitestヘルパー/reporter・ビルド済みCLIを使い、一時Gitリポジトリで実行する。明示したローカルhost権威であり、人間承認やCI認証の代替にはしない。

- 正常なowner/non-owner：2ケースの比較・bindingはpass。契約を変更しない内部リファクタ後もpass。
- 偽コールバック：比較はpassになり得るが、本番観測・変異感度はunknown。
- 所有権判定の故障：実Vitestが失敗し、Collectorのsealed artifactは0。
- non-ownerのskip/削除：必須ケース比較はunknown、ゲートexit1。
- criticalの完全ゲートは、正常ケースでもcoverage/mutation・個別観測・外部パイプライン保護が未充足のためexit1。比較成功と完全ゲートを区別する。
- 認証された比較をMarkdown文書へ生成し、owner/non-ownerのpassを確認した。宣言・比較から本番到達は推論しない。

初回観測（macOS / Node24.14.1、この小規模fixtureのみ）：収集＋CLI評価は正常2255ms、リファクタ2755ms、偽物2850ms、故障2692ms、skip2190ms、削除2787ms。各実行の実測は `docs/evidence/public-flow.json` に記録。人間の導入・変更判断時間、CPU、料金、実運用の保守負荷を示す測定ではない。

`node scripts/package-smoke.mjs` で6パッケージをnpm packし、別の一時consumerにoffline install、公開export・CLI help・同梱schemaを確認した。npm公開はしていない。

`node scripts/github-live.mjs` の実API観測では既存PDD保護はpass、BehavProof用contextはunknown。mainや保護設定は変更していない。新しいBehavProof変更への人間承認とskip/削除/偽発行元への実地保護は引き続き未完了。


## 実CI・性能の追加検証

検証先のhead `285d7f5ce5df0607ae1e1bb6b65af978a5afe24b` に対する [run43544612600](https://github.com/kanoi-y/pdd-ts/actions/runs/43544612600) で、Windows/macOS/Linuxの各182テスト・クリーンビルド・6パッケージのオンライン新規導入・公開フローが成功した。Node24.22.2/npm11.19.1。3成果物のZIPをダウンロードし、GitHub APIのdigest、展開した既知の2ファイルと公開ZIP検証APIを照合した。詳細は `docs/evidence/github-hosted.json`。

| OS | 検証job占有時間 | 正常な収集＋監査 | リファクタ後 |
| --- | ---: | ---: | ---: |
| Linux | 49秒 | 1460ms | 1322ms |
| macOS | 62秒 | 1651ms | 1481ms |
| Windows | 134秒 | 4307ms | 4191ms |

3検証job合計は245 runner秒（並列実行）。料金・CPU使用量・人間の作業負荷の測定ではない。これらのCI内fixtureは明示的なローカルhost権威を使い、独立した本番用CI権威やBehavProof必須ゲートの登録へ昇格させない。

NFR-03の初期性能目標について、`node scripts/benchmark-audit.mjs` で9,685,187 bytes／12,000 assertionsの合成JSONを3回監査し、439/851/854ms、中央値851msを観測した。テスト実行を含まない単一ファイルの解析・監査測定であり、合成レポートのtestResultはunknownを保持する。大規模リポジトリ・意味的品質・メモリ・人間の使いやすさの保証ではない。

PR #7のBotレビューで判明した「重複mode/help/versionによる最終コマンドの迂回」「実行要件のない契約が集計から消える」は別途回帰テストで再現し修正した。旧headの3 OS成功を修正後HEADの成功として流用せず、再実行する。人間のApproveは現在未取得で、CLIも承認をunknownとして記録する。

修正版head `5cb1133` の [run43548473145](https://github.com/kanoi-y/pdd-ts/actions/runs/43548473145) は各OS192テスト・ビルド・新規consumer導入・公開フローまで成功した。3 ZIPのdigestと内容を再照合し、故障注入ではnon-ownerの実際の失敗比較1回・契約版・binding・診断ハッシュを確認した。記録は `docs/evidence/github-hosted-review-fixes.json`。失敗runの診断を正常テスト証拠や本番CI権威へ昇格させない。

## 承認済み実ソースと収集の結合

PR7の実コミット5cb1133を一時checkoutし、外部登録済みcedc7a15…の全source hashと照合。Git SHAを付け替えず、nested projectの元のGit履歴・base・clean subjectを保持して新worker→Collector→CLIを実行した。Intent/Contract/Policyの保持、本番呼び出しと同一callbackのケース別故障検知を確認した（docs/evidence/approved-probe-live.json）。実行権威は明示的なローカルhostであり、CI producer・外部必須ゲートの登録には昇格しない。coverage・十分なmutation score・外部保護がないcritical全体はexit1/incompleteのまま。

## 保護CI導入案の最終実CI

[PR8](https://github.com/kanoi-y/pdd-ts/pull/8) の7bcfa1dに対する [run43579133741](https://github.com/kanoi-y/pdd-ts/actions/runs/43579133741) は、Linux/macOS各287件、Windows284件（POSIX限定3件skip）、ビルド・配布consumer・実Collector/probe/CLIが成功。Linuxでは固定イメージのネットワーク無効/読取専用/非rootコンテナの5シナリオも成功。3成果物ZIPのdigest/実バイト/実フロー記録は独立照合済み（github-hosted-protected-proposal.json）。無承認Intentを拒否する新しいbasic-risk正例プロジェクトはcriticalの承認済み基準を変更しない。

このCIはライブラリ・導入案の検証であり、登録済み本番producer/Appによるチェック発行ではない。PR8同一HEADの新しい人間承認と具体的な導入許可を求めている。main/既存環境保護は維持し、外部AC-18/22/50を完了扱いにしない。
