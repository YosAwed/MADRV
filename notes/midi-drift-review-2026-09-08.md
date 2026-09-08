# 内蔵SoundFontの累積遅延：同期確認と対策検討

2026-09-08 JST。ユーザー確認済みの対象は内蔵SoundFont。今回の作業はGit同期、本番照合、コードと既存測定の調査のみ。再生ロジックの実装変更・デプロイ・新規の音響再現試験は行っていない。

## 結論

同期後のローカル・GitHub・本番の再生コードは一致している。最新版にも先行予約対策は入っているが、フルトラックでの累積遅延を防げると断言できる測定はない。現状の「GS MIDI同期差」は実発音の遅れを観測しておらず、0 msでも音の同期を保証しない。

推奨は、まず実際の適用フレームと出音の差を測り、結果に応じて、(1) 音声ブロックとMIDI時刻の対応付け、(2) 取消可能な先行予約、(3) 共通の音楽tick・出力フレームによるシーケンスへ進めること。固定ms補正は一定の開始差を調整するもので、時間や周回に比例する差は解消しない。

## ローカル・リモート・本番の照合

- GitHub: `https://github.com/YosAwed/MADRV.git`
- 同期前: ローカルmainは `e8e608d`、未コミット変更4ファイル。fetchでorigin/mainが12コミット先と判明。
- 変更を名前付きstashへ保存し、`git merge --ff-only origin/main` を実行。同期後のmainとorigin/mainはともに `32597e53dddbe52c1661d073c86c388910f814cc`。
- 保全stash: `pre-sync-2026-09-08-preserve-local-ui-and-hybrid-end`、オブジェクト `d3a3945c56659e4d3911748327a64578c10ff17e`。対象は `client/src/index.css`、`client/src/pages/Home.tsx`、`client/src/lib/madrvEngine.ts`、同テスト。旧変更は削除していない。最新版との重複・相違があるので自動再適用していない。
- 本番: `https://madrv-player.madrv-player-web.workers.dev/`
- 稼働バージョン: `b09c1602-b7e5-454c-a295-e8056b66ab85`（version 59、100%配信、2026-09-07 22:09:03 JST）。
- 最新ソースからCloudflare向けビルドを生成。本番HTTP応答とローカルをSHA-256比較し、HTML、全JS/CSS、WASM、Worklet、音源補助ファイルを含む20/21ファイルが完全一致。
- 唯一の差は `__manus__/version.json`。ローカルは57バイト、本番はJSONでなくindex.htmlと同じ内容が返る。これは実在する差として残した。client内に参照は見つからず、再生バンドル・音源コアの差ではない。
- Wrangler dry-runでWorkerを生成し、Cloudflare APIから読み取った本番 `worker.js` と照合。633,015バイト、SHA-256は双方 `25104b8eae50dfa60bf964222ddbb23c853feda91c620f337c473b7039cb47ac`。
- compatibility date/flags、ASSETS、SESSIONS、`/api/*`優先ルーティングもローカル設定と一致。保存済みセッションデータ自体の全件照合は対象外。
- `pnpm check`、`pnpm check:cloudflare`、Vitest 102件、Cloudflare向けビルドが成功。これらは実音の長時間同期試験の代わりではない。

主要な照合結果:

| ファイル | SHA-256（ローカルと本番で一致） |
| --- | --- |
| index.html | `477d7bc0caf5c8f929680fddedf32a868b57a5d496929b376fd71d0d4a20b545` |
| assets/index-DgzDVTRy.js | `ecf4fea6283aa579a7ca3abb05e5a5acc08fd21d762be91fe0ab0120f7c14691` |
| assets/index-DqxNvDF2.css | `4b4a13976de40f1a2ef3e83593e5014f29cc31facb42192582ed3df2ad1159cb` |
| madrv-mdx-player-v12_2d6b7625.wasm | `12331150d43b8010544363e6678ae5e01184c2eb5d5c107d07f02fa11ad578f0` |
| spessasynth-processor.min_0ece0471.js | `109ad445931e5c6e17739a994b2694d325577a6cb6fd2b56b39385edfc9e1fb5` |

