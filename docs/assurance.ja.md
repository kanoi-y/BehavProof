# 条件ごとの品質保証を導入する

Assurance は、設定で指定した条件について、実行結果・観測範囲・故障検出を個別に評価します。

## 保証対象

「テストが成功した」だけでなく、採用した各条件について、必要な観測・比較・故障検出が揃っているかを評価します。

| 導入した指針 | 実装した機能 |
| --- | --- |
| 1. 条件ごとの証拠充足 | precondition / postcondition / invariant / effect / property / architecture / journeyの条件IDと必須checkを対応付け、条件別にpass / fail / unknownを判定 |
| 2. 副作用・非変更 | 対象を絞った状態の前後比較、変更可能なフィールド、不変フィールド、操作履歴と回数制約、観測期間 |
| 3. 入力・操作系列 | seed付き入力生成、棄却上限・分類別到達、実際の反例、独立モデルとの有界な系列再生 |
| 4. 設計制約 | 実ソースのTypeScript ASTからimport / export / requireを調べる依存境界検査 |
| 5. 利用者の経路 | 順序付きの操作、期待結果、環境の宣言、層ごとの観測アダプターと実呼出し、任意の画面成果物 |
| 6. 検証の強さ | 条件/check/比較へ結び付けた故障。正常時と同じ具体入力・期待値を再生し、実際の不一致で検出を判定 |
| 7. 保証の地図 | 機能→条件→check→観測・故障・証拠を、版ごとのJSON / Markdown / HTMLと生成文書へ表示 |

条件を宣言しただけでは成功にしません。必須の不足・未到達・古い証拠はunknownです。採用した条件はbasic / standardでも必須になります。criticalでは各条件の各checkに少なくとも一つの関連する故障を要求します。必要な違反種類の完全性を自動推定するものではないので、追加の故障種類は要求レビューで決めます。既存critical Policyのカバレッジや外部保護等も独立して必要です。

## 動く導入例

製品リポジトリで実行します。

```sh
npm run build
node scripts/assurance-flow.mjs
```

[返金の導入例](../examples/assurance-refund)を一時的な消費側Gitプロジェクトへ用意し、実Vitest・明示的な観測worker・Collector・外部のローカル信頼基点・CLI gateまで通します。対象は実際のローカルHTTPと一時ファイルの保存層です。認可、拒否時の書込み、金額境界、二重返金、UI依存、HTTP経路の6条件と6故障を扱います。これが7指針を一つの機能へ組み合わせた例です。

正常系と検証条件を維持した実装リファクタを受け入れ、古い証拠の再封入、証拠欠損・重複、条件削除、探索範囲の縮小、未承認の観測driver変更、基準sourceの登録欠損を拒否します。これは管理されたローカル検証であり、新しい実User承認やGitHubのマージ保護を実施した記録ではありません。

消費側で使うコマンドは次です。

```sh
behavproof assurance discover
behavproof assurance run
behavproof check --mode audit --base HEAD --format json
behavproof assurance map --format markdown
behavproof assurance map --format html --output .behavproof/generated/assurance.html
behavproof check --mode gate --trust-root /保護された場所/trust.json
behavproof docs generate --trust-root /保護された場所/trust.json
```

`assurance discover`、`assurance map`、通常の`check`は利用先のdriver・generator・predicate・実装を実行しません。実行は`assurance run`だけが明示的に行い、設定された`.behavproof/`内のreportを書きます。workerの時間切れ・異常終了や新しいreport未生成時には、以前のreportを新しい成功として採用しません。runに`--output`やgate権限のオプションは渡せません。

`assurance run`の終了値は、選択したローカル観測が充足すれば0、不一致・不足は1、実行・入力・workerの異常は2です。ローカルの0は来歴認証や承認ではありません。gateは独立して認証した証拠だけで判定します。収集処理自体が失敗した場合、通常のCollectorは成功成果物を封印しません。

## 条件と設定

`behavproof.config.json` の `assurance.definitions` に、定義IDと `feature`・`conditions`・`checks` を含む `definition` を指定します。条件は実行する検査と、必要に応じて検出対象の故障を参照します。条件・検査・故障のIDは定義内で一意にします。[返金サンプルの設定](../examples/assurance-refund/behavproof.config.json)

`assurance` には、Driver、Driver のソース一覧、実装ソース一覧、`.behavproof/` 以下のレポート先、任意の時間上限も指定します。追加の generator、oracle、モデル、アダプター、故障実装は対応する検査から参照します。保護ホストの入力範囲には、検証で使用する依存ソースも含めてください。

