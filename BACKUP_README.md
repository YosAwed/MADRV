# MADRV Player — Backup Manifest

このアーカイブは、MADRV Player - Signal Deck の復元・引き継ぎを目的としたプロジェクトバックアップです。ソースコード、設定、テスト、運用メモ、および本番ビルド出力を収録します。

| 収録対象 | 内容 |
|---|---|
| アプリケーション | `client/`、`server/`、`shared/`、`drizzle/` |
| ビルド・検証 | `dist/`、`scripts/`、`test-artifacts/`、テスト設定 |
| 依存関係定義 | `package.json`、`pnpm-lock.yaml`、TypeScript／Vite設定 |
| 設計・運用記録 | `todo.md`、`ideas.md`、`notes/`、調査・監査メモ |
| 参照資産一覧 | `ASSET_REFERENCES.txt` |

## 収録しないもの

`node_modules/`、`.git/`、`.manus-logs/`、環境変数ファイル、ローカル開発キャッシュは再生成可能または機密情報を含み得るため除外しています。

ブラウザのLocalStorageにのみ保存されるRecent sources、Saved playlist、ローカルで選択したMDR／MDX／PDX、ローカルSoundFont本体は、このサーバープロジェクトには保存されません。必要な場合は、利用したブラウザのサイトデータまたは元ファイルを別途保存してください。

`/manus-storage/`の資産はプロジェクトから参照されるアップロード済みファイルです。通常バックアップには参照パスのみを一覧化します。**完全バックアップ**では、アーカイブ直下の`runtime-assets/`にWASM、AudioWorklet、MIDIイベント抽出器、診断データの実体を収録します。

完全バックアップを別環境へ復元する際は、`runtime-assets/`内の各ファイルを、`ASSET_REFERENCES.txt`に記載した対応する`/manus-storage/`パスへ再アップロードしてください。アプリケーションコードのパスは変更せずに再利用できます。
