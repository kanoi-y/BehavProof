# Protected Quality CI の導入

## 現行の登録とゲート

導入先で Node.js 24 とコミット済みの `package-lock.json` を用意します。BehavProof の設定は `schemaVersion: 2` を使用します。Quint を採用するプロジェクトは、対象モジュールと検証条件を設定します。Producer の実行環境は Linux x64 で、Docker の `bind-recursive=disabled` を使います。

1. `behavproof doctor --quality` で Runner、lint、型検査を確認します。`ci plan` に対象リポジトリ、保護ブランチ、信頼済みワークフローブランチ、BehavProof SDK のコミット SHA、専用 GitHub App ID を渡します。
2. `ci apply --plan <計画ファイル> --dry-run` で変更内容を確認し、`--dry-run` を外して適用します。生成する Producer と Publisher のワークフローを信頼済みブランチに配置します。
3. Publisher の環境 `behavproof-publisher` を信頼済みワークフローブランチに制限し、独立レビューと自己承認・管理者バイパスの防止を設定します。専用 App の秘密鍵をその環境に登録します。保護対象ブランチでは、同じ App を発行元とする必須チェックと、最新のベースに対するレビューを設定します。
4. 対象の PR が独立レビューを受けた後、保護ホストで `ci enroll --pr <番号> --workflow-sha <SHA> --reviewers <ログイン名> --registration <外部パス>` を実行します。保護されたリポジトリ変数に `BEHAVPROOF_WORKFLOW_SHA`、`BEHAVPROOF_REGISTRATION_JSON`、`BEHAVPROOF_REGISTRATION_DIGEST` を登録します。
5. 専用の `behavproof-registry` ブランチを保護し、外部登録とそのダイジェストで `ci init-registry` を実行します。同じ登録とダイジェストで `ci verify` を実行します。
6. 開いている PR を指定して Producer を手動実行し、完了した Producer の run ID を Publisher に渡します。専用 App の必須結果を確認します。採用済みの仕様・必須範囲・例外が変わった PR をマージした後は、Publisher のチェック ID を添えて保護ホストで `ci advance` を実行します。