## 実行driverと観測API

`@behavproof/spec-registry`は`runAssurance`、`RuntimeDriver`、`RuntimeEnvironment`を公開します。CLIは選択したdriverを別workerで読み込み、`createContext({check,input,harness})`を呼びます。戻り値は`{dependencies, close?}`です。通常の対象は`相対ファイル#export名`で指定し、runnerがそのexportを実際に呼びます。driverが返す`execute`、`calls`、`pass`の値は観測に採用しません。

公開APIの`runAssurance`を同じNodeプロセスから繰り返す場合、実行モジュールを読み込んだ後は、選択した`inputHashes`のファイル一覧とbytesを同じままにしてください。Nodeは対象がimportしたhelper等をキャッシュするため、実行対象URLのnonceだけでは依存先を再読込みできません。runnerは正規化した実パスで入力一覧とhashを固定し、同じroot、その別名、親子関係にあるrootで一覧の追加・削除やbytesの変更を検出した実行を、新しいreportを返す前に拒否します。同じ物理ファイル群とhashであればrootの表記を変えても再実行できます。モジュール読込みの予約後に`runAssurance`が例外で終了した場合は、途中で依存先がキャッシュされた可能性があるため、bytesを元へ戻してもその範囲のAPI実行を拒否します。変更後や失敗後の再実行には、新しいNodeプロセス、または毎回別workerを使う`behavproof assurance run`を使ってください。静的なarchitecture検査だけの実行はモジュールを読み込まず、このキャッシュ固定を行いません。

この制限は、選択した入力の変更を古い依存コードの観測へ結び付けないための保守的な拒否です。未列挙の依存、別root間で共有する外部モジュール、APIを呼ぶ前に読み込まれたコード、モジュール内の可変状態を完全に隔離・初期化するものではありません。関連する依存を入力一覧へ含め、キャッシュの独立性が必要な場合は最初の実行から新しいプロセスを用意してください。APIのdriverは元のプロセスで実行するため、closureもそのまま利用できます。

対象exportは`fn(input, environment)`です。`environment.dependencies`はそのケース/系列/経路の依存物です。入力・期待値・出力を複製して記録し、対象による入力の変更が期待値を書き換えないようにします。故障は同名exportを持つ別ファイルとして選び、生成器・oracle・モデル・比較を差し替えず、正常時と同じ具体的な入力・系列へ再生します。

| method | driver / source側の規約 | 記録するもの |
| --- | --- | --- |
| example | 指定exportを各caseのinputで呼ぶ | ID、入力hash、期待値、実結果、対象/source/variantに結合した呼出しreceipt |
| effects | resource.adapterの`snapshot(targets, dependencies)`と`perform(event, dependencies)`をrunnerが呼ぶ。対象は`environment.effect(scope,id,targetRef,operation,input)`で境界を使う | 複製した前後状態、実際の操作呼出しの履歴、対象、観測時間、回数制約。操作履歴は成功した書込みだけでなく境界への試行を数える |
| property | generatorの`generate({random,index,domain})`、任意の`accept(input)` / `classify(input)`、predicateの`test(input, actual)` | 全試行、棄却、実結果、真偽のpredicate結果、分類到達、反例。true以外の期待値でpropertyを成功にできない |
| sequence | generatorの`generateTrace({random,index,maxSteps})`→`{initial,actions:[{action,input}]}`、modelの`initial(initial)` / `next(state,action)`、projectionの`project(state)`。対象モジュールに`observe(dependencies)`も用意 | 初期状態、連続する独立モデル状態、実際の各操作と比較、到達action。並行実行やモデルの全状態の証明ではない |
| architecture | 指定した実ファイルを既存TypeScript parserで解析 | ファイルhash、import / export / requireと解決先、規則違反、解析不能。全dynamic import・未解決alias・構文不備はunknown |
| journey | `environment.layer(id,input)`で宣言した`layerBindings`の実exportを呼ぶ。adapterパスとtargetRefのファイルを一致させる | 同じ操作に結合した層receipt、順序、入力と実結果。HTTP越しには`invocationId()`と`withInvocation(id, callback)`を使い、現在の呼出しだけへ相関させる |

propertyの任意の`shrinker`は`shrink(originalInput)`で候補配列を返します。現在の組込みrunnerは、その同じseed付きbatch内で実際に失敗を観測した入力から縮小候補を選び、元の反例と縮小先のsample IDを保存します。未実行の候補を失敗済みにせず、最小反例とも主張しません。故障側でも入力一覧と比較の同一性を維持します。