## 最新版に既にある対策

`madrvEngine.ts:418–434,1754–1762` は、MIDIを150 ms／400 ms先までアプリ側へ取り込み、通常イベントを40 ms／50 ms前にAudioWorkletへ時刻指定で渡す。後者が実際のWorkletへの予約余裕であり、両者は同じではない。

`madrvEngine.ts:2544–2583` は最初のOPM出力ブロックの `playbackTime` を開始基準に使う。48 kHzの基準、密なハイブリッド音源の安定優先選択、鍵盤通知の間引きも既に実装されている。旧ローカル版を見て「先行時刻指定を新規導入すればよい」とする結論は不適切。

## 原因候補と確度

### 1. 同期差の表示が実発音を表していない：コードで確認

`madrvEngine.ts:2382–2405` は、次の未来イベントの時刻を `mostRecentDispatchAt` に代入してからループを抜ける。その時刻と `hardwareElapsed` の小さい方を「audibleSeconds」にするため、通常の継続区間では `hardwareElapsed` 自体になる。残差は `dispatchedSeconds - scheduledSeconds`（同:283–291）なので0になり得る。

ここにはWorkletがイベントを受信・適用した時刻も、音が立ち上がった時刻も含まれない。実装上の問題は確認できるが、今回の累積遅延を起こした箇所という意味ではない。

### 2. メインスレッドの処理待ち：制約は確認、今回の原因は未確定

OPM/PCMは `ScriptProcessor` のメインスレッド処理（同:2567）。MIDIのキュー補給も `setTimeout`（同:1757）。通常の40–50 msの予約余裕を超える処理待ちでは、Workletへの到着が期限に間に合わない。

ただし単発の期限超過はまずタイミングの揺れとして現れる。それだけで「MIDIが一方向へ際限なく遅れる」とは断定できない。OPM側も遅れ得るため、どちらが相対的に遅いかは実測する必要がある。

### 3. ブロック単位の時計から毎回予約時刻を生成：揺れの要因

`madrvEngine.ts:2357–2368` はMXDRVとAudioContextの差を最初に一度取得し、同:349–353,2390で `audioNow + max(0, eventAt - hardwareElapsed)` を計算する。MXDRVの位置は描画ブロック単位で更新される。安定優先の16384フレームは48 kHzで約341.3 msに相当する。

`orderedMidiQueue.ts:38` はイベント順序を守るため前イベントより早い予約時刻を後ろへ揃える。この制約はベンド・リセットの逆転を防ぐが、元の時計推定が揺れると、後ろへずれた時刻を残す場合がある。これだけで無限に累積するとは証明できず、出力ブロックとの対応を測るべき箇所。

### 4. ループ周期の差：累積する仕組みがある

`madrvEngine.ts:932–955` はMIDI周期／OPM周期の比が整数から0.15以内なら変換器のループ窓を採用するが、周期を厳密に揃えない。同:991–996で以後のイベントに `cycle * period` を加える。

共通の音楽的周期に対し差がδ秒なら、k周後の差はkδ秒になる。既存テストには39.996秒と40.01秒、55.692秒と18.579×3秒の組合せがある（`madrvEngine.test.ts:290–305`）。これらはMIDIが早くなる方向の例で、ユーザーの遅延方向を再現した証拠ではない。問題曲の実際の共通拍・ループ境界の特定が必要。

## 対策案と優先度

