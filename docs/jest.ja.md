# Jestでの導入と検証

未公開の開発ソースで、単一パッケージのJest **29.7.0 / 30.5.2** に対応する。BehavProofの実行環境はNode24。通常のCLIやVitest利用者にJestのインストールは不要。`@behavproof/jest`は任意の追加パッケージで、既存の公開許可範囲には追加していない。

## 最小構成

ビルド済みの本ソースから、coreを含む必要なSDKパッケージとCLI・`@behavproof/jest`を同じビルドの成果物として導入したプロジェクトで実行する。公開済みcore0.2.0の成果物には今回のCommonJS追加が含まれないため、開発中のJestパッケージだけを混ぜて使わない。新パッケージの公開済みバージョンがあることは前提にしない。

```sh
npx --no-install behavproof init --runner jest
npx --no-install behavproof test --runner jest
```

`init`は依存をインストールせず、設定と除外ルールを準備する。`test`は既にインストールされたJestを直接起動し、ネイティブJSONと契約レポートを新しく生成する。テスト失敗は終了コード1のまま返す。両ランナーを宣言したプロジェクトでは、`--runner`または設定の`testRunner`で選ぶ。

```json
{
  "schemaVersion": 1,
  "testRunner": "jest",
  "reports": {"jest": ".behavproof/input/jest.json"},
  "contracts": {
    "enabled": true,
    "sources": [{"type": "jest-inline", "include": ["tests/*.test.cjs"]}]
  }
}
```

```js
// tests/double.test.cjs
const {defineContract, contractTest} = require('@behavproof/jest');
const double = require('../double.cjs');
const contract = defineContract({
  id: 'DOUBLE', intent: '数を2倍する', risk: 'basic',
  cases: [{id: 'one', input: 2, expected: 4}],
});
contractTest.each(contract, ({input}) => double(input));
```

既存のJest preset、TypeScript変換、環境設定、ファイルごとの環境指定はJestが選択する。SDKはその環境を使うCircusランナーへ観測を追加する。CLIは1プロジェクトに対応し、別のテストフレームワークやJasmineを黙って置き換えない。手動設定は[SDK説明](../packages/contract-jest/README.md)を参照。ESMはJestのVMモジュール設定が必要。

## 証拠として扱う条件

`.behavproof/input/jest.json`と`contracts.json`がローカル出力。`check`はテストや設定コードを実行しない。ローカルで成功しても、承認や信頼された証拠には自動的にならない。

ゲートでは独立したホストがCollectorを起動し、入力・設定・依存ロック・実行・成果物を固定する。外部のtrust rootで`runner.kind: "jest"`、実際のバージョン、`manifestRef`とネイティブ報告の所属を指定する。契約報告も同じ実行に所属する必要がある。候補側のランナー変更・削除、別実行の報告、異なるマーカー、改ざん、欠落は成功にできない。設定側の出力先とホストの収集先は異なってよい。詳細は[trust root](trust-root.md)。

```sh
npx --no-install behavproof check --mode gate --trust-root /保護された場所/trust-root.json
```

ネストした`describe`を含むファイル数・テスト数を実際のJest報告と照合する。skip/todo、空、途中終了、不足、重複名、再試行による曖昧さは完全な成功として扱わない。フック失敗とcallbackの比較結果も分離する。

比較の成功だけでは実装への到達を示せない。別途選択する保護された観測処理は、実際の関数への呼出しと、同じcallbackが関連する誤実装を比較失敗として検出することを確かめる。Jestでは`protected-case-observer-and-jest-canary-v1`を使う。制御されたNode/TypeScript→CommonJSの関数観測であり、プロジェクトのpresetは読み込まない。任意の敵対的JavaScriptを隔離する仕組みではない。クラッシュや無関係なフック失敗を誤実装の検知とは数えない。

## 再現できる検証

```sh
npm test
node scripts/package-smoke.mjs --offline --jest
node scripts/jest-suteco-flow.mjs /依存導入済み/suteco /Node20.19.4/bin/node
```

offline配布検証は必要なnpmキャッシュを事前に用意する。実際のJest29/30、ワーカープロセス、CJS/ESM、TypeScript、環境指定、正常・同値リファクタ・失敗・欠落・改ざん・保護された選択を検証する。実行証拠は[配布結果](evidence/jest-package-smoke.json)、[suteco標準連携結果](evidence/jest-suteco.json)に保存する。

sutecoでは元コードを変えず、既存181テストが成功する状態と、以前再現した8条件の5成功・3失敗を、ケースごとの接続処理を使わず標準レポーターとゲートへ渡す。詳しい原因と測定の限界は[調査報告](studies/suteco-2026-11-17/report.ja.md)を参照。追加テストを設計した効果と、BehavProofが条件・版・証拠を管理する効果は区別する。
