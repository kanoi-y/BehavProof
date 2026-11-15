# GitHub実地検証の結果

2026-11-15、[pdd-ts](https://github.com/kanoi-y/pdd-ts)の実受理関数 `canAcceptEvidence` と64 Booleanケースで、専用Appの結果とGitHubのマージ可否を確認した。製品本体は別のpublicリポジトリ[BehavProof](https://github.com/kanoi-y/BehavProof)にある。[導入・再検証の日本語手順](protected-github-deployment.ja.md)、[全SHA/run/job/check/digest](evidence/github-protected-rollout.json)を参照。

## 固定した基準

- SDK：a94329e61bd0a56141b5f6c9f9156b9aa3b29b56。
- producer/publisherの保護workflow：pdd-ts main c9bf2a1a262248540efda0f89d7ed24e5aa566e5。
- 承認登録：e236a6c6af98ad779a90e5892b35bcfbf427f41224a8c864f42ec2cff3323152。PR10同一HEADへの実Userレビューから固定。
- 隔離base：behavproof-enforcement-test、cbafb22fb314c6abf90e624cb5f20d71a4c98175。strict/admin適用で `BehavProof protected gate` / App5653976を必須化。

PR10・修正PR16は、最新HEADへの人間Approveと既存2必須チェック成功後に通常のSquash mergeで統合済み。mainの既存レビュー/チェック/線形履歴保護は維持し、main限定のpdd-publisher環境を利用する。App秘密鍵の読出し・コピーは行っていない。BehavProofをmainの必須チェックには追加していない。

## 観測結果

表の状態はPRがopenのときに記録した。検証PRはすべてマージせず閉じた。PR15はケースごとに新HEADへ進めたため、現在のPR画面だけで過去ケースを判断せず、記録したSHAとrunを参照する。

| ケース | 実際の結果 | 証拠 |
| --- | --- | --- |
| 専用結果がない | GitHub blocked | PR11、最初のdispatch前 |
| 同名successを別Appが発行 | App15368の2件successでも必須App5653976を満たさずblocked | [PR12](https://github.com/kanoi-y/pdd-ts/pull/12) |
| 正常 | 通常64・対象観測64・カナリア64成功、専用App success | [43665923330](https://github.com/kanoi-y/pdd-ts/actions/runs/43665923330) |
| 既存CIも健全な正常対照 | 既存CI/専用Appともsuccess、GitHub CLEAN・MERGEABLE | [PR19](https://github.com/kanoi-y/pdd-ts/pull/19)、[43668079826](https://github.com/kanoi-y/pdd-ts/actions/runs/43668079826) |
| 候補がpublisherを削除 | 実行前は結果欠損でblocked。mainの正規publisherは削除されず、真正な検証後はsuccess | [43666046833](https://github.com/kanoi-y/pdd-ts/actions/runs/43666046833) |
| verifyをskip | 最終gateが実CLIを実行しexit1、App failure、blocked | [43666062415](https://github.com/kanoi-y/pdd-ts/actions/runs/43666062415) |
| 上流が失敗/利用不能 | verifyと準備が失敗。CLI評価はskipし明示的failureを発行、blocked | [43666456733](https://github.com/kanoi-y/pdd-ts/actions/runs/43666456733) |
| verify中にworkflowをcancel | verify cancelled、今回はalways gateが実行されCLI1/App failure、blocked | [43666797379](https://github.com/kanoi-y/pdd-ts/actions/runs/43666797379) |
| 必須archiveを削除 | 元ZIPを保存しdigest照合後、検証専用artifactだけを削除。取得不足からfailure発行、blocked | [43667296542](https://github.com/kanoi-y/pdd-ts/actions/runs/43667296542) |
| 古い成功archiveが残る | 成功attempt3のartifactが一覧/直接取得で残存する状態で最新attempt4をcancel。旧成功は採用せずfailure、blocked | [43668741102](https://github.com/kanoi-y/pdd-ts/actions/runs/43668741102) |
| 未承認Intent変更 | 通常64成功でも変更した宣言/承認不一致を拒否、blocked | [43666057505](https://github.com/kanoi-y/pdd-ts/actions/runs/43666057505) |
| 実装と期待値の同時緩和 | 常時trueと全期待値trueで通常64成功でも、登録済み契約との差からfailure、blocked | [43669115818](https://github.com/kanoi-y/pdd-ts/actions/runs/43669115818) |
| Contract無変更リファクタ | 本番1ファイルだけ変更。同じContract版の64比較・観測・カナリア成功、App success | [43666066341](https://github.com/kanoi-y/pdd-ts/actions/runs/43666066341) |
| 偽callback | 期待値を返して通常64成功。同じContract版でも観測/カナリア128件unknown、gate failure、blocked | [43666070395](https://github.com/kanoi-y/pdd-ts/actions/runs/43666070395) |
| configでtestResultをoff | 保護基準を保持。通常比較/観測/カナリアは成功しても、未承認設定変更はgate failure、blocked | [43669833911](https://github.com/kanoi-y/pdd-ts/actions/runs/43669833911) |
| PolicyファイルでtestResultをoff | producerが新しい承認登録を要求して停止、archive0。publisherがfailureを発行、blocked | [43670116931](https://github.com/kanoi-y/pdd-ts/actions/runs/43670116931) |

通常・リファクタ・Intent・偽callback・期待値緩和・config緩和の6 ZIPは独立にダウンロードし、実バイトのSHA-256とAPI digest、対象head、run、登録digest、workflow SHAを照合した。欠損/古いattemptの操作対象ZIPも事前保存・digest照合済み。

通常PR11/refactor等のGitHub UNSTABLEは、隔離baseでは必須でない旧PDD CIの失敗を含む状態だった。[GitHubの定義](https://docs.github.com/en/graphql/reference/pulls#mergestatestatus)は非成功statusを含むマージ可能状態である。より明瞭な正例としてPR19のCLEANを別に取得した。候補publisher削除だけで永久に失敗する設計ではなく、保護されたmainの検証が必要な設計である。

## 負担と採用判断

PR19の同一HEADで既存CI529 runner秒、追加producer33秒＋verify14秒＋gate27秒＝**74秒（14.0%）**、合計603 runner秒。1回の観測で、CPU・請求額・人間active時間ではない。今回gateは既存CIより先に終了したが、一般的な追加待ち0を保証しない。[実測条件・ファイル数・判断](pdd-adoption-cost.md)を参照。

このbasic-risk局所対象と隔離baseでの限定的な技術採用を可とした。[必須45件の受け入れ表](acceptance.md)と[M0の5条件](m0-results.md)を満たす範囲でM2を完了と判定する。全PDDのcoverage/aggregate mutation、production L3、人間の使いやすさ、長期保守、任意M2-Fはこの判定に含めない。

初期登録は承認済みPolicy更新への移行を実演したものではない。Intent変更はContract版も変えるためIntent単独の失敗原因とは断定しない。キャンセル時のgate実行をあらゆる実行へ一般化しない。初期HTTP422/CLI127は修正前の診断履歴であり、意図した負例の検知として数えない。
