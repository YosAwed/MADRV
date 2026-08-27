# Google Drive共有SoundFont調査メモ

- 対象共有URL: `https://drive.google.com/file/d/1zgIyr_uP2_D_LSa0VhTl-FAInAV2bzaK/view?usp=share_link`
- Google Driveの表示名: `OmegaGMGS2.sf2`
- 正規化ダウンロードURL: `https://drive.usercontent.google.com/download?id=1zgIyr_uP2_D_LSa0VhTl-FAInAV2bzaK&export=download&confirm=t`
- 公開ダウンロード応答: `Content-Type: application/octet-stream`、`Content-Length: 278600888`、CORS許可あり。
- 開発サーバーの `/api/public-storage/soundfont` は対象URLへHTTP 200でストリーミングできる。
- 公開環境では同ルートがHTTP 500となり、実ブラウザ診断で `Remote SoundFont load failed` を再現した。
- 公開応答ボディ経由の大容量転送を避けるため、CORSを許可するGoogle Drive `drive.usercontent.google.com` URLはブラウザから直接取得し、サーバー経由はCORS非対応の共有リンクだけにフォールバックする方針とする。