既存の必須チェックは、独立した登録、証拠の収集と認証、新しい App の発行元を一連の受け入れで確認するまで有効にします。手順の詳細は [仕様登録](formal.ja.md#マージ後の仕様登録) と [Trust Root](trust-root.md) を参照してください。

## 過去の pdd-ts 導入記録

BehavProof本体は別のpublicリポジトリ[kanoi-y/BehavProof](https://github.com/kanoi-y/BehavProof)、[pdd-ts](https://github.com/kanoi-y/pdd-ts)は価値検証に使う消費側です。pdd-tsへ製品コードはコピーせず、固定SDKを参照します。

## 現在の導入状態（2026-11-15）

PR10と修正PR16は、同一HEADへの実User Approveと既存必須チェック成功後に通常のSquash mergeで統合済みです。AppのActions/Administration Read-only追加と既存インストールへの承認、変数3件、隔離baseの保護も適用・読み戻し済みです。以降の手順1〜6は初期設定の記録と再現手順です。**現在のpdd-tsで通常検証する場合は手順7から開始します。 SDK更新PR21も実Approveと既存必須チェック後に統合し、新SDKで6ケースを再検証済みです。[SDK3950の再検証結果](#sdk3950の再検証結果)を参照してください。**

| 項目 | 現在値 |
| --- | --- |
| SDK固定参照 | 3950ed506a83697b3927a17e22f147484e9ac335（SDK更新PR21統合） |
| 保護workflow/main SHA | acd4996232b570fa34542e353e66ce1879c10dad（PR21統合） |
| 初期承認 | PR10 HEAD0046da6…をkanoi-yがApprove |
| 登録digest | e236a6c6af98ad779a90e5892b35bcfbf427f41224a8c864f42ec2cff3323152 |
| 実対象 | src/verification/acceptance.ts#canAcceptEvidence、64 Booleanケース |
| 隔離base | behavproof-enforcement-test、SHA cbafb22fb314c6abf90e624cb5f20d71a4c98175 |
| 必須チェック/発行元 | BehavProof protected gate / App5653976、strict・管理者適用 |
| App鍵の環境 | 既存pdd-publisher、main限定。鍵は取り出さず使用 |

[実地検証の結果表](github-live-validation.ja.md)では正常/refactorの成功と、skip・cancel・欠損・古いattempt・偽発行元・未承認変更等の拒否を確認できます。初回SDK a943の同一HEADで測った追加CIは74 runner秒（既存529秒比14.0%）。対象はbasic-riskの局所検証で、全PDDのcoverage/mutation品質やproduction L3の保証ではありません。pdd-ts mainの既存保護と環境保護は維持し、BehavProof必須チェックは隔離baseだけに追加しています。

PR16はビルド後にCLI binを作る1行と、既存配布検証の全体タイムアウト/診断を修正しました。[既存CI43663733427](https://github.com/kanoi-y/pdd-ts/actions/runs/43663733427)と[PDD保護CI43665330524](https://github.com/kanoi-y/pdd-ts/actions/runs/43665330524)が成功し、最新HEADへのApprove後にマージ済み。この初回導入時点ではWORKFLOW_SHAをc9へ更新し、SDK a943・登録e236を保持しました。その後のSDK更新PR21でSDK3950・WORKFLOW_SHA acd4996へ更新し、登録e236を維持しています。初期の権限不足HTTP422とCLI127は修正前の診断履歴であり、負例検知の証拠に数えません。

操作にはGitHub CLI（gh）と、対象リポジトリの必要権限を持つログインを前提とします。登録JSONは登録時のMacに保存済みです。別端末へ秘密鍵をコピーする必要はありません。

## 1. 人間のApproveを承認登録へ結び付ける【実施済み】

【実施済み・初期登録の記録】この工程はPR10をマージする前に行いました。現在の登録スクリプトは、openなPRの同一HEADのレビュー・権限・保護設定を照合します。

以下のコマンドはPR10がopenだった登録時の実施記録です。現在のPR10はマージ済みなので再実行しません。新しいPolicy/Intent/Contractを採用するときは、openな新PRの同一HEADレビューから新規登録を作成します。

~~~bash
BEHAVPROOF_REG_DIR="$HOME/.local/share/behavproof/registrations/kanoi-y-pdd-ts"
node scripts/enroll-enforcement-probe.mjs \
  --pr 10 \
  --directory "$BEHAVPROOF_REG_DIR"
~~~

出力のsourceCommitが0046da6…、Policy・Intent・ContractのapprovedByがkanoi-yであることを確認します。登録ファイルはGit管理外の所有者専用ディレクトリへ保存します。

今回の登録は実PDD受理関数のbasic-risk検証用です。過去のNode認可例のcritical登録とは別です。全PDDのcoverageやaggregate mutation scoreを保証する登録ではありません。

## 2. 既存PDDの必須チェックを通す【実施済み】

main統合には、既存のBuild, proof and testsに加え、PDD protected gateも必要です。後者はmainからの手動起動型です。

~~~bash
gh workflow run pdd.yml \
  --repo kanoi-y/pdd-ts \
  --ref main \
  -f pull_number=10
~~~

今回の事前検証は [run43641901595](https://github.com/kanoi-y/pdd-ts/actions/runs/43641901595) で成功しました。最新HEAD 0046da6…上のBuild, proof and testsと、App5653976が発行した[PDD protected gate](https://github.com/kanoi-y/pdd-ts/runs/132592590132)のsuccessを確認済みです。これは既存PDDのチェックです。これから導入するBehavProof protected gateの実地検証は手順7以降で行います。

## 3. PR10をpdd-ts mainへ統合する

GitHubの通常のSquash merge操作で取り込みます。CLIなら、HEADを固定して実行します。この工程は完了済みです。PR16も同じ保護要件を満たしてSquash merge済みです。

~~~bash
gh pr merge 10 --repo kanoi-y/pdd-ts \
  --squash \
  --match-head-commit 0046da6be489e4c4d0992bb6cfa128bddebf063d
~~~

保護条件が満たされないときは原因を解消します。管理者による保護の迂回は、この手順に含めません。

統合後のmainには、次の2ファイルが置かれます。

- .github/workflows/behavproof-producer.yml：候補PRのコードを隔離コンテナで実行し、証拠を収集。
- .github/workflows/behavproof-publisher.yml：証拠とGitHub状態を照合し、専用Appで結果を発行。

SDKそのものはkanoi-y/BehavProofの固定コミットから取得します。

## 4. 既存GitHub Appへ読取権限を追加する

GitHubのアカウント設定 → Developer settings → GitHub Apps → 対象AppのEdit → Permissions & events → Repository permissionsを開きます。

| 権限 | 設定 | 用途 |
| --- | --- | --- |
| Actions | Read-onlyへ追加 | workflow/run/job/artifactの照合 |
| Administration | Read-onlyへ追加 | 必須チェック・発行元・ブランチ保護の照合 |
| Checks | 既存Read and writeを利用 | 専用チェックの発行 |
| Contents / Pull requests | 既存Read-onlyを利用 | ソースとPRの照合 |
| Metadata | 既存の暗黙Read-only | リポジトリ識別 |

Save changes後、インストール側にも追加権限の承認要求が出た場合は承認します。登録側の変更とインストール側の承認が必要です。[GitHub公式手順](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)

既存pdd-publisher環境のPDD_APP_IDとPDD_APP_PRIVATE_KEYを利用します。既存鍵の取り出し・コピー・再生成は必要ありません。候補コードを実行するコンテナには、この資格情報を渡しません。

## 5. Repository Variablesを3件登録する

pdd-tsのSettings → Secrets and variables → Actions → Variablesで設定します。producer/verifyにも必要なので、Repository Variablesへ登録します。

| 名前 | 値 |
| --- | --- |
| BEHAVPROOF_WORKFLOW_SHA | 最新の保護workflowを統合したpdd-ts mainの完全なSHA。現在はPR21のacd4996… |
| BEHAVPROOF_REGISTRATION_JSON | 手順1で保存した登録ファイルのJSON全体 |
| BEHAVPROOF_REGISTRATION_DIGEST | enrollの出力registrationDigest。今回e236a6… |

SDKのSHA 3950ed5…はワークフローへ固定済みです。ここで登録するWORKFLOW_SHAはpdd-ts側のmainを指します。digestには登録スクリプトの出力を使います。

~~~bash
BEHAVPROOF_WORKFLOW_SHA="$(gh pr view 21 --repo kanoi-y/pdd-ts --json mergeCommit --jq .mergeCommit.oid)"
BEHAVPROOF_REGISTRATION_FILE="$HOME/.local/share/behavproof/registrations/kanoi-y-pdd-ts/registration-e236a6c6af98ad779a90e5892b35bcfbf427f41224a8c864f42ec2cff3323152.json"

gh variable set BEHAVPROOF_REGISTRATION_JSON --repo kanoi-y/pdd-ts \
  < "$BEHAVPROOF_REGISTRATION_FILE"

gh variable set BEHAVPROOF_REGISTRATION_DIGEST --repo kanoi-y/pdd-ts \
  --body e236a6c6af98ad779a90e5892b35bcfbf427f41224a8c864f42ec2cff3323152

gh variable set BEHAVPROOF_WORKFLOW_SHA --repo kanoi-y/pdd-ts \
  --body "$BEHAVPROOF_WORKFLOW_SHA"
~~~

上のSHAが空またはnullなら、まだマージされていないため登録を進めません。mainがこのマージコミットを指すことも確認します。mainが進むとgithub.workflow_shaも変わります。検証中は参照を固定し、後からmainが更新された場合は定義を確認してWORKFLOW_SHAを更新します。

## 6. 新しい検証用ブランチを作り、発行元付き必須チェックを設定する

【作成・設定済み】初期PR10統合時のcbafb22を起点に作成しました。既存ブランチへの作成コマンドは再実行しません。新環境で再現するときは、その環境のレビュー済みbase SHAを指定します。

~~~bash
gh api --method POST repos/kanoi-y/pdd-ts/git/refs \
  -f ref=refs/heads/behavproof-enforcement-test \
  -f sha="$BEHAVPROOF_WORKFLOW_SHA"
~~~

作成成功後、その新しいブランチだけに以下の保護を設定します。チェック名とApp IDの両方を指定します。[GitHub公式API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection)

~~~bash
gh api --method PUT \
  repos/kanoi-y/pdd-ts/branches/behavproof-enforcement-test/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "BehavProof protected gate", "app_id": 5653976}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
~~~

これは検証用の構成です。追加のPRレビュー要件を置かず、専用チェック自体によるマージ可否を切り分けます。Policy/Intent/Contractの信頼基準は、main向けPR10の人間レビューから登録したものです。変更を採用するときは新しい承認登録を行います。

## 7. 正常な検証PRで、収集→照合→マージ可否を確認する

比較先をbehavproof-enforcement-testとする検証PRを作ります。最初はREADMEの検証用追記など、既存Contractを変えない変更にします。例えば、手元のpdd-tsの作業と混ざらない一時checkoutで作成できます。

~~~bash
BEHAVPROOF_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/behavproof-live.XXXXXX")"
gh repo clone kanoi-y/pdd-ts "$BEHAVPROOF_TEST_DIR/pdd-ts"
cd "$BEHAVPROOF_TEST_DIR/pdd-ts"
git switch -c codex/behavproof-positive origin/main
printf '\nBehavProof導入の正常系検証。\n' >> README.md
git add README.md
git commit -m "docs: add BehavProof positive control"
git push -u origin codex/behavproof-positive
gh pr create --repo kanoi-y/pdd-ts \
  --base behavproof-enforcement-test --head codex/behavproof-positive \
  --title "BehavProof正常系の実地検証" \
  --body "実PDD受理関数の証拠収集と専用Appによる必須チェックを確認する検証用PR。"
~~~

このPRも検証後はマージせず閉じます。作成された実際のPR番号を以下の変数に設定します。

~~~bash
BEHAVPROOF_TEST_PR='実際の検証PR番号'

gh workflow run behavproof-producer.yml \
  --repo kanoi-y/pdd-ts --ref main \
  -f pr="$BEHAVPROOF_TEST_PR"

gh run list --repo kanoi-y/pdd-ts \
  --workflow behavproof-producer.yml --limit 5
~~~

対象PRのproducer実行が成功したら、そのrun IDを指定します。job IDやartifact IDではありません。

~~~bash
BEHAVPROOF_PRODUCER_RUN_ID='成功したproducerのrun ID'

gh workflow run behavproof-publisher.yml \
  --repo kanoi-y/pdd-ts --ref main \
  -f pr="$BEHAVPROOF_TEST_PR" \
  -f producer_run="$BEHAVPROOF_PRODUCER_RUN_ID" \
  -f skip_verify=false
~~~

両workflowはmainから実行し、テスト対象は入力したPR先端です。workflowのhead SHAと、テスト対象PRのSHAは別に記録・照合されます。

確認するのは次の4点です。

1. 実PDD関数の64ケース、本番呼び出し、ケース別故障感度が成立する。
2. 現在のrun/attempt/job、成果物digest、対象ソースが照合される。
3. PRにBehavProof protected gateのsuccessが付き、発行元がApp5653976である。
4. GitHub側で、この必須チェックが充足されマージ可能になる。

確認例：

~~~bash
gh pr view "$BEHAVPROOF_TEST_PR" --repo kanoi-y/pdd-ts \
  --json headRefOid,baseRefOid,mergeable,mergeStateStatus,statusCheckRollup

gh api "repos/kanoi-y/pdd-ts/commits/PR_HEAD_SHA/check-runs" \
  --jq '.check_runs[] | {name, conclusion, app_id: .app.id}'
~~~

最後のPR_HEAD_SHAは取得した実際の先端SHAへ置き換えます。

## 8. 負のケースで、本当にマージが止まるか確認する

正常系を基準に、独立した使い捨てPR/HEADを作って確認します。検証用PRはマージしません。

| 操作 | 期待する結果 |
| --- | --- |
| publisherをまだ実行しない | 専用結果がなく、マージ不可 |
| publisher入力skip_verify=true | verifyがskip、gateが動いてblock |
| 失敗・未登録のproducerを指定 | verify/gateの失敗または専用結果不足でblock |
| verify中のworkflowをキャンセル | 実際のjob状態と、専用結果の失敗/欠損によるblockを確認 |
| 検証用の必須artifactを保存後に削除 | 旧成果物に頼れずblock |
| 成功attempt3のarchiveを残してジョブ単位rerunのattempt4をキャンセル | 古いattemptの成功を使わずblock |
| 候補側でpublisherを削除 | 実行前は専用結果欠損でblock。mainの正規publisherが真正な証拠を検証すればsuccessになり得る |
| 同名successをGitHub Actionsから出す | App15368の成功では、必須App5653976を満たせずblock |
| Intent/期待値/Policyを未承認で緩和 | 登録済み義務/承認との不一致でblock |

skipの実行例です。別の検証PRと、そのPRの正しいproducer runを使います。

~~~bash
gh workflow run behavproof-publisher.yml \
  --repo kanoi-y/pdd-ts --ref main \
  -f pr="$BEHAVPROOF_TEST_PR" \
  -f producer_run="$BEHAVPROOF_PRODUCER_RUN_ID" \
  -f skip_verify=true
~~~

キャンセル時はgateまでキャンセルされる場合もあるため、gateが必ず実行されるとは仮定せず、専用結果が無い場合にもGitHubがマージを止めることを記録します。artifact削除は、証拠を保存した検証専用runに限定します。

## 9. 記録とM2完了の判断

各ケースについてPR head/base、workflow/run/attempt/job、内部結果、専用Appの結果/欠損、GitHubのマージ可否、保護設定と成果物のハッシュを残します。

初期導入・リファクタ・Contract変更の操作数、既存CIに追加されるproducer/publisherの時間も記録し、保証範囲と導入負担を判断します。製品の3 OS CI成功を、ここでの実マージ保護の成功へ置き換えません。

実施済みの結果と採用範囲は[実地検証結果](github-live-validation.ja.md)、[受け入れ表](acceptance.md)、[M0判断](m0-results.md)を参照してください。未実施の新環境や新Policyへの更新まで検証済みとは扱いません。

## SDK3950の再検証結果

2026-11-15、[SDK更新PR21](https://github.com/kanoi-y/pdd-ts/pull/21)を最新HEAD 9f8d8acへのkanoi-yの実Approve、[PR21自身の通常CI](https://github.com/kanoi-y/pdd-ts/actions/runs/43698171015)、[既存PDD保護CIのattempt2](https://github.com/kanoi-y/pdd-ts/actions/runs/43697340814)の成功後、保護を迂回せず通常Squash mergeしました。統合後mainはacd4996232b570fa34542e353e66ce1879c10dadで、[統合後CI](https://github.com/kanoi-y/pdd-ts/actions/runs/43699565973)も成功しています。通常CIは型検査・280テスト・実証明・正常/負例デモ・配布後自己検証を含みます。

producer/publisherのSDK固定参照6箇所を3950ed506a83697b3927a17e22f147484e9ac335へ更新し、BEHAVPROOF_WORKFLOW_SHAだけをpdd-tsの統合SHA acd4996へ更新・読み戻しました。登録JSONの実バイトhashと登録digestはともにe236a6c6af98ad779a90e5892b35bcfbf427f41224a8c864f42ec2cff3323152で不変です。main・隔離baseの保護と、pdd-publisher環境の保護/許可ブランチもAPIで更新前後を照合し、一致を確認しました。App権限・秘密鍵は変更していません。

下記は新SDKのmain-only producer/publisherで実行した6ケースです。producerのworkflow sourceはすべてacd4996であり、候補HEADとは別です。発行元はすべてApp5653976の「BehavProof protected gate」です。マージ前に必須だった「PDD protected gate」と混同しません。

| ケース / 対象HEAD | 実際の結果 | producer / publisher |
| --- | --- | --- |
| 正常 / 97f7da2 | 64比較・64観測・64カナリアpass。App success、GitHub CLEAN | [収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43699641670) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43699752890) |
| Contract無変更リファクタ / f26b5a1 | 本番関数の括弧付けだけを変更。同じContract版で64比較・観測・カナリアpass、App success。観測時は任意CI実行中でMERGEABLE/UNSTABLE | [収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43700137597) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43700230838) |
| 偽callback / da3aa4b | 通常64比較がpassでも観測/カナリア各64 unknown。認証済み準備後のgateがexit1、App failure、GitHub BLOCKED | [収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43699644983) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43699755484) |
| 実装だけを常時true / b5af889 | 新しい診断manifestがproducer exit1、成功artifact0を記録。未成功producerからの採用を拒否しApp failure、BLOCKED。実比較63失敗は別途新SDKのローカル実PDDフローで確認 | [収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43700139982) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43700233439) |
| 実装と期待値の未承認同時緩和 / 9b33165 | 通常64比較はpass、Contract版が承認済み版と不一致。verify/認証準備は成功してもgate exit1、App failure、BLOCKED。単一の評価理由だけで失敗したとは断定しない | [収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43700542251) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43700740167) |
| verify skip / f26b5a1 | 同じ現HEADの有効なリファクタ証拠を使用。verifyが実際にskipped、gateは実行されexit1、App failure、BLOCKED | [有効な収集](https://github.com/kanoi-y/pdd-ts/actions/runs/43700137597) / [判定](https://github.com/kanoi-y/pdd-ts/actions/runs/43700476750) |

正常/リファクタのContract revisionは6b04658610ae1d6426eb897a29253419764b13dbdd2d32aa703fea067ae42580で一致しました。[検証PR22](https://github.com/kanoi-y/pdd-ts/pull/22)と[検証PR23](https://github.com/kanoi-y/pdd-ts/pull/23)はケースごとにHEADを進め、記録後に未マージで閉じています。PRの現在画面は最終ケースを示すため、過去の成功判定は上記runと対象HEADで確認します。最後のskip判定は同じf26b5a1への先のsuccessをfailureへ更新する、意図した負例です。

5つのZIPを取得し、API digestと実バイトSHA-256、context/manifest hash、対象HEAD、現在の登録digest、workflow/run/attempt/jobを照合しました。成功した4つのproducerの各4レポートもmanifestのSHA-256と照合しています。故障producerのZIPは成功証拠として採用していません。

| producer | ZIP SHA-256 |
| --- | --- |
| 43699641670 | f0380e821ef566180657a745b5f8de7254e9bbc2578aaabfe933a8a1f66f2ddc |
| 43699644983 | ef170bf883c59dd739215df79f9369a74c83fdd6e240302e1e278d0a4597b206 |
| 43700137597 | bb406a51a13be22939263880b26e63a9fae0bb0202724ac378d9a70c1c258bad |
| 43700139982 | ab5f97137dc5858cefaadf573cabf2de0a79500c990c028601f8226858f62be0 |
| 43700542251 | 0c2376cb9b315ff72c86fcf7cec96734a27cfe515a500c7fc3b75b9e123e6ac9 |

運用上の診断として、既存PDD保護CIの初回は候補実行前の公開API取得で停止し、同じ固定HEADのattempt2で成功しました。また旧PR20に紐付いた同一HEADの通常CIだけではmainの条件を満たせなかったため、HEADと実Approveを保ってPR21を再オープンし、PR21自身のCIを実行しました。検証条件や保護設定を緩めて通したものではありません。

今回の保証範囲は既存受理関数の64 Boolean入力と選択済みbasic-riskの保護ゲートです。全PDDのcoverage/aggregate mutationや本番全体の正しさ、人間の作業時間を測定したとは主張しません。初回の16ケースすべてを新SDKで再実行したという記録でもありません。SDK更新に関係する上記6ケースと、統合前後の通常CIを再検証しました。
