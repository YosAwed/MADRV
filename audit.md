# MADRV Player 監査記録

最終更新: 2026-08-20

| 領域 | 状態 | 根拠 |
|---|---|---|
| MDR・MDX・PDX・MMLのブラウザ再生 | 検証済み | ローカルMDX／MDR、MML、有限自然終了、∞ループ、書き出しのChromium回帰を実行した。 |
| OPM・PCM・GS MIDI同期 | 検証済み | 実サンプルレート、MXDRV位置、GS MIDI単一タイムライン、GS MIDI同期差の回帰を実行した。 |
| Google Drive／Dropbox共有MDR・MDX | 実装・経路検証済み | 公開共有URLを許可済み取得経路で扱い、共有MDXのバイト列判定、ヘッダー曲名、MDX再生をGoogle Drive形式のURL条件でChromium回帰した。 |
| セッションリンク・カタログ・お気に入り | 検証済み | URL復元、CORSカタログ、検索、お気に入りの回帰を実行した。 |
| MDXのPDX自動紐付け・メタデータ | 検証済み | MDXタイトル、必要PDX、候補自動選択、PCM状態をローカル入力で回帰した。 |
| MDRメタデータ・トラックミキサー | 検証済み | 曲名、必要PDX、構成、推定時間、鍵盤、ミュート・ソロをMDR回帰で確認した。 |
| テンポ・ピッチ・再生位置 | 検証済み | Timer-B、推定BPM、AudioContextクロック、MXDRV位置の診断に加え、MDXコアの48 kHz固定、44.1 kHz出力の線形PCMリサンプル、実AudioContext出力の周波数比較を回帰した。 |
| スマホ性能 | Chromiumで検証済み | 375×812でMDX／MDR各30秒の鍵盤、BPM／Timer-B、MXDRV／GS MIDI診断、停止復帰を確認した。 |
| 実機外部MIDI／GS音源 | 環境依存 | Web MIDIの列挙、出力、SysEx、All Notes Offと診断ログは実装済み。接続済みの実機音源での受信・音響確認はこの環境では未実施。 |
| 実ユーザー所有のDrive／Dropbox公開ファイル | 環境依存 | URL正規化、サーバー取得、MDX／MDR判定は検証済み。共有設定、ファイルサイズ、配布側のダウンロード制限は各ファイルで確認が必要。 |
| 実端末スマホ | 環境依存 | Chromiumのモバイル幅・CPU条件で確認済み。端末固有のAudioWorklet性能・Bluetooth／外部MIDIは実機で確認が必要。 |

> 公開共有ファイルは「リンクを知っている全員が閲覧可能」で、ダウンロード制限のない単一ファイルである必要がある。ログイン必須・閲覧制限・ダウンロード禁止のリンクは安全上取得しない。

## 監査結論

本監査で参照した主な回帰は、`verify-local-mdx.mjs`、`verify-megalith-playback.mjs`、`verify-infinite-loop.mjs`、`verify-infinite-export.mjs`、`verify-finite-natural-end.mjs`、`verify-remote-mdx-shared-link.mjs`、`verify-mdr-metadata-duration.mjs`、`verify-mobile-long-interactions.mjs`、`verify-track-mixer.mjs`、`verify-tempo-diagnostics.mjs`、`verify-audio-clock-sync.mjs`、`verify-mdr-audio-clock-sync.mjs`、`diagnose-mdx-tempo.mjs`、`verify-mdx-browser-pitch.mjs`である。併せて、型検査、Vitest 24件、本番ビルドを通過している。

監査後に報告されたMDXテンポ異常は再現・修正済みである。独立AudioWorklet経路を停止して単一レンダラーへ統一し、コアを48 kHzで固定、44.1 kHz出力を線形PCMリサンプルする方式へ変更した。DRA02.MDXでは、44.1／48 kHz・デスクトップ／モバイル相当すべてでTimer-B `0xE0`、152.6 BPM、実時間対MXDRV再生位置比3%以内を確認し、実AudioContext出力周波数比も3%以内だった。現時点で残る確認項目は、外部MIDI／GS実機、利用者が管理するDrive／Dropboxの実共有ファイル、実端末のハードウェア差という検証環境依存の項目である。
