# Jest での導入と検証

Node.js 24 で、単一パッケージの Jest **29.7.0 / 30.5.2** を使えます。CLI と `@behavproof/adapter-reports` は同じビルドの SDK を使ってください。

```sh
npx --no-install behavproof init --runner jest
npx --no-install behavproof test --runner jest
```

`test` はプロジェクトにインストール済みの Jest を起動し、Jest の終了コードを返します。通常のテストファイルと既存の Jest 設定を使います。

```json
{
  "schemaVersion": 2,
  "testRunner": "jest",
  "reports": {"jest": ".behavproof/input/jest.json"}
}
```

既定の出力は `.behavproof/input/jest.json` と、その実行のスイート・テスト一覧を含む `.behavproof/input/jest.json.receipt.json` です。receipt は実行ID、Jest の版、ネイティブJSONのダイジェストを保持します。

## 保護されたゲートでの採用

Protected Quality CI の Producer が両方のファイルを同じ実行の成果物として収集します。ゲートは外部の信頼ルートで選んだランナー、バージョン、マニフェストと照合します。ローカルの `check --mode audit` は収集済みのファイルを読み取ります。

パッケージ導入の回帰確認には `node scripts/package-smoke.mjs --offline --jest` を使います。ローカルキャッシュから両方の対応版を別プロジェクトに導入し、ネイティブJSONとreceiptを照合します。

従来方式の実地検証記録は [suteco の検証結果](evidence/jest-suteco.json) にあります。
