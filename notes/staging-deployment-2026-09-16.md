# 開発ブランチ用Cloudflare検証環境

ユーザーの依頼に基づき、本番とは独立した検証環境を作成・公開した。

- URL: https://madrv-player-staging.madrv-player-web.workers.dev
- Worker: `madrv-player-staging`
- 配信ブランチ: `codex/playback-seek`
- 配信コード: `fa2c4a8fd77b`（クリーンな作業ツリーからビルド）
- Cloudflare Version ID: `7e47b20f-ade5-43e4-b58f-8e64aaa3c38b`
- 専用設定: `wrangler.staging.jsonc`
- 専用出力先: `dist/staging/public`

## 本番との分離

本番用`wrangler.jsonc`、mainブランチ、本番Workerの設定・配信を変更していない。検証用設定は本番カスタムドメインのrouteを持たず、独立したworkers.dev URLを使用する。

`SESSIONS`は検証Worker自身の`SessionStore`へバインドしており、本番Workerへの`script_name`指定やnamespace共有はない。Cloudflare APIで実際のnamespaceも比較した。

| 対象 | 本番 | 検証環境 |
| --- | --- | --- |
| Worker | `madrv-player` | `madrv-player-staging` |
| SessionStore namespace | `b0c23eaf7dfd49059535f41e5819c761` | `001cd29658c848a9b55b9fcbc17bef02` |
| Cloudflare version | `15df1142-4b99-4c42-b7a0-622bd584babc` | `7e47b20f-ade5-43e4-b58f-8e64aaa3c38b` |

作業前後で本番デプロイ履歴が完全一致し、HTMLとそこから参照されるJS・CSSのSHA-256も一致した。本番HTMLのSHA-256: `32df6eed6bbb71f20ee85f12715c2fd54ff78c4403511e675184959f40d83f1f`。

## 更新方法

`codex/`開発ブランチで`pnpm deploy:staging`を実行する。ビルドと専用Workerへのデプロイを一括で行う。`pnpm check:staging`はアップロードしない事前確認。mainやdetached HEADからの実行、追加引数による配信先の変更、設定内のWorker名・アカウント・出力先・保存先の誤変更を拒否する。

Gitのpushやコミットに連動した自動デプロイは設定していない。本番の`pnpm deploy:cloudflare`は従来どおりで、検証環境の更新には使用しない。

画面には「検証環境」とブランチ・リビジョンを表示する。`/build-info.json`でもビルドを識別できる。`robots.txt`と`X-Robots-Tag`で検索インデックスへの掲載を抑止する。認証は付けておらず、URLは公開されている。

## 確認結果

- 型チェック（通常・Cloudflare）、Wrangler dry run、検証用ビルド・デプロイ成功。
- 配信HTML・JS・CSSがローカルの検証用ビルドと一致。
- `build-info.json`に正しいブランチ・リビジョン・`dirty: false`を確認。
- 公開URLで共有セッションの作成と読込が成功。内容は自作の短いテストMMLのみ。
- 公開URLで、自作163バイトのMDX（PDX不要、32ノート）を使用してChromeで再生を確認。曲長24.035秒、約12秒へのシーク、5秒戻し、末尾への移動後の自然終了が成功。未処理のブラウザエラー0件。
- ローカルの楽曲ファイルを公開ページへ渡す検査は自動承認レビューに拒否されたため実行せず、上記の合成データへ切り替えた。公開環境での操作検証は完了しており、この拒否による未完了項目はない。

ブラウザ検査は`node scripts/verify-staging-browser.mjs`で再実行可能。ローカルの楽曲・PDX・個人データを読まない。必要なら`CHROME_PATH`でChromeの実行ファイルを指定する。

Cloudflareの分離仕様: [Durable Objects environments](https://developers.cloudflare.com/durable-objects/reference/environments/)、[Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)。
