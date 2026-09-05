# 内蔵SoundFontのポルタメント復帰修正（2026-09-05）

ユーザー提供のWelcome Racer MML（aトラック: `BR12`、`e4^8._<e`、次の`b-`）をmml2mdrでコンパイルして検証した。回帰用MML/MDRはscripts/fixtures/welcome-racer-portamento.*。元のコメントと空白を整理し、音符・音色指定は保持した。

## 調査と原因

コンパイラ側とWebプレーヤーのMIDI抽出WASM・Spessa AudioWorkletは同一バイト列。抽出結果には3.4425秒などでE0 00 40（中央8192）が存在し、BR12も正しく設定されていた。

プレーヤーは音声側の時計から各イベントの送信予定時刻を再計算し、個別のsetTimeoutや即時送信を混在させていた。このため、後のピッチ復帰イベントの予定時刻が早まると、前の下降ベンドのタイマーを追い越す。後着の下降ベンドが中央復帰を上書きしてしまう。コンパイラ側は固定時刻から順序付きで送信し、Spessaへ明示的な時刻も渡している。

通常再生では毎回症状が発生するわけではない。旧処理の実ログで下降ベンド同士の順序逆転を観測した。さらに、中央復帰イベントに40msの早い時刻補正を与えるストレス条件で、実際の内蔵音源のピッチ値が3に残る状態を再現した。この40ms補正は検証時に加えたもので、通常再生の実測値として主張しない。

## 修正

- OrderedMidiQueueでMIDIをスコアの順序通りに送る。タイマーは1個、未送信イベントはFIFO。
- 補正後の時刻を直前イベントより前にしない。同時刻・遅延したイベントも順序を維持。
- 音源へ送る時刻を明示。L境界の先行送信も前のイベントを追い越さない。
- STOPでキューとタイマーを破棄。再生世代で古いコールバックを無効化。
- 外部MIDI送信経路は未変更。

## 検証

- 同一40ms補正条件: 旧処理はピッチ3、修正後は8192。
- モバイル用バッファ＋CPU 4倍スロットルで32秒再生: 6秒・19秒・32秒の確認点で全て8192。3回の下降ポルタメント後に復帰。
- 下降途中3.1秒でSTOP→即再生: 再生6秒後に8192。
- BOMB、PRIN、MJ_RUMIを各2回のL境界を越えるまで再生。OPM/PCMとMIDIが両境界後に継続し、ページ例外・予期せぬ終了なし。
- ユニットテスト86件、アプリ・Cloudflare型チェック、本番ビルド成功。
- 永久ループの全15曲検証は前の修正時に実施済み。今回のMIDIキュー変更後は上記3曲を再検証した。

すでにWorkletへ先行送信した未来イベントを取消できない既存制限は残る。今回のSTOP→再生試験はポルタメント途中であり、全曲のL境界直前のSTOP→再生を網羅したものではない。

## 本番反映

https://madrv-player.madrv-player-web.workers.dev

Version: d326d133-b636-4358-a55b-42965e7063cb

index.html、index-BeJzhne_.js、FormatGuideDialog-CKQBp02u.jsのHTTP 200とローカルビルドとのバイト一致を確認。本番画面で再現曲の内蔵SoundFontによる発音と停止、BOMBの永久ループ開始・OPM発音・停止、ガイド表示を確認した。ピッチ値の詳細な検証はローカルの計測用エンジンで実施した。

## 再実行

```sh
node scripts/verify-portamento.mjs
SHIFT_CENTER_MS=40 node scripts/verify-portamento.mjs
DURATION_MS=32000 PERFORMANCE_PROFILE=mobile CPU_THROTTLE=4 node scripts/verify-portamento.mjs
RESTART_DURING_BEND=1 node scripts/verify-portamento.mjs
```

MDR_SF_PATHでSoundFontを指定可能。PORTAMENTO_SOURCEでMDRを指定可能。現在のスクリプトはこの回帰スコアのCh1を中央8192に戻す検証用。