故障がクラッシュ、skip、比較前のエラーになっただけでは「検出」に数えません。正常時に成功した同じ比較が、指定した違反箇所で実際に不一致になったことが必要です。静的依存の故障は指定した一つの論理ファイルだけを置き換え、他のファイルの観測を変えられません。

## 証拠の認証と検証基準の保護

レポートは `schemaVersion: 2` です。各結果は `definitionId`、定義のリビジョン、検査のハッシュ、実行コミット、入力ハッシュと観測結果を保持します。公開JSON SchemaはCLIの`schemas/assurance.schema.json`です。構造以外の対応・観測条件もZodと評価器で検証します。

Protected Quality CI は Assurance レポートと指定された媒体を収集し、`assurance_bundle` として定義IDの一覧に結び付けます。Publisher は選択した実行のマニフェストと照合してから評価します。ローカルホストで直接収集する場合は `assurance_report` に定義IDの一覧を指定します。

特に、現在のソースと一致する新しいreportであるだけでは、oracleやdriverの意味の変更は承認されません。保護された信頼基点の`assuranceSources`に、独立確認したdriver / generator / predicate / model / projection / adapter / faultと設定・依存のsource hashを保持します。

`ci enroll` は、検証設定と登録コミットから読み出した判定基準のファイルハッシュを同じ承認対象に含めます。`@behavproof/cli`は、ホスト実装用に`assuranceInputPaths`、`assuranceCriterionPaths`、`assuranceIdentity`も公開します。

本番の実装だけを変えるリファクタでは、同じ承認済み条件で新しい実行証拠を集められます。一方、検証基準のsourceやdriver/source/report設定を変える場合は、保護ホストでレビュー・再登録します。実装と観測アダプターを別ファイルに分けると、この区別を保ちやすくなります。

条件の削除・緩和を候補側で行っても、未承認の旧版の義務は残ります。追加したhead側の条件も黙って消さず、版ごとに表示します。以前のreportを新しいManifestへ再封入しても、元の観測版と現在の対象が一致しなければ採用しません。

## 画面成果物

journeyの`requiredMedia`は任意です。画像等を作るアダプターで、その操作中に`await environment.captureMedia(".behavproof/媒体ファイル")`を呼び、現在のstepと実際のbytesを結び付けます。既存ファイルを自動的に最後のstepへ割り当てることはしません。媒体は`{ref,sha256,stepId}`として記録し、Protected Quality CI は `.behavproof/assurance-media/` 以下で `requiredMedia` に指定した媒体を収集します。ローカルホストは `assurance_media` として同じ媒体を個別に収集できます。保護された成果物の`scope`一つを論理refとして対応付け、取得したbytesのhashを照合します。複数の曖昧な対応や未認証の画像はunknownです。画像だけで操作比較やDB到達を成功にしません。通常の任意画像はレビュー材料です。

## 保証の限界

この機能が確認するのは、選択したexport・観測アダプター・入力・状態・期間・操作経路・検査範囲です。未宣言の要求の完全性、oracle自体の意味の正しさ、任意の隠れたI/O、本番環境との差、無制限の入力や並行実行まで保証しません。環境欄は宣言した検証範囲であり、それだけでproductionへの接続を認定しません。

consumer driverと観測アダプターは、レビュー対象の実行可能コードです。別workerはセキュリティ隔離そのものではありません。信頼できない候補の実行には、既存のcredential-freeな隔離producerと独立publisherを使い、秘密を持つホストで実行しない既存の境界を維持します。来歴認証、観測、故障感度、人間による意味の承認は別の主張です。

## 導入時の確認記録

2026-11-17のローカル確認では、ビルドを含む543テスト、6パッケージ・8パッケージの別プロジェクトへのインストール、返金の新規フローと既存の3フローが成功しました。独立レビューの4指摘は回帰テストを伴って修正し、再レビューで確認済みです。[検証記録](evidence/assurance-validation.json)、[返金フローの結果](evidence/assurance-flow.json)、[修正の再レビュー](evidence/assurance-review.md)を参照してください。この記録はローカル検証の結果であり、外部の承認や本番の保護設定を認定するものではありません。

公開APIを同一プロセスで再利用した際のモジュールキャッシュ対策も追加し、追加後の55ファイル・552テストが成功しました。[追加検証記録](evidence/assurance-cache-validation.json)と[独立レビュー](evidence/assurance-cache-review.md)を参照してください。
