# M2-Fの受入検証と採用判断

実装の検証対象はコミット `dde907172077f8091f2f42eb778f738825155716` です。[3 OS CI](https://github.com/kanoi-y/BehavProof/actions/runs/43690547330) と [任意formal CI](https://github.com/kanoi-y/BehavProof/actions/runs/43690547469) が成功しました。PR検証はこのHEADとmainから作ったmerge commit `06768d890d8b2facdeb2f25cbe97fd090f5c87ce` をcheckoutしています。後続の記録更新とは区別しています。

Linux/macOSは各393テスト成功、Windowsは389成功・POSIX限定4件skipでした。通常6パッケージの新規導入、公開API、既存のCollector・保護ゲート・故障フローも3 OSで成功し、Linuxでは実PDDの64入力と隔離コンテナ検証も成功しました。

formal CIでは実Quint 0.33.1の構文・型・モデル内test・simulationと、実Apalache 0.62.4の有界検査が成功しました。8ステップの検査範囲と、simulationの100標本・seed 42、実装再生の10トレース・90比較・90呼出を分けて報告しています。同じDriver/トレースの故障実装では5不一致を検出しました。モデル側の1行の故障はsimulationで同じ反例を2回再現し、有界検査でも失敗しました。

[CI成果物](https://github.com/kanoi-y/BehavProof/actions/runs/43690547469/artifacts/14152147026) のZIP SHA-256を確認し、98ファイル内のモデル結果・receipt・トレース・生結果など84参照のSHA-256を照合しました。[機械可読記録](evidence/formal-validation.json) にCIのHEAD、実際のcheckout、job/step時間、artifact digestと受入条件を残しています。これは小規模fixtureの外部ローカルホストをCIで検証したものであり、新しい実User承認やGitHubマージ強制を実施したという主張ではありません。

## 付録B.9の7条件

| 条件 | 確認した証拠 |
| --- | --- |
| 1. モデル故障 | 正常モデルの選択済み不変条件に対し、取消時の返金加算を1行変更。実simulationと有界verifyが失敗 |
| 2. 実装だけの故障 | モデルとDriverを保ち、故障モジュールで90比較中5不一致。Community Connect 2.1.0の実stateCheckでもStateMismatchError |
| 3. トレース／比較0 | Core・replay・CLIの負例でpass禁止。実装呼出0、必須action未到達、最低件数を満たす部分欠落も拒否 |
| 4. seed再現 | 同じモデル・Quint版・seed・設定の2回で反例hash一致。呼出seedとQuintの選択trace seedは別に記録 |
| 5. 有界検査と再生の範囲 | bounded_model_check / maxSteps=8 / unbounded=falseと、simulation、再生数・比較数を別表示 |
| 6. 代替Driver | Community Connectを必須依存にせず、独立したcreateDriver形式から同じModelConformanceReport/Core評価へ正規化。実CLI→Collector→gateで確認 |
| 7. 導入・CI・保守コスト | 下記の自動実行時間、モデル/Driver規模、実際の1行変更・故障・旧証拠拒否を記録。人間の作業時間は計測していない |

## コストと限定した推奨範囲

同じHEADの通常3 OSジョブは計534 runner秒、任意formalジョブは40秒でした。追加ジョブの占有時間は通常ジョブ合計の7.49%です。並列実行の待ち時間、課金単位、変更前後の因果的な差分を示す数字ではありません。

formalジョブ内では、追加依存の導入が2秒、配布8パッケージの導入検証が8秒、実モデル検査から認証済みgateまでがstep時間19秒（スクリプト内部17.873秒）、Connect互換性検証が1秒でした。NodeとJavaはhosted runnerのtool-cacheから取得しています。ローカルの低速な初回Apalache取得は752.073秒で、その前の600.278秒の時間切れも未検証として記録しています。初回導入コストと通常検査時間を同一視しません。

今回のモデルは41行、Driverは13行、通常実装は18行、故障モジュールは6行です。モデル故障は1ファイル1行の置換で検出しました。Driverへ1行のコメントを追加する変更でも旧証拠を無効化するテストを実行し、新しいDriver hashとContractの意味レビューが必要なことを確認しました。これらは保守対象の規模・変更箇所と自動検証の測定であり、人間が意味の正しさを判断する難しさや作業分数の測定ではありません。

注文・返金のように重要な状態遷移を小さく表せる対象には、明示導入による限定採用を推奨します。モデルと実装それぞれの故障を検出できる利益が確認でき、通常テストへ一律に導入する判断は保留します。Driver・producerの信頼、動的な依存範囲、本番到達、無制限の正しさは別の条件です。

## 独立レビューと実装時の判断

独立レビューで4件のImportantが見つかり、すべて失敗を再現するテストから修正しました。Criticalと保留Minorはありません。

- 最低件数以上のトレース／suffix欠落が申告hashだけで通らないよう、再生入力全体のprojectionを照合。
- モデル単独・canaryなしの設定で、存在しない任意hashをJSONへ含めないよう修正。
- ルート直下のreportでも既定トレースパスが有効になるよう修正。
- errorsが不正な型のツール出力を成功にしないよう、5段階すべてで拒否。

計画からの判断変更は次の4件です。範囲や合格条件は減らしていません。

1. Quintの出力seedは選択trace seedだったため、呼出seedと分離しました。誤ると再現性の比較を誤判定するため、同じ条件での実反例再現で確認しました。
2. 実Apalache検査は実行環境を用意できるTask 5で実施しました。誤るとsimulationを形式検査と誤認するため、実verifyとCIが成功するまで完了にしませんでした。
3. 全体formal-flowはCLI完成後のTask 4/5へ移しました。誤るとlibraryだけを検証してCLIの来歴接続が未確認になるため、実Collector→gateまで実行しました。
4. 承認サービスの一時的な利用制限中にソースレビューを前倒ししました。後続変更の見落としが生じ得るため、修正後の全393テスト・実ツールフロー・3 OS CIを完走しました。
