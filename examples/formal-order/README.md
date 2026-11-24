# 任意の形式検証サンプル

注文の支払・出荷・取消・返金をモデルと照合します。返金回数と出荷後の返金禁止に加え、未払い時の発送要求を実行し、拒否結果と注文状態の維持を確認します。

導入と結果の読み方は [日本語ガイド](../../docs/formal.ja.md) を参照してください。Java 21を用意した上で、リポジトリのルートで明示実行します。

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run build
npm ci --prefix examples/formal-order --ignore-scripts --cache .npm-cache
node examples/formal-order/formal-flow.mjs
node examples/formal-order/connect-compatibility.mjs
```

このフローは実Quint 0.33.1の各段階、実Apalache 0.62.4、実装呼出と状態比較、同じDriver/トレースの故障canary、到達性の証拠、Collectorと認証済みローカルゲートを確認します。モデル故障のsimulation再現と有界検査も実行します。出力は `docs/evidence/formal-flow.json`、生結果と入力のbundleは `.behavproof/formal-acceptance-artifacts/` です。後者はGitへ登録せず、任意CIの成果物へ保存します。

既定の `check` や `formal discover` はこのフローを実行しません。固定版Quint/Connect/Vitestはこの例だけの依存です。ローカルfixtureのbaselineを選んだ受入検証であり、実Userの意味承認やGitHubのマージ保護を実施した証拠ではありません。