| 優先 | 方針 | 効果と条件 |
| --- | --- | --- |
| 1 | 実際の適用フレームと音響差を計測 | 固定差、負荷による揺れ、ms/分の傾き、周回ごとの段差を分ける。現在の同期差表示に基づく自動補正は判断材料にしない。 |
| 2 | OPMブロックの再生予定時刻と曲内位置を継続的に対応付ける | 各ブロックの `playbackTime` と開始・終了サンプル位置からMIDIの出力時刻を求める。推定時計の段差をそのまま予約時刻にしない。 |
| 2 | 先行予約量を実測負荷に応じて増やす | 150–400 msは評価開始点の候補で、保証値ではない。既に予約したイベントをSTOP・曲変更・ミュートで取消できる仕組みとセットにする。 |
| 3 | 同じ音楽tick・出力フレームでOPM/PCMとMIDIを進める | 共通クロックとループ境界を使う。浮動小数点の秒換算は最終段に寄せ、端数を保持。MIDIがOPMの複数周期を使う曲や、終了長の異なる曲は尊重する。 |
| 3 | 唯一のOPM/PCM描画処理をAudioWorkletへ移す | UIによる処理待ちを減らす。計算量がリアルタイム予算を超える場合はWorkerで先行描画し、PCMとMIDIを同じフレーム番号でWorkletへ渡す設計も検討する。 |

`playbackTime` はAudioContextと同じ時間座標で音声の再生時刻を示すため、ブロックと曲内位置の対応に利用できる。[Web Audio仕様：playbackTime](https://webaudio.github.io/web-audio-api/#dom-audioprocessingevent-playbacktime)

AudioWorkletは音声レンダリング側で処理するため、この移行方針に適している。ただし移すだけでCPU能力は増えない。WASMを描画予算内に収め、同じ曲を2つのOPMレンダラーで進めない構成が必要。[Web Audio仕様：AudioWorklet](https://webaudio.github.io/web-audio-api/#AudioWorklet)

先行時間だけを大幅に増やすのは避ける。現状の停止はアプリ側キューをclearし、音量を下げ、stopAllを送る（`madrvEngine.ts:2447–2454`）。Workletに既に渡した将来イベントを再生世代ID等で取消する設計を併せて検討する。音符の削除や曲全体の時間伸縮で合わせる方法は採らない。

## 実装前に必要な検証

対象曲名、MDR/PDX/SoundFontの組合せ、ブラウザ・端末、選択プリセット、補正値を固定する。内蔵SoundFontであることは確認済みだが、1曲の途中で増えるかループを重ねると増えるかは未確認。

1. 問題の端末と曲で10–30分の通常負荷再生を基準にする。ループあり／なし、画面展開／折りたたみ、低遅延／安定優先を一条件ずつ比較する。
2. MIDIイベントIDごとに予定フレーム、main thread送信、Worklet受信、実適用フレームを記録。OPMブロックの曲内位置・playbackTime、未送信キュー量、期限超過数、予約時刻の後ろへの補正量を併記する。
3. OPMとMIDIに同時刻の短い打音を配置した校正曲と実曲を、同じ出力サンプル位置で別バス録音する。SoundFontの音色固有のアタックを固定差として分離し、遅れのms/分、ループ1周あたりの増分、単発の最大遅れを測る。
4. 通常負荷の後に負荷を加え、解除後にズレが戻るかを見る。実AudioContextのサンプルレートと出力装置も記録する。メインスレッドだけのCPUスロットリングを音声スレッド負荷の再現と同一視しない。
5. 対策を試す段階では停止→即再開、曲切替、ミュート、テンポ変化、長いMIDI末尾も確認する。先行予約の拡大による古いイベントの混入を検出する。

既存の90秒フルトラック負荷試験はOPM側callbackの遅れと非ゼロ出力を測ったもので、MIDIの実発音同期の保証ではない（`notes/hybrid-playback-performance-2026-09-05.md:16–34`）。「late=0」の閾値はバッファ時間の1.8倍超で、微小な遅延ゼロを意味しない。既存driftスクリプトもUI値を読む（`scripts/verify-mdr-opm-midi-loop-drift.mjs:31–55`）。最新同期修正後の長時間音響試験を今回実施したわけではないため、原因候補と確認済みの制約を区別している。
