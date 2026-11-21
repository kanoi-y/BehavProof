# BehavProof：品質診断・保護CI導入手順

対象：単一パッケージのNode.jsプロジェクト。対応ランナーはVitest 5.1.0とJest 29.7.0 / 30.5.2のみ。モノレポ、他言語、他のCIは対象外。本機能は未リリースのソースに含まれる。

## 0. 前提

- Gitリポジトリであること。`doctor`はGitリポジトリでない場所では単一パッケージとして扱わず、品質がpassでも終了コード1になる。
- コミット済みの`package-lock.json`があること。`ci plan`は欠けていると前提条件`lockfile`を`missing`と報告する。
- 品質ポリシーは`quality-baseline-v1`が既定。変更する場合は`--quality-policy`で自作ポリシーを渡す。

## 1. 診断する：`behavproof doctor`

```sh
behavproof doctor
behavproof doctor --quality
behavproof doctor --quality --format json
```

`doctor`は常に静的な品質診断を報告する。`--quality`を付けると、その結果で終了コードも決まる。終了コードは0がすべて合格、1が必須項目の不合格または未確認、2が入力不正または基盤エラー。

合格したプロジェクトの例：

```
Quality configuration: pass (quality-baseline-v1)
pass lint.command: Recognized direct tool invocation
pass types.command: Recognized direct tool invocation
pass test.command: Recognized direct tool invocation
pass lint.scope: 1 selected source files
pass lint.rules: Checked required rule severity for in-scope sources
pass types.scope: 1 configured compiler inputs
pass types.strict: Checked strict compiler settings
pass test.scope: 1 test files selected
pass test.settings: Checked options for full, non-watch test runs
pass test.focus: No such declarations found in selected source
unknown test.coverage (advisory): Coverage not enabled in static config; LCOV not explicit; thresholds not explicit
pass test.reporters (advisory): Configured runners' reporters: defaults; behavproof test supplies its JSON reporters

Static configuration observations only. Collect authenticated runs for execution evidence.
```

`doctor`は読み取り専用で静的。プロジェクトの設定ファイルを読み込んで実行することはなく、パッケージスクリプトを実行せず、パッケージをダウンロードしない。動的な設定や解決できない共有設定は`unknown`になり、passにはならない。`test.coverage`と`test.reporters`は助言であり、合否には影響しない。

## 2. 直す：よくある不合格と対処

弱めた設定の例：

```
Quality configuration: fail (quality-baseline-v1)
fail lint.rules: Required lint rules are missing, disabled or below error severity
fail types.strict: Strict compiler settings are missing or overridden
```

| 項目 | 合格条件 | 直し方 |
| --- | --- | --- |
| `lint.rules` | `no-debugger`、`no-dupe-args`、`no-dupe-keys`、`no-unreachable`、`no-constant-condition`をすべてerrorにする | ESLintのflat configまたはBiomeの`biome.json`で5ルールをerrorにする。warnやoffでは通らない |
| `types.strict` | TypeScript `strict: true` | `tsconfig.json`（または`extends`先）で`strict: true`にする |
| `test.scope` | テストが1件以上見つかること | ランナーの設定でテストファイルが選ばれるようにする。テストが0件のままでは通らない |
| `test.focus` | `only`や保留中のテストがないこと | `.only`や`todo`を外す |
| `lint.command` / `types.command` / `test.command` | 認識できる直接のツール呼び出しであること | 循環するnpmスクリプト参照（`lint: npm run lint`）、プロジェクト外の設定パス（`eslint --config ../outside.json`）、失敗を握りつぶす書き方（`|| true`、`--passWithNoTests`）は不合格になる。Biomeの`--max-diagnostics none`は値として扱われ、ファイル扱いにはならない |
| `lint.scope` | 選択したソースがすべてlint対象であること | 過度に広い除外（`src/**`を無視するなど）でソースが0件になると不合格になる |

