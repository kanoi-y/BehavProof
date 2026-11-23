# npm公開とRelease手順

公開済みの8パッケージを `0.3.1`、ユーザー承認済みのnpm `public` で配布する。無料アカウントでは限定公開できないため、現在は `next` チャネルとGitHub Prereleaseを使う。対象は `scripts/release.mjs` の公開許可リストにある8パッケージ。Jestアダプターはソースビルドで利用する。公開後は誰でもダウンロードできる。`next` は配布チャネル名であり、非公開を保証する設定ではない。公開範囲は必ずnpmのアクセス設定で確認する。npm公開成功前にGitHub Releaseを正式公開しない。

## アカウントの前提

- `@behavproof` のnpm Organization所有権／書き込み権限が必要。Organizationは無料のUnlimited public packagesプランを使う。npm未ログイン・権限不足の場合は停止する。課金や既存privateパッケージのpublicへの自動切替はしない。
- 管理者自身が `npm login --registry=https://registry.npmjs.org` を実行する。認証情報をチャット・リポジトリ・CI成果物に入れない。2FAが必要な場合も管理者がnpmの案内に従う。
- GitHubソースはpublicである。npmを限定公開してもソースは非公開にならず、利用者による再配布を技術的に防ぐものでもない。現時点ではオープンソースライセンスを選定していないため、パッケージには `UNLICENSED` を明記する。

npmの条件: [private packages](https://docs.npmjs.com/about-private-packages/)、[private package publishing](https://docs.npmjs.com/creating-and-publishing-private-packages/)。

## 認証情報のない環境での検証と梱包

Node.js 24.xで、変更をレビュー・コミットし、クリーンなチェックアウトから実行する。`SOURCE_SHA` は公開対象の完全な40桁コミット値に置き換える。

```sh
npm ci --ignore-scripts
npm test
npm audit
node scripts/package-smoke.mjs --online --formal
mkdir -p .behavproof/releases
npm run release -- prepare .behavproof/releases/0.3.1
npm run release -- verify .behavproof/releases/0.3.1 SOURCE_SHA
```

smokeは記録用 `docs/evidence/formal-package-smoke.json` を更新する場合がある。梱包前に差分を確認し、意図した記録のみコミットする。梱包はバージョン、内部依存の完全一致、固定registry、承認済みpublicアクセス、ライフサイクルスクリプトなしを要求する。tarballの実際の内容を展開せず読み、許可ファイル、サイズ・tar構造・重複・リンク・秘密鍵／既知の認証トークン形式を検査する。SHA-512、ファイル一覧、ソースSHAを `release-manifest.json` に保存する。スキャナーが未知の秘密情報を必ず検出できるわけではないため、最終一覧もレビューする。

## 管理者ホストからのpublic公開

梱包済みファイルとmanifestを管理者ホストへ移し、同じソースSHAをチェックアウトする。認証情報を設定したホストでは、ビルドや候補テストを再実行しない。

```sh
npm whoami --registry=https://registry.npmjs.org
npm run release -- publish .behavproof/releases/0.3.1 SOURCE_SHA
```

依存順で全8パッケージを `--access=public --tag=next --ignore-scripts` で公開する。既存privateパッケージをpublicへ変更する公開を拒否する。公開済みの同一バージョンは、publicかつtarballのSHA-512が完全一致する場合だけ再利用する。途中で失敗した場合、同じmanifestで再実行できる。異なるbytesで同一バージョンを上書きしない。npmの複数パッケージ公開は一括トランザクションではないため、全件確認まで完了扱いにしない。

npmは公開受付後にマルウェア検査を行い、取得可能になるまで通常約5分、混雑時は15分以上かかることがある。ツールは全パッケージを受付順に送信した後、20秒間隔・20分のポーリング期間でメタデータを確認する。実行中のregistryリクエスト時間が加わるため、全体の壁時計時間は20分を超える場合がある。受付済みだがまだ404のpublic名は、owner権限とOrganization一覧で確認し、再送せず待つ。期限切れは完了扱いにせず、時間を置いて同じmanifestで再確認する（[公式説明](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)）。

公開後はnpm APIのアクセス状態 `public` と `dist.integrity` を全件読み戻す。認証情報を持たない利用者の別ディレクトリで、CLI・Vitestアダプターをregistryから実際にインストールして動作確認する。formalアダプターは必要な利用者のみ追加する。

```sh
npm install --ignore-scripts @behavproof/cli@0.3.1 @behavproof/vitest@0.3.1 vitest@5.1.0
npx --no-install behavproof --help
```

## バージョンタグとGitHub Release

全8件のpublic公開とregistryからのインストール確認後、公開ソースの正確なコミットに注釈付き `v0.3.1` タグを作成する。既存タグを移動・上書きしない。GitHub Releaseには対象コミット、導入方法、検証結果、既知の制約、tarballのSHA-512を記載する。限定公開tarballやmanifest内のファイル内容をpublicのReleaseに添付しない。manifestのハッシュ一覧は公開してよい。初期導入期間中はPrereleaseとして公開する。

将来の自動公開は、保護されたRelease環境とnpm Trusted Publishingの設定を確認してから導入する。現在は長寿命npmトークンをGitHub Secretsへ新設しない。管理者端末からの初回公開にはOIDC由来の自動provenanceが付かないため、attestation付きと表示しない（[npm公式](https://docs.npmjs.com/trusted-publishers/)）。
