# M0検証結果と採用判断

対象仕様: `BehavProof_開発仕様書_v0.6.md`。2026-11-15にM0の5条件を下記の限定範囲で確認した。必須45件は[受け入れ表](acceptance.md)にまとめた。

| 条件 | 判定と根拠 |
| --- | --- |
| M0-01 生成記録と対象の結合 | 検証済み。Collectorの改変/別run/未登録producer拒否に加え、run/attempt/job/対象SHAとarchive digestを照合。成功attemptのarchiveを残した最新attemptキャンセルでも古い成功を拒否 |
| M0-02 認可の縦スライスと保証限界 | 検証済み。owner/non-ownerの実Vitest正負例・本番故障・偽callbackを公開APIで実行。偽callbackは比較成功でも観測/感度unknownでgate拒否 |
| M0-03 外部承認と保護基準 | 検証済み。同一HEADを実UserがApproveしPolicy/Intent/Contractを外部登録へ固定。未承認Intent/期待値/設定/Policy変更を保護CIで拒否。初期承認の登録であり、新しいPolicy更新を承認して移行する実地遷移とは呼ばない |
| M0-04 最終gateと外部保護 | 検証済み。strict/admin適用の隔離baseで専用Appを必須化。結果欠損、skip、失敗、cancel、archive欠損、別attemptをblock。同名の別Appのsuccessでは必須発行元を満たさない |
| M0-05 作業量・CIコスト・判断 | 検証済み。初回audit5コマンド2526ms（前提付き）、最終接続/CI支援8ファイル、本番初期変更0、リファクタ本番1/Contract0。下記の限定採用判断へ反映。CI増分は導入先ごとに測定すること |

## 採用判断と範囲

導入先のレビュー済み契約と隔離した保護ブランチでの限定的な技術採用を可とする。比較成功から対象観測や故障感度を推論せず、別証拠で判定できること、契約無変更の内部リファクタを受け入れること、未承認緩和を拒否することを確認した。追加CI負担と接続ファイル数は上表の実測に限定して評価する。

この判定は導入先全体の品質、coverage/aggregate mutation、production L3、あらゆるGitHub構成の保護を保証しない。人間のactive編集/レビュー時間、長期の保守負担、CPU・料金は未測定。人間のユーザビリティ調査を実施したとはしない。導入先の既存保護と専用の保護環境を維持し、専用必須チェックの追加先は隔離baseだけである。このM0判定時点では任意M2-F（AC-31〜36）は未実装で範囲外だった。その後、ユーザーが明示選択したM2-Fも実装・実ツール/CI検証を完了した。追加範囲と限定採用判断は [M2-F検証記録](formal-validation.ja.md) を参照。

## 証拠の区別

- [公開APIフロー](evidence/public-flow.json)、[保護probeフロー](evidence/protected-probe-flow.json)：owner/non-owner、skip/削除/偽物の限界を検証。明示的なローカルhost権威は実CI権威とは区別。
- [Collector整合性](evidence/m0-collector-integrity.json)：実Vitest、成果物改変、別run、権威欠損、producer exit7、残存入力変更を検査。悪意ある子孫の完全隔離を単独で証明するものではない。
- [形式調査](evidence/m0-report-formats.json)、[skip/0件](evidence/m0-report-variants.json)、[meta](evidence/m0-metadata-binding.json)、[callback限界](evidence/m0-binding-spike.json)：実ツールの予備実験。ハッシュと出力形式を保持し、ツール全体successをケース実行や本番到達へ昇格させない。
- [初回audit](evidence/first-audit-onboarding.json)：自動処理と操作/編集数の測定。人間active時間は含まない。

製品本体は別publicリポジトリ[kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof)で管理し、導入先は固定SDKを参照する消費側である。[リポジトリ境界](repository-boundaries.md)を参照。