修正したらもう一度`doctor --quality`を実行し、終了コード0を確認する。静的診断が通ることは、実行時の証拠があることではない。実行の証拠は保護された収集・照合の流れで別に集める。

## 3. 計画する：`behavproof ci plan`

```sh
behavproof ci plan --repository OWNER/REPO --branch main --sdk-sha <40桁の16進数> --app-id <数値> > plan.json
```

`ci plan`はファイルを作らない。決定論的な計画を標準出力に出す。含まれるもの：品質ポリシー、producerとpublisherのワークフロー、デプロイ設定ファイルの内容とSHA-256ハッシュ、前提条件、GitHubでの設定手順。`--sdk-sha`にはBehavProofのコミットSHAを40桁で指定する。`--app-id`はGitHub Appの数値ID。15368は使えない。

解決できなかった選択は`unresolved`に列挙される。既定値は次の通り：

```json
"unresolved": ["runner", "sources", "workflowSha"]
```

- `runner`：既定はvitest。`--runner jest`で変更できる。
- `sources`：既定は`src/**/*`。
- `workflowSha`：登録時（enroll）に初めて決まる。planの時点では未解決のままが正しい。

前提条件の例（`package-lock.json`がない場合）：

```json
"prerequisite": [
  {"id": "configuration", "issues": [], "status": "pass"},
  {"action": "Commit a reviewed npm package-lock.json.", "id": "lockfile", "status": "missing"}
]
```

計画のファイル一覧には、生成される4ファイル（`.github/behavproof/deployment.json`、`.github/behavproof/quality-policy.json`、`.github/workflows/behavproof-producer.yml`、`.github/workflows/behavproof-publisher.yml`）の内容とハッシュが入る。内容を確認してから次へ進むこと。計画を作っただけでは保護CIは成立しない。

## 4. 適用する：`behavproof ci apply`

```sh
behavproof ci apply --plan plan.json --dry-run
behavproof ci apply --plan plan.json
behavproof ci apply --plan plan.json
```

`--plan`はプロジェクト内の相対パスで指定する（プロジェクト外の絶対パスは受け付けない）。`--dry-run`は書き込みをせず、作られる予定のファイルを表示する。

適用結果の例：

```json
{"dryRun": false, "exitCode": 0, "files": [
  {"action": "created", "path": ".github/behavproof/deployment.json"},
  {"action": "created", "path": ".github/behavproof/quality-policy.json"},
  {"action": "created", "path": ".github/workflows/behavproof-producer.yml"},
  {"action": "created", "path": ".github/workflows/behavproof-publisher.yml"}
], "protection": "unverified", "schemaVersion": 1, "status": "ready-for-review"}
```

- `ci apply`はレビュー済みの計画だけを書く。計画のハッシュと一致しない計画は受け付けない。
- 4か所の宛先をすべて先に確認する。競合が1件でもあれば何も書かない。
- 宛先がシンボリックリンクやハードリンクの場合は競合として拒否する。
- 2回目の適用は冪等で、内容が同じファイルは`preserve`として残す。
- `protection`は`unverified`のまま。ファイルを置いただけでは保護は成立しない。

## 5. 登録と環境を設定する：`behavproof ci enroll`とGitHub側の手順

### 5-1. GitHub側で用意するもの（CLIでは作らない）

次の作業はGitHub上で人間が行う。CLIはこれらを作らないし、作ったと主張もしない。

1. 専用のGitHub Appを作る。権限はChecksの書き込みと、Actions・Contents・Pull requests・Administrationの読み取りに絞る。
2. `behavproof-publisher`環境を作る。対象ブランチを信頼するワークフローブランチだけに制限し、登録したレビュアーを必須にし、自己レビューと管理者のバイパスを無効にする。Appの秘密鍵を`BEHAVPROOF_APP_PRIVATE_KEY`としてこの環境に置く。
3. 保護対象ブランチに厳格なブランチ保護を設定する。管理者にも適用し、人のレビューを必須にし、古いレビューを破棄する設定にし、必須チェックとしてApp由来の`BehavProof protected gate`を選ぶ。
4. Repository Variablesに3件を登録する。`BEHAVPROOF_WORKFLOW_SHA`、`BEHAVPROOF_REGISTRATION_JSON`、`BEHAVPROOF_REGISTRATION_DIGEST`。

