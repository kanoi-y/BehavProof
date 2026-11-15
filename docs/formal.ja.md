# 形式モデルと実装再生の導入

M2-Fは明示導入するオプションです。通常の `check` はモデル検査・テスト・Driverを実行しません。`formal discover` もファイル一覧を調べるだけです。

## 導入する範囲

`@behavproof/adapter-quint` と `@behavproof/adapter-model-test` を、既存のBehavProofパッケージと同じ版で追加します。CLIの任意peerDependenciesなので、形式検証を使わないconsumerへは追加されません。Quint、Java、Rust、Connectも通常パッケージに含めません。

現時点でnpmへの公開は行っていません。別プロジェクトへ導入する場合は、ビルド後に各パッケージのtarballを作り、そのファイルを導入してください。通常の6パッケージに加えて、形式検証を選ぶプロジェクトだけが2つのアダプターを導入します。

```sh
# BehavProofリポジトリで実行
mkdir -p .behavproof/packages
for package in core adapter-reports contract-registry contract-vitest adapter-github cli adapter-quint adapter-model-test; do
  npm pack "./packages/$package" --ignore-scripts --pack-destination .behavproof/packages
done
# 導入先プロジェクトで実行。パスは実際のBehavProofチェックアウトへ置換
npm install --save-dev --ignore-scripts /path/to/BehavProof/.behavproof/packages/*.tgz
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

`behavproof.config.json` の `formal.models` に次を登録します。完全な設定を作る例は [formal-flow.mjs](../examples/formal-order/formal-flow.mjs) を参照してください。

- モデルID、対象Contract ID、`.qnt` パスとimport先の `modelSources`。
- QuintのCLI JavaScriptエントリ、Quint版、Apalache版。
- 検査するproperty名、実行段階 `parse/typecheck/test/run/verify`。
- `maxSteps`、`maxSamples`、`seed`、`timeoutMs`。
- モデル結果、トレースreceipt・ディレクトリ、実装再生結果の出力先。
- Driver、実装、追加ソースの明示一覧、必須action、最低トレース数・比較数。
- 正常と同じDriver・トレースで失敗すべき、既知の故障実装。

Driverはプロジェクトが提供する実行可能コードです。実装を呼び出す `createDriver(implementation)` をexportし、`dispatch(action, parameters)` と `observe()` を返します。[Driver](../examples/formal-order/driver.mjs) と [実装](../examples/formal-order/src/order.mjs) を参照してください。期待状態はアダプターが保持し、実装関数の呼出回数と期待値・観測値の比較を記録します。

依存モジュールや設定を読み込む場合は、保護された入力範囲と `driverSources` / `implementationSources` に含めてください。動的importや外部サービスまで自動的に完全列挙する仕組みではありません。

## 実行と確認

```sh
behavproof formal discover --format json
behavproof formal check --model specs/order.qnt
behavproof formal replay --model specs/order.qnt
behavproof check --mode gate --trust-root /保護された場所/trust.json --format json
```

`formal check` は設定した段階を明示実行します。モデルの構文・型・モデル内test・simulation・bounded model checkを区別します。`formal replay` は生成されたITFを別プロセスでDriverと実装へ再生します。これらの実行コマンドはJSONを出力します。通常の `check` はconsole / JSON / Markdownに対応します。

`formal check` の終了値は成功0、検査失敗1、ツール不足・時間切れなどの実行未完了2です。`formal replay` は成功0、比較失敗または検証不足1、プロセス・入出力の不備2です。通常のgateは必須条件が `unknown` でもblockします。

## 成功レポートをゲートへ採用する条件

実行結果のJSONを置くだけでは採用できません。既存のCollectorでモデル結果・再生結果・receipt・receiptが指す全トレースを収集し、現在の入力・設定・コマンド・依存lockを独立したホストが認証します。レポートが申告するproducer名や成功値は承認の代わりになりません。

モデルとDriverの意味も別にレビューします。Contractの `formal` に `modelId`、`modelHash`、`driverHash`、`propertyIds` を持たせ、そのContract版とIntentを承認済みbaselineへ登録します。hashは、プロジェクト相対パスから各ファイルのSHA-256へのmapに対するBehavProofのcanonical hashです。モデル・Driver本文やpropertyの対応が変わればContract版も変わります。承認済み登録の作成時には、独立確認した実ファイルhashとの一致を検査します。

criticalとして採用したモデルは構文・型・モデル検査・実装再生・意味の結び付けを必須とし、同じDriver・トレースを使う故障canaryも要求します。候補側でモデルを削除したり、検査段階・上限・最低件数を変更しても、保護ホスト側の義務を取り除けません。変更を採用するには独立した再レビューと登録が必要です。

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
