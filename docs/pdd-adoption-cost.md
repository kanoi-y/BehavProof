# 導入負担とCIコストの実測

実PDDの受理関数と64 Booleanケースに限定して測定した。[同一HEADの生時刻・集計](evidence/pdd-live-adoption-cost.json)と[実地検証結果](github-live-validation.ja.md)を参照。人間のactiveな編集・レビュー時間、CPU使用量、請求額は未測定である。

| 作業 | 実行・変更量 |
| --- | --- |
| 初回audit | Node24/Git・既存sample・ビルド済み6 tarballを前提に5コマンド、計2526ms |
| pdd-ts初期接続 | workflow2件＋Contract/設定/実行データ4件＝6ファイル。本番コード変更0 |
| 既存CI支援の修正 | demo/package-smokeの2ファイル。接続と合わせた最終変更ファイルの和集合は8件 |
| 信頼設定 | 同一HEADの実Userレビュー（PR10、後続PR16）、外部登録1件、Repository Variables3件、App読取権限追加2件、隔離baseの保護1件 |
| 通常のREADME変更 | PR19はcurrent main比README1件、Contract編集0。producer/publisherの2回の手動dispatchを自動操作で実行 |
| 振る舞い不変リファクタ | PR17は本番1ファイル、Contract/Intent/Policy編集0。同じContract版で64ケース再検証 |
| 偽物callback | Contract sourceのcallback1箇所変更。通常64成功でも対象観測/カナリアunknownとなり拒否 |
| 期待値の協調緩和 | 本番1ファイル＋Contract source1ファイル変更。通常64成功でも拒否 |
| 設定/Policy緩和 | それぞれ対象1ファイル。設定offを拒否、Policyファイル変更は新しい承認登録を要求 |

制御実験には上記の実質変更に加え、ケースを区別するREADMEラベルがある。ファイル数や自動処理時間を、人間の編集・判断時間とは呼ばない。初期設定・デバッグ・レビューの負担を通常変更の実行時間へ混ぜない。

## 同一consumer HEADでの追加CI時間

PR19のHEAD `c4a00bfc6468b0c5e23a2bf0f37af1d2cd3420da` で、既存CIと追加ジョブがすべて成功した。対象は同じソースで、製品側の3 OS検査を既存PDD CIから差し引く比較ではない。

| ジョブ | run | runner占有時間 |
| --- | --- | ---: |
| 既存Build/proof/tests/demo/配布検証 | [43667852448](https://github.com/kanoi-y/pdd-ts/actions/runs/43667852448) | 529秒 |
| 追加producer | [43667860767](https://github.com/kanoi-y/pdd-ts/actions/runs/43667860767) | 33秒 |
| 追加publisher verify | [43668079826](https://github.com/kanoi-y/pdd-ts/actions/runs/43668079826) | 14秒 |
| 追加publisher gate | 同上 | 27秒 |
| 追加合計 | | **74秒（既存529秒の14.0%）** |
| 合計 | | **603 runner秒** |

GitHub APIの開始/終了時刻から計算した1回の観測で、秒精度である。並列処理のためgateは既存CIより先に終了し、このrunの追加完了待ちは0秒だった。一般的な追加待ち時間0や性能分布を保証しない。queue/操作待ち、既存の別PDD protected workflow、製品CI、CPU、請求額は集計外。対象ソースには接続ファイルが含まれており、そのファイル走査・ビルド負担を独立には分離していない。

## 初回auditと性能の測定条件

[first-audit-onboarding.json](evidence/first-audit-onboarding.json)の5操作は、offline install / init dry-run / init / doctor / audit。ビルド・tarball準備、Git checkout、Node導入は前提に明記した。auditはexit0/incompleteであり、未収集の実行/承認を合格とはしていない。保護CIの全設定が5操作で終わるという測定ではない。

9,685,187 bytes／12,000 assertionsの合成JSON監査は3回437/714/718ms、中央値714ms。テスト実行を含まず、合成入力のtestResultはunknownを保持する。大規模リポジトリ全般の性能保証ではない。

旧SDKの異なるworkloadの時間は[pdd-adoption-cost.json](evidence/pdd-adoption-cost.json)に履歴として保持する。現行の増分比較には使用しない。

## 採用判断

このbasic-riskの実関数と、発行元に結合した隔離baseでの**限定的な技術採用を可**とする。64比較だけでは見逃す偽物・期待値協調変更・未承認設定緩和を拒否し、契約無変更のリファクタを受け入れた。追加74 runner秒という実測と8ファイルの接続/CI支援差分を、この限定検証の負担として受け入れる。

全PDDやproduction L3への展開、人間の使いやすさ、長期保守負荷、料金の妥当性は未評価。今回の承認登録は初期基準であり、承認済みPolicy更新の遷移を実演したとはしない。pdd-ts mainへBehavProof必須チェックは追加していない。この範囲と未測定項目を明示した評価をM0-05の判断とする。
