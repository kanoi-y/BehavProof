# 形式モデルと実装再生の導入

形式検証はプロジェクトごとに設定します。通常の `check` は収集済みの証拠を評価します。`formal discover` は設定されたQuintモジュールを一時領域で型検査し、選択された定義と依存ソースを表示します。

## 導入する範囲

`@behavproof/adapter-quint` と `@behavproof/adapter-model-test` を、既存のBehavProofパッケージと同じ版で追加します。CLIの任意peerDependenciesなので、形式検証を使わないconsumerへは追加されません。Quint、Java、Rust、Connectも通常パッケージに含めません。

公開版0.3.1を使う場合は、公開npmレジストリから同じ版のCLIと両アダプターを導入できます。このガイドのバージョン2の設定・保護CIを試す場合は、このチェックアウトからビルドしたCLIと両アダプターを使ってください。

```sh
npm install --save-dev --ignore-scripts @behavproof/cli@0.3.1 @behavproof/adapter-quint@0.3.1 @behavproof/adapter-model-test@0.3.1
npm install --save-dev --ignore-scripts @informalsystems/quint@0.33.1
```

これは製品SDKの導入であり、消費側リポジトリへBehavProofの実装ソースをコピーする手順ではありません。QuintのCLIエントリは通常 `node_modules/@informalsystems/quint/dist/src/cli.js` です。

今回の対応組合せはNode 24、Quint 0.33.1、Apalache 0.62.4、Java 21です。シミュレーションとトレース生成にはQuintのTypeScript backendを使います。Rustは必要ありません。Quintの更新は出力形式と実検証を再確認してから行ってください。

