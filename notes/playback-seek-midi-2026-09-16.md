# 内蔵SoundFontを使うMDRのシーク

開発ブランチ `codex/playback-seek` の第2段階。MDXシークについてはユーザーの検証で問題なしと確認済み。本番への反映は行わず、Cloudflare検証環境だけを更新する。

コード `df3cc4b567b3` を検証環境へ配信済み。Cloudflare Version ID: `6cfc7577-f13b-4511-ac33-41854544689f`。更新前後で本番デプロイ履歴と公開HTML／JS／CSSのSHA-256が一致した。検証環境のコードとWorkletもローカルビルドに一致。

## 動作

- OPM／PCM＋内蔵SoundFont、およびMIDIだけのMDRで位置移動を有効化。
- OPM／PCMは第1段階と同じく実レンダラーで無音の早送りを行う。
- SoundFontは旧世代の予約を破棄し、消音中にGS Resetを適用。移動先より前のBank、Program、CC、Pitch Bend、RPN／NRPN、SysExなどを元の順番で再送する。最後のCC値だけを保存する方式ではないため、Data Entry／Incrementや途中のリセットの順序を保持する。
- 復元は最大256メッセージずつ。Workletの受領・適用完了を待ち、世代番号と要求番号が一致してから再生へ進む。停止・曲変更で待機を中止し、5秒以内に応答がなければ音を再開せずエラーにする。
- MIDIの±500ms補正を含む実際の発音時刻で、復元対象と移動先以降のイベントを分ける。移動先ちょうどのイベントは通常再生へ残す。
- OPM／PCM出力フレームとMIDI予約の対応表にシークの絶対時刻を持たせ、短いOPMパートの終了後もMIDIを進める。MIDIだけの曲では、前の曲の停止済みOPM時計を参照しない。
- 無限ループではイントロと繰返し部分を区別し、過去の周回の設定を順番に復元。通常再生と同じく、2周目以降のGS Resetを除外する。
- 既存のミュートと有限回の再生回数を保持。末尾操作は表示中の周回内の移動なので、トラックごとのループ回数が異なる曲では、その後のMIDIパートが残る場合がある。

## 今回の音の扱い

移動先をまたぐMIDIの長音・サステイン音は再発音しない。移動先以降のNote Onから再開する。音色やサステイン等の設定は復元するが、発音中の波形・エンベロープ・ポルタメント履歴・残響の完全復元は行わない。画面のシーク操作説明にもMIDIの再開方法を記載した。

外部MIDI出力とMMLは対象外。再生中に外部MIDIへ切り替えた場合もシークを無効にする。

## 検証

- Vitest 207件／18ファイル、通常・Cloudflareの型チェック、検証用ビルド、`git diff --check` 成功。
- 単体・結合テストで設定順序、RPN／NRPN、SysEx、サステイン、ノート除外、±500ms補正、シーク境界、繰返し、ミュート、停止、応答タイムアウト、外部出力切替、OPM終了後のMIDI、MIDIだけの曲を確認。
- 生成したWorkletを実際のSpessaSynthコアと組み合わせたテストで、復元完了通知、Program Change、RPN Pitch Bend Rangeの適用を確認。
- `scripts/verify-mdr-seek-browser.mjs` はローカルHTTPサーバーとChrome実AudioContextを使用。楽曲・PDX・SoundFontはlocalhostでのみ読み込み、外部に送らない。発音ピーク、MIDI配信、進捗、後戻り、表示周回末尾、最終イベント後の終了、無限ループ途中への移動を確認。
- `PRIN_GS.MDR`＋GeneralUser-GS: OPM＋MIDI、約28秒地点へ約0.32〜0.34秒。
- `BIN_M_GS.MDR`＋GeneralUser-GS: MIDIのみ、約32.8秒地点へ約5〜8ms。
- `song.mdr`＋`sample.pdx`＋GeneralUser-GS: OPM／PCM＋MIDI、約13.9秒地点へ約0.15秒。
- 各曲でdesktop／mobile両方のバッファ設定を確認。いずれもMIDI発音あり、ブラウザ例外なし。Mac上のChromeでの計測であり、Safariやモバイル実機の検証ではない。

再実行例:

```sh
MDR_SEEK_SOURCE=/path/to/song.mdr MDR_SEEK_SOUNDFONT=/path/to/bank.sf2 MDR_SEEK_PDX=/path/to/bank.pdx node scripts/verify-mdr-seek-browser.mjs
```

PDX不要なら`MDR_SEEK_PDX`を省略。`MDR_SEEK_PROFILES=desktop`などで設定を限定できる。長時間再生後のシークは、過去の周回数に応じて処理量が増える。