### 5-2. 独立したホストで登録する：`behavproof ci enroll`

```sh
behavproof ci enroll --workflow-sha <40桁の16進数> --reviewers alice,bob --registration /outside/repo/registration.json --pr 12
```

- レビュアーはGitHubのログイン名。英数字とハイフンのみで、先頭と末尾は英数字、最大39文字。1人以上6人以下。
- `--registration`はリポジトリ外のパスにする。登録ファイルは0600で作られ、48 KiBを超えない。
- `--pr`は承認の対象になるPR番号。enrollはGitHub AuthorityでそのPRの承認を確認する。
- 登録内容は、デプロイ、ワークフローのSHA、ファイル一覧（ハッシュ付き）、レビュアー、品質ポリシー、設定、ベースライン、必須テスト。
- `GITHUB_TOKEN`は環境変数で渡す。トークンがない場合は匿名で読み取りを試みる。

## 6. 検証する：`behavproof ci verify`

```sh
behavproof ci verify --registration /outside/repo/registration.json --digest <sha256>
```

`ci verify`は読み取り専用。登録内容とリモートのGitHubの状態を比べ、14件の観測を個別に報告する。観測の対象は、ローカル統合、ピン留めされたワークフロー、独立した信頼登録、環境の分離、必須の上流チェック、発行者に紐づいたブランチ保護など。

- 権限不足、対応していない保護、App IDの欠落、観測できなかった属性は`unknown`になる。`unknown`はpassではない。
- 終了コードは0がすべて合格、1が必須項目の不合格、2が入力不正または基盤エラー。
- `runtimeIsolation`と`pullRequestExecution`は設計上つねに`not-observed`になる。実行時の分離とPR実行は、producerとpublisherの実行そのもので確認する。

## 保証の限界（正確な範囲）

- 生成したワークフローを置いたことは、保護されたCIが成立したことと等しくない。`ci verify`が合格して初めて、登録とリモートの設定が一致していると言える。
- 診断JSONそのものに信頼や承認の権限はない。承認は登録された信頼ルートと人の承認に基づく。
- `doctor`の静的診断は設定の読み取りであり、ツールやテストの実行ではない。実行の証拠は別に集める必要がある。
- 既存のbasic/standard/criticalポリシーを自動で移行することはない。
- 候補のコードは資格情報のないコンテナでのみ実行する。publisherは候補のコードを実行しない。テスト用コンテナはネットワークを無効化し、依存関係は読み取り専用で載せ、ソースは使い捨てのコピーとして渡す。
- この導入は`behavproof check`の既存の動作を変えない。信頼ルートに`quality`がないプロジェクトは、従来のgateの動作のままになる。

## コマンド一覧

```sh
behavproof doctor [--quality] [--format console|json|markdown] [--runner vitest|jest] [--quality-policy <path>]
behavproof ci plan --repository OWNER/REPO --branch BRANCH --sdk-sha SHA --app-id ID [--workflow-branch BRANCH] [--runner vitest|jest] [--quality-policy <path>] [--config <path>]
behavproof ci apply --plan <path> [--dry-run]
behavproof ci enroll --workflow-sha SHA --reviewers a,b --registration <path> --pr <number>
behavproof ci verify --registration <path> --digest <sha256>
```

スキーマは`packages/cli/schemas/quality-policy.schema.json`、`ci-registration.schema.json`、`deployment.schema.json`。詳細は[READMEの品質診断・保護CIの節](../README.md)と[保護GitHub統合の手順](protected-github-deployment.ja.md)を参照すること。