このリポジトリで実際のサンプルを実行する準備は次の通りです。

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run build
npm ci --prefix examples/formal-order --ignore-scripts --cache .npm-cache
```

Java 21を用意して `JAVA_HOME` と `PATH` を設定してください。`verify` の初回はQuintが指定版Apalacheをダウンロードします。ダウンロード時間も実行時間枠に含まれ、間に合わなければ `unknown` です。CIでは選択した形式検証ジョブだけにJavaを導入します。

## プロジェクトの設定

`schemaVersion: 2` の `behavproof.config.json` の `formal.models` に次を登録します。完全な設定を作る例は [formal-flow.mjs](../examples/formal-order/formal-flow.mjs) を参照してください。

- 論理モデルID、`.qnt` パス、対象の `module`、初期化Actionの `init` と遷移Actionの `step`。Quintソースの相対importは再帰的に解決します。
- QuintのCLI JavaScriptエントリ、Quint版、Apalache版。
- 定義名を参照する `invariants`、`witnesses`、`requiredActions` と、実行段階 `parse/typecheck/test/run/verify`。
- `formal.required` には、形式仕様が必須のパス範囲と対応するモデルIDを設定できます。
- `maxSteps`、`maxSamples`、`seed`、`timeoutMs`。
- モデル結果、トレースreceipt・ディレクトリ、実装再生結果の出力先。
- Driver、実装、追加ソースの明示一覧、必須action、最低トレース数・比較数。
- 同じDriverとトレースで検出する故障実装。モデル側の故障感度を検査する場合は、`mutants` にモデルファイルと検査する不変条件を指定します。

Driverはプロジェクトが提供する実行可能コードです。実装を呼び出す `createDriver(implementation)` をexportし、`dispatch(action, parameters)` と `observe()` を返します。[Driver](../examples/formal-order/driver.mjs) と [実装](../examples/formal-order/src/order.mjs) を参照してください。期待状態はアダプターが保持し、実装関数の呼び出しと観測値を比較します。モデルに `replayOutcome` がある場合、Driverは `allowed` または `rejected` を返します。注文サンプルは `TryShipUnpaid` で発送拒否と状態の維持を検査します。

依存モジュールや設定を読み込む場合は、保護された入力範囲と `driverSources` / `implementationSources` に含めてください。動的importや外部サービスまで自動的に完全列挙する仕組みではありません。

## 実行と確認

```sh
behavproof formal discover --format json
behavproof formal check --model specs/order.qnt
behavproof formal adequacy --model specs/order.qnt
behavproof formal replay --model specs/order.qnt
behavproof check --mode gate --trust-root /保護された場所/trust.json --format json
```

`formal check` は設定した段階を明示実行します。モデルの構文・型・モデル内test・simulation・bounded model checkを区別します。`formal replay` は生成されたITFを別プロセスでDriverと実装へ再生します。これらの実行コマンドはJSONを出力します。通常の `check` はconsole / JSON / Markdownに対応します。

`formal check` の終了値は成功0、検査失敗1、ツール不足・時間切れなどの実行未完了2です。`formal replay` は成功0、比較失敗または検証不足1、プロセス・入出力の不備2です。通常のgateは必須条件が `unknown` でもblockします。

## 成功レポートをゲートへ採用する条件

実行結果のJSONを置くだけでは採用できません。既存のCollectorでモデル結果、`<model-report>.adequacy.json`、再生結果、トレースreceiptとその参照先を収集し、現在の入力・設定・コマンド・依存lockを独立したホストが認証します。レポートが申告するproducer名や成功値は承認の代わりになりません。

ホステッド Protected CI では、固定した Quint と Apalache を Producer が準備し、検証コンテナに読み取り専用で渡します。Producer はモデル検査・到達可能性・仕様変異の出力を Driver と通常テストの実行前に収集し、再生結果と合わせて認証対象の `formal-evidence.json` に格納します。Publisher は、このファイルのダイジェストと成果物一覧を照合してからゲートへ渡します。形式仕様を登録していない通常テストのジョブでは、形式ツールの準備を省きます。

保護ホストは `specifications` に、モデルIDと承認済みリビジョンのハッシュを登録します。ハッシュには、モジュールの選択、依存ソース、Driver、検査条件が含まれます。変更の承認は旧・新リビジョンとPRのHEADに結び付きます。ゲートは、削除や上限縮小に独立した承認がない場合も、登録済みの義務を評価します。

新しい Protected Quality CI は `ci enroll` が生成する `schemaVersion: 2` の登録を使います。登録には `sourceCommit` と `specifications` が必要です。通常テストだけを登録する場合の `specifications` は空配列です。ゲートに渡す信頼ルートもバージョン2を使用します。

### マージ後の仕様登録

対象リポジトリに専用の `behavproof-registry` ブランチを用意します。書き込みを登録管理者に限定し、管理者にも保護を適用して、ブランチ削除と強制更新を禁止します。Protected Quality CI の Producer と Publisher には読み取り権限を与えます。保護ホストには、ブランチ設定とチェック実行を読める権限と、登録ブランチへ書き込める権限が必要です。

リポジトリのルールセットを使う場合は、更新を制限して登録管理者だけを常時バイパスに指定するルールセットと、削除・強制更新をバイパスなしで禁止するルールセットを設定します。[GitHub のブランチルール API](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)

独立した登録ファイルと登録時のダイジェストで、登録ブランチを初期化します。マージ後は保護ホストの Git オブジェクトに PR の HEAD、マージコミット、対象ブランチの現在のコミットを揃え、Publisher が返したチェックIDを指定します。

```sh
behavproof ci init-registry --registration "$REGISTRATION" --digest "$REGISTRATION_DIGEST"
behavproof ci advance --registration "$REGISTRATION" --digest "$REGISTRATION_DIGEST" --pr "$MERGED_PR" --check-id "$CHECK_ID"
```

`ci advance` は、成功チェックの発行元と旧登録のダイジェスト、PR の HEAD と基点、マージされたツリーを照合します。更新には、審査したツリーと同じマージ結果が必要です。登録ブランチの先端が処理中に変わった場合は更新を中断し、現在の登録から差分を再計算する必要があります。登録とマージ先の仕様が食い違う間は、後続 PR に成功判定を出しません。[GitHub の `createCommitOnBranch` リファレンス](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch)

状態Witnessが見つかれば `pass`、指定上限を調べ切って未到達なら `fail`、タイムアウトなど検査未完了なら `unknown` です。必須Actionには、その遷移を記録した認証済みトレースが必要です。仕様変異では、同じ上限と不変条件で正常モデルが成功し、故障モデルから反例が得られることを確認します。

ゲートの `formal.models[].coverage` では、シミュレーションのシード・標本数の設定値と、認証済みトレースで観測した状態・遷移・Action の件数を確認できます。Witness を指定した場合、Quint 0.33.1 が同じシードと上限で探索した標本数と、各 Witness を観測したトレース数を `simulation.witnessObservations` に記録します。この集計の母数はエクスポートされた Replay 用トレースの本数とは別です。

有界検査の記録には、バックエンド、上限、対象Property、Witnessの判定を含めます。必須 Witness の到達判定には有界検査の証拠を使います。シミュレーションのトレースや Witness の集計を認証できない場合、該当する観測欄を `null` とし、理由を記録します。

`behavproof impact --base <ref>` の `modelIds` には、変更された `.qnt`、推移的な仕様依存、Driver、対応する実装から影響候補となったモデルを表示します。依存ソースの一覧を解決できない場合は `unknown` として記録します。

`behavproof docs generate` はモデルの定義名、検証上限、評価項目、証拠参照を Markdown・HTML・JSON に出力します。保護ホストの評価を反映するには `--trust-root` を指定します。`behavproof docs check` は現在の設定と評価から再生成した結果を保存済みのファイルと照合します。

## 再現可能な受入フロー

準備後に、明示的に実行します。

```sh
node examples/formal-order/formal-flow.mjs
node examples/formal-order/connect-compatibility.mjs
node scripts/package-smoke.mjs --offline
node scripts/package-smoke.mjs --offline --formal
```

最初のフローは一時Gitプロジェクトと外部のローカルホストを作り、実ツール→実装再生→Collector→認証済みgateを検証します。モデル故障と実装故障も調べ、機械可読記録を `docs/evidence/formal-flow.json` に出します。これは選択済みfixture baselineの検証であり、実Userのレビュー承認やGitHubの保護設定を新たに実施した証拠ではありません。

## 結果の読み方と限界

`formalModel` と `implementationConformance` は別の結果です。モデル成功だけで実装の適合性を成功にしません。モデル本文・Driver・実装・設定・コマンド・トレースのいずれかが変わると旧結果は採用しません。トレース0、比較0、実装呼出0、必須action未到達、故障canary未検出も成功にしません。

`maxSteps=8` などの上限、simulationの標本数・seedと、実装再生のトレース数・比較数を確認してください。有界モデル検査の成功は無制限の証明ではありません。選択した実装関数への呼出観測と故障検出も、本番到達の完全な証明や悪意のあるDriverへの保証ではありません。Driver・producer・依存関係のレビューと実行環境の隔離は別途必要です。

検証済みのCI・導入コスト・限定した採用判断は [M2-F受入検証記録](formal-validation.ja.md) にまとめています。
