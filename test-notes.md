# 動作確認メモ

## 2026-08-20 — MDR全MIDI分類・∞ループ再生

`JESUS_SC.MDR`を解析し、0〜3番トラックが`E0 08`命令でGS MIDIモードへ入る全MIDI曲であることを確認した。トラック種別は固定のトラック番号だけでなく、MIDIモード命令も見る方式にしている。さらに、前半トラックでGS MIDIとなる場合に負の番号が出ないよう、GSラベルはMDR上の番号ではなく検出順で採番した。Chromiumで、MDR metadataがOPM／PCM 0・GS MIDI 4を表示し、Live track keysが`GS 1`〜`GS 4`となることを確認した。

通常再生には∞切替を追加した。MDX／MDRとも、∞選択時はWebAssemblyへ安全な長大ループを渡し、終了タイマーを設定せず、停止操作で終了する。MDRのGS MIDIタイムラインも周回ごとに再送する。DRA02.MDXで22秒間、HECT_GS2.MDRで従来の有限上限（約125秒）を超える128秒間の継続を確認し、いずれも明示停止後にTimer-Bが`—`へ戻ることを確認した。∞は共有セッションリンクで復元される一方、MP4書き出しは安全のため1回・指定秒数に有限化される。Vitest 21件、型検査、本番ビルド、既存MDX再生およびMDRミキサー回帰を通過した。

∞切替を有効にしたMML画面でExport MP4を実行し、「∞通常再生は書き出し時に1回・最大60秒へ安全に有限化します。」の通知後、`madrv-signal-deck-…​.mp4`のダウンロードまで完了することをChromiumで確認した。

∞導入後の有限再生も、DRA02.MDX＋DRA00.PDXおよびHECT_GS2.MDRを各1回で自然終了まで再生して確認した。いずれも終了通知、再生ボタン復帰、Timer-B `—`へのリセットを確認した。

Google Drive／Dropboxの共有URLは、URL末尾の拡張子や`view?usp=drive_link`断片に依存せず、取得したバイト列を検証してMDR／MDXを判定する。共有MDXはMDX専用のOPM／PDX再生経路へ送られ、主再生デッキのタイトルには共有URLの`VIEW?USP=DRIVE_LINK`ではなくMDXヘッダー曲名を表示する。`https://drive.google.com/file/d/shared-mdx-id/view?usp=drive_link`と同型のURLで、Chromiumが`publicStorage.fetchAsset`をMDX・PDXの各入力について呼び出すことを確認し、DRA02.MDX＋DRA00.PDXのMDX判定、曲名「悪魔城ドラキュラ (C)KONAMI  [      Wiched Child       ]  cv. DIS」の表示、Timer-B検出までの再生開始、停止操作を確認した。サーバー側の単体テストでは、Drive共有URLが`drive.usercontent.google.com/download`へ正規化され、`mdx`種別のバイト列として返ることも確認した。

MDRメタデータには、WebAssemblyで計測した有限1回のOPM／PCM時間と、GS MIDI最終イベント時刻を補正した`Estimated duration`を追加した。MEGALITH.MDR＋MEGALITH.PDXをChromiumで読込み、曲名、必要PDX、OPM／PCM・GS MIDI構成と推定時間が同時に表示されることを確認した。

375×812のスマホ幅でDRA02.MDX＋DRA00.PDXとHECT_GS2.MDRを各30秒継続再生した。再生中は軽量発音インジケーターが鍵盤状態を更新し、MDXでは推定BPMとTimer-B、MDRではMXDRV再生位置とGS MIDI同期差の各診断が`—`以外へ更新することを明示アサートした。再生マーカーはMDXで0.71%→44.79%、MDRで0.14%→23.17%まで継続進行し、停止後はいずれもTimer-Bが`—`へ戻ることを確認した。

MDXテンポ異常について、DRA02.MDX＋DRA00.PDXで実時間とMXDRV再生位置を12秒間比較した。デスクトップ48 kHzで比率1.0027、デスクトップ44.1 kHzで1.0028、モバイル幅48 kHzで0.9973、モバイル幅44.1 kHzで1.0120となり、いずれも実時間に追従した。モバイル用AudioWorkletは独立したMXDRVインスタンスを生成しており、再生・計測・診断の時系統を二重化するため、MDXはモバイルを含めて単一のScriptProcessor再生経路へ統一した。モバイルでは4096フレームのバッファを維持し、音声処理を優先する。型検査、Vitest 23件、本番ビルド、MDXのローカル再生回帰を通過した。

統一後の最終回帰では、44.1 kHzデスクトップ相当でAudioContextクロック44.1 kHz、Timer-B `0xE0`、実時間12.030秒に対してMXDRV再生位置12.025秒（比率0.9995）を確認した。モバイル相当でも同じ44.1 kHzクロック、Timer-B `0xE0`、実時間12.065秒に対してMXDRV再生位置11.886秒（比率0.9852）を確認した。MXDRVの初期化サンプルレートをAudioContextと一致させ、実時間比を3%以内にアサートすることで、再生速度とサンプルクロックに起因する音高の伸縮がないことを回帰対象とした。

MDXコアの44.1 kHz初期化では同一再生位置の支配周波数が48 kHz時と異なることを確認したため、MADRV用AudioContextをコア基準の48 kHzで生成し、デバイス側への変換はWeb Audioへ委ねる方式へ変更した。DRA02.MDXの48 kHz固定コア出力は二回の周波数解析でいずれも61 Hz（比率1.0000）となった。Chromiumのデスクトップ／モバイル幅ともAudioContext 48.0 kHz、Timer-B `0xE0`、Timer-B換算152.6 BPMを確認し、実時間比はそれぞれ0.9999と1.0056だった。

最終版では、48 kHz固定MXDRVコアから44.1 kHz出力へ線形補間でPCMを連続変換する。実レンダラーと同一のリサンプル関数は、48 kHzの440 Hz正弦波を44.1 kHzへ変換しても440回の正方向ゼロ交差を維持するVitestで確認した。Chromiumの実AudioContext出力でもDRA02.MDX再生位置2秒台で、48 kHzデスクトップは70.31 Hz、44.1 kHzデスクトップとモバイル幅はいずれも68.64 Hzを検出し、周波数比0.9762（許容3%以内）で一致した。Timer-B `0xE0`と152.6 BPM、実時間対MXDRV再生位置比も44.1／48 kHzのデスクトップ・モバイル条件で3%以内を確認した。

MDR無音・再生位置・BPM異常は、GS MIDIトラックが先頭にある混在MDRを単純にMDX化していたことが原因だった。MEGALITH.MDRでは旧変換器がPCMピーク0、Timer-B `0x00`、計測2.015秒となった。ハードウェアFM／PCMトラックのみを抽出・再配置する変換器へ変更後、同曲でPCMピーク6,211以上、Timer-B `0xC8`、有限計測436.253秒を確認した。Chromium実出力ではピーク−61.7 dB、Timer-B `0xC8`、推定87.2 BPM、MXDRV位置00:03.153を確認し、12秒回帰では再生位置が00:00.458から00:12.156まで進み、停止後にTimer-Bが`—`へ戻った。MDXローカル再生、型検査、Vitest 24件、本番ビルドも通過した。

HECT_GS2.MDR（OPM／PCM 8トラック、GS MIDI 7トラック）も同じ変換器で12秒回帰した。Timer-B `0xC8`、MXDRV位置00:00.544→00:11.726、GS MIDI／MXDRV同期差−17〜+34 ms、停止後Timer-B `—`を確認した。MEGALITHのPCM実出力、HECT_GS2の混在MIDI同期、既存MDXのローカル再生を合わせて、変換器変更後のMDR／MDX回帰とした。

MDX／PDXのPCMスライダーは、混合済みのハードウェアPCMをOPMゲインへ接続していたため反映されなかった。OPM（チャンネル0〜7）とPCM（チャンネル8〜15）を同期した別レンダラーで出力し、それぞれOPM／PCMゲインへ接続する方式へ変更した。DRA02.MDX＋DRA00.PDXのChromium実AudioContextで、PCM 0%は−146.7 dB以下、PCM 100%は−57.4 dB以上となり、PC・スマホ相当で個別制御を確認した。スマホではWASM出力ポインタを再利用し、リサンプル残フレームを保持、音声バッファを16,384フレームへ拡大した。通常CPUの375×812・30秒回帰と4倍CPUスロットル回帰の双方で、OPM／PCM音声コールバックの期限超過警告は0件だった。

周期ノイズはChromiumのスマホ相当条件では再現しなかったため、PCMブランチの実波形を追加計測した。DRA02.MDX＋DRA00.PDXのPCM活動中、通常CPUでは12秒間172標本すべてで発音を確認し、無音ドロップアウト0、最大サンプル差比0.303、音声期限超過0件だった。4倍CPUスロットルでも31標本すべてで発音を確認し、無音ドロップアウト0、最大サンプル差比0.295、期限超過0件だった。したがって、確認できた不具合はPCMゲインの誤配線であり、周期ノイズについてはコールバックごとのWASM確保とリサンプル境界を除去し、バッファを拡大した対策後の検証条件では再現していない。

## 2026-08-20 — MDR終了判定・GS MIDI同期・メタデータ

MDRの終了は、有限ループ回数をMXDRVへ渡したうえで、OPM／PCMの計測時間とGS MIDI最終イベント時刻＋1.5秒の長い方をブラウザ側の有限上限として扱う方式へ変更した。これにより、短いOPM計測値だけで停止することを避けつつ、無限ループは明示した上限で停止する。`MEGALITH.MDR`＋`MEGALITH.PDX`は、従来の約2秒で止まらず、最終GS MIDIイベント（311.23875秒）を越える320秒の自然終了回帰で停止状態・Timer-B `—`への復帰を確認した。

`HECT_GS2.MDR`は、曲名「Super Star Soldier - ｢ Hector'87 ｣ - / for OPM+SC-55 by AVG-FOE.」、OPM／PCM 8トラック、GS MIDI 7トラックとして表示される。MDR内には固定の後半トラックだけでなく`E0 08`でGS MIDIモードへ切り替わるトラックがあるため、メタデータとミキサーの分類を動的判定へ拡張した。GS MIDIは個別タイマーではなくAudioContext基準の単一タイムラインで送出し、実サンプルレートを渡す抽出WebAssembly v3で時刻換算する。HECT_GS2のGS MIDIイベントは最終123.648秒で、補正後の有限上限（125.148秒）で自然終了して停止状態・Timer-B `—`へ復帰することをChromiumで確認した。デスクトップ・375×812相当のモバイル幅での15秒継続、MEGALITHのPDX紐付け表示、既存MDX再生、MDR鍵盤・ミュート回帰も確認した。Vitest 21件、型検査、本番ビルドを通過している。

HECT_GS2のデスクトップ回帰では、Timer-B `0xC8`の継続中にMXDRV実行位置が`00:00.229`から`00:14.393`まで15秒間ほぼ実時間で進むことを自動アサーションした。GS MIDIは同じAudioContext開始時刻を基準にイベントを送出するため、OPM／PCMの実行再生位置と独立した個別タイマーによるドリフトを避ける構成である。

GS MIDIイベントの予定時刻と実送出時のMXDRV位置の直接比較も追加した。HECT_GS2の15秒回帰では差分が`0`〜`-80 ms`に収まり、350 msを超えるドリフトを失敗扱いにするアサーションを通過した。これにより、OPM／PCM実行クロックとGS MIDIイベントタイムラインが同じAudioContext基準で追従することを確認した。

さらに60秒の長尺区間で、30件以上のGS MIDI／MXDRV直接比較を必須にする回帰を実行した。MXDRV再生位置は`00:00`から`00:59.808`へ継続進行し、各GS MIDIイベントの送出時刻との差は350 ms未満で推移した。これを超える場合は回帰を失敗扱いとするため、部分ごとにテンポが分離して進行する経路を検出できる。

## 2026-08-20 — MEGALITH.MDR／PDXの冒頭停止修正

提供された`MEGALITH.MDR`（62,957 bytes）と`MEGALITH.PDX`（52,627 bytes）で、従来のOPM計測値が約2秒となり、ブラウザ側の終了タイマーが曲を停止していたことを再現した。一方、同一MDRから抽出したGS MIDIイベントは41,489件、最終イベントは311.23875秒にあり、OPMの事前計測だけではMDR全体の終端を表せないことを確認した。

MDR再生時間を、OPM／PCM計測値とGS MIDI最終イベント時刻＋1.5秒の大きい方へ補正した。Chromiumのデスクトップ1280×900およびモバイル375×812で15秒間再生を観測し、従来の約2秒では停止せず、再生位置が0.2%から4.8%まで連続して進行することを確認した。Vitest 18件、型検査、本番ビルド、既存のローカルMDX再生とMDRトラックミキサー回帰も通過した。

## 2026-08-20 — 初期画面

開発プレビューでSignal Deckの初期画面を確認した。MML、ローカルファイル、リモートURLの各入力モード、GS MIDI出力先の切替、ループ回数と最大書き出し秒数の上限欄、MP4書き出しボタン、ソース準拠のMADRVクレジットとAwedクレジットが表示されている。次にMML再生、構文エラー、MediaRecorder書き出し、外部MIDIの利用可否を操作検証する。

## 2026-08-20 — MML再生

標準MMLサンプルの再生開始後、操作ボタンが停止状態に切り替わり、OPMエンジンが`armed`、再生時間が`00:01.739 — 00:05.000`、信号窓とステータスが更新されることを確認した。9ノートがOPM経路へ送出される状態表示も一致している。

## 2026-08-20 — 構文エラー

`T120 O4 L4 c q`を入力して再生すると、エディタ直下と再生デッキの両方に`1行 14列: 「q」は未対応のMML記号です。`が表示された。MMLの実行を開始せず、エラー箇所を特定できることを確認した。

## 2026-08-20 — MP4書き出し開始

有効な標準MMLを復元して`Export MP4`を実行した。ボタンは`Rendering`へ切り替わり、OPMが`armed`、再生時間が書き出し処理と同期して進行した。ステータスには`最大60秒・1回指定で有限化し、MP4書き出しを開始します。`と表示され、無限出力ではなく有限スコアを処理するフローが開始されている。

## 2026-08-20 — MP4書き出し完了

書き出し完了後に`音声付きMP4を書き出しました。`と表示された。ダウンロード領域には`madrv-signal-deck-2026-08-20T00-34-43-815Z.mp4`（460,745 bytes）が生成されており、コンテナはISO Base Media MP4として検出された。検査ではVP9映像ストリームとOpus音声ストリームの両方が確認できた。

## 2026-08-20 — 外部MIDI出力

開発ブラウザには外部MIDI出力機器が接続されていなかった。外部MIDIボタンの操作後もブラウザコンソールに例外は記録されなかった。実機を接続した環境での機器列挙、ノート送出、All Notes Offについては公開後の実機確認が必要である。

## 2026-08-20 — MDR WebAssembly・GS SysEx

Signal Deckの画面に、MDR／PDX完全再生の入力導線、GS Reset、Part Rx On／Off、外部GSテスト音の各操作が表示されることを確認した。検証ブラウザではMIDI出力機器が検出されず、外部MIDI切替はSoundFont出力を維持する安全な案内となった。外部機器が接続された環境では、ユーザー操作でGS Reset、Part有効化、C4テストノート、All Notes Offを順に送出する。OPM／PDX完全再生はMDRをMDX互換へ変換するWebAssemblyコア、MIDI／SysExはmpxadrvのタイミング付きイベント変換WebAssemblyを使用する。物理GS音源が検証環境にないため、受信音・応答は利用者の接続環境で確認が必要である。

## 2026-08-20 — WebAssembly統合後の回帰確認

標準MMLを再生し、OPMエンジンが`armed`へ遷移、再生時刻が進行し、5秒のスコア終了後に再生ボタンと状態が待機へ戻ることを確認した。表示は`MMLスコアの再生が終了しました。`となり、MDR／SysEx追加後も既存のMML再生フローは維持されている。

## 2026-08-20 — MDR完全再生テスト準備

ローカルファイルタブへ切り替え、MDR／PDXの複数選択・ドラッグ＆ドロップ入力と、WebAssembly完全再生の案内が表示されることを確認した。次段階では、PDX不要の最小OPMトラックを持つ有効なMDRをブラウザ内へ一時投入し、変換・レンダリング経路を検証する。

ブラウザ内で一時生成した`wasm-opm-test.mdr`（150 bytes）を入力したところ、タイトル`WASM TEST`、OPM／PDX 1トラック、GS MIDI 0トラックとして検査・読込された。MDRのヘッダー、32トラックオフセットテーブル、E0 FFシグネチャの検証経路がブラウザ側で通過している。

同MDRで再生を開始すると、画面は`MDR / OPM + PDXをWebAssemblyで再生中です。ループ上限: 1回。`へ遷移し、再生時間が`00:00.000 — 00:02.015`として計測された。終了後には`MDRのOPM／PDX再生が終了しました。`と表示され、OPM WebAssemblyコアの変換、PCMレンダリング接続、有限ループ終端、停止処理の一連の経路を確認した。

## 2026-08-20 — 診断・ミキサー・カタログ拡張

Signal Deckに外部GS音源の診断ログ、GS PartのPatch／Level操作、トラック別ミキサー、CORS対応リモートカタログを追加した。テスト用のJSONカタログを読み込むと2件の楽曲が表示され、`gs`検索ではGSタグを持つ1件だけに絞り込まれた。お気に入り登録した楽曲はブラウザを更新した後もlocalStorageから復元された。検証環境にはWeb MIDI APIの利用可能な外部機器がないため、実機送出は行えなかったが、API非対応・機器未接続時に診断パネルへ状態を表示する安全な経路を実装した。OPM／PCMはMXDRVのChannelMask、GS MIDIはMDR由来のsourceTrack番号を使って個別ミュート・ソロを反映する。

トラックミキサーの入力検証として生成したMDRは、相対オフセットの組み立てが誤っており、検査器は`MDRトラック26のオフセットが範囲外です。`と表示して読み込みを拒否した。この結果により、ミキサー表示前のMDR構造検証が保持されていることを確認した。続く検証では、正しい相対オフセットを持つ最小MDRを用いる。

正しい相対オフセットを持つ最小MDR（`mixer-test-valid.mdr`）では、タイトル`MIXER TEST`、OPM／PDX 1トラック、GS MIDI 1トラックとして読込まれた。Track matrixには`OPM 1`と`GS 16`が表示され、OPM 1のM操作後はボタンが`UNM`へ変化し、カウンターが`2 ACTIVE · 1 MUTED`、状態メッセージが`OPM 1をミュートしました。`となった。MXDRVのChannelMaskへ反映されるハードウェアトラックミュートと、MDR sourceTrackを使うGS MIDIミュートのUI状態を確認した。

## 2026-08-20 — リモートSoundFont URL検証

GeneralUser GS v1.471のGitHub Raw URLは、`Access-Control-Allow-Origin: *`および約31 MBの応答を確認した。URLプリセットの選択とブラウザからの取得は動作したが、プレビュー環境ではSpessaSynthが`Could not create the AudioWorkletNode. Did you forget to addModule()?`を返した。リモート読み込みとローカル読み込みで共通するWorklet初期化経路を修正後、再検証する。

SpessaSynthの配布済みAudioWorkletプロセッサを公開資産として登録し、`audioWorklet.addModule()`完了後にシンセサイザーを生成するよう修正した。新しいAudioContextでGeneralUser GSのプリセットURLを再設定し、読み込み再試行の準備ができている。

## 2026-08-20 — 共有セッションリンク

Signal Deckの再生デッキに共有セッション操作を表示し、標準MML・ループ回数1・最大60秒を含むURLを生成してクリップボードへコピーできることを確認した。URLは`sd=1`、`loops`、`maxSec`、`mml`を含み、ローカルファイル・外部MIDI出力先・診断ログは含まれない。次に生成URLを新規表示して復元フローを確認する。

生成済みURLを直接開くと、MMLテキスト、ループ上限、最大秒数が初期化時に復元され、画面には`共有セッションのMMLと再生上限を復元しました。再生はこのブラウザでPLAYを押して開始してください。`と表示された。共有先で自動再生を行わず、受信者の明示的な再生操作を求める挙動を確認した。

## 2026-08-20 — 画面幅・診断カタログ検証

375×812のモバイル幅では、Signal routing、再生デッキ、共有セッション、Source Station、GS MIDI操作が1カラムで順に表示され、横方向の切れ・重なりは見られなかった。1280×720のデスクトップ幅では、左の信号レール、主再生デッキ、右側のGS操作ベイが保持され、共有リンク操作もループ設定直下に表示された。

即時テスト用の`Signal Deck — Diagnostic MDR`カタログを同一オリジンの静的配信資産として登録した。カタログJSONはHTTP 200・`application/json`、MDRはHTTP 200・`application/octet-stream`で取得できることを確認し、カタログ形式とMDR構造検証を自動テストへ追加した。

診断カタログURLとMDR URLを含む共有セッションを新規表示で開き、Remote URLモード、MDRタイトル`Signal Deck Diagnostic`、1つのOPMアクティブトラック、ミキサー表示、ループ回数1・最大60秒が復元されることを確認した。受信側画面には再生前に`リモートMDRを読込みました。共有セッション / 1 active tracks。`と表示された。

Remote catalogの`Signal Deck diagnostic catalog`プリセットを実際に選択し、URL欄へ診断カタログが設定されることを確認した。`Load catalog`により1件の`Signal Deck — Diagnostic MDR`が表示され、当該項目を選ぶとMDRの取得・検査・Remote URLモードへの反映・OPM 1トラックのミキサー表示まで実行された。

失敗ケースとして`https://example.invalid/missing.mdr`をLoad sourceへ指定し、既存の再生状態を安全に停止したうえで、`MDR URLを取得できませんでした。CORS対応URLか、Google Drive／Dropboxの公開共有リンクを指定してください。`という復旧可能な案内が表示されることを確認した。

MMLモードへ切り替えて標準サンプルをPLAYすると、再生ボタンが停止状態へ変化し、再生時計は00:01.550／00:05.000まで進み、OPM経路が`armed`、案内が`9ノートをOPM経路へ送出しています。`となることを確認した。

GeneralUser GS v1.471のCORS確認済みプリセットを選び、Loadで外部GitHub RawからSoundFontを取得・AudioWorklet経路へ初期化した。音源名が`Remote · GeneralUser%20GS%20v1.471.sf2`へ変わり、`CORS対応SoundFontをブラウザ内へ読み込みました。MDRとMMLのGS MIDIトラックに使用します。`と表示されることを確認した。

### 幅別の実操作自動検証

既存Chromiumを用いる`verify-responsive-flows.mjs`を実行し、375×812のmobileと1280×720のdesktopでいずれも成功した。各幅で、標準MMLの再生開始、`loops=2`・`maxSec=45`を含む共有URLからのMDR復元、無効なMDR URLの失敗案内、GeneralUser GSのリモートSoundFont読込を実操作で確認した。各幅の全ページ画面は`test-artifacts/mobile-responsive-flow.png`と`test-artifacts/desktop-responsive-flow.png`に保存した。

## 2026-08-20 — ローカルMDX選択修正

ローカル入力の`accept`へ`.mdx`を追加し、MDXはMDR検査・変換を経由せずWebAssemblyのMDX／PDXプレーヤーへ直接渡すようにした。公開リポジトリの検証用`BOM_01.MDX`をChromiumで選択し、`MDX「BOM_01.MDX」を読込みました。`の表示後、`MDX / OPM + PDXをWebAssemblyで再生中です。ループ上限: 1回。`が表示されるまでを実操作で確認した。

同じローカル入力で、診断用`signal-deck-diagnostic.mdr`の選択、`DRA00.PDX`の後からの追加、`BOM_01.MDX`への切替を順に行う回帰検証を実行した。MDR・MDX・PDXの3拡張子が`accept`に含まれること、MDR選択時の曲情報表示、PDX追加時の組合せ案内、MDX選択後の再生開始をすべて確認した。

## 2026-08-20 — MDX再生開始と必要PDX案内

MDXのヘッダーからPDX名を抽出し、MDX切替時に古い別曲のPDXを引き継がないようにした。`DRA02.MDX`と`DRA00.PDX`の正しい組合せではWebAssembly再生開始を確認し、PDX未選択の新規画面では再生前に`このMDXはPDX「dra00.PDX」を必要とします。`と表示されることを確認した。MDXヘッダー解析の単体テストも追加した。

## 2026-08-20 — MDX詳細表示とPDX自動紐付け

ローカルMDX入力時に、MDXタイトル、必要PDX名、実際に紐付いたPDX、紐付け方法、選択済みPDX候補を「MDX link analysis」として表示するようにした。追加済み候補または同時に選択した複数ファイルから、必要PDXと同じベース名のファイルを自動選択する。Chromiumで、追加済み`DRA00.PDX`からの`DRA02.MDX`自動紐付け、MDX／PDX同時選択時の自動紐付け、PDX未選択時の案内を確認した。

## 2026-08-20 — MDX無音修正

WebAssemblyの`mdx_player_render`はPCMバッファを埋めた成功時に`0`を返す。従来は`0`を失敗として扱い、書き込まれたPCMを全ゼロのバッファへ置き換えていたためMDX／MDRが無音になっていた。負値のみを失敗扱いへ変更した。`DRA02.MDX + DRA00.PDX`をWebAssembly単体で80ブロック描画し、最大振幅`12822`、非ゼロサンプル`326217`を確認した。

修正後はMDX link analysis内にEngine outputを追加した。Chromiumで`DRA02.MDX + DRA00.PDX`の再生開始後、`Non-zero · peak <値>`の表示を待機して、WebAssembly出力がWeb AudioのScriptProcessorを通過して非ゼロPCMとして処理されることを確認した。

## 2026-08-20 — PCM／PDX ENGINES状態

ENGINESのPCM／PDXは、選択済みPDXとブラウザ内の非ゼロPCM出力ピークを組み合わせて判定するようにした。`DRA02.MDX + DRA00.PDX`の再生中にPCM／PDX行が`ARMED`となり、停止操作の直後に`AWAIT`へ戻ることをChromiumの操作テストで確認した。

## 2026-08-20 — PCM継続再生状態によるENGINES精度改善

`mdx_player_get_pcm_active_mask()`は、ADPCM DMAの継続状態をチャンネル0、PCM8 DMAの残量をチャンネル1〜7として返すように更新した。同じレンダリング区間で始まった短いPCMサンプルもキーオン情報で補助的に統合する。フロントエンドは700 msの保持タイマーを使わず、各ScriptProcessor処理ブロックで受け取るマスクをそのまま表示するため、PCM継続中だけ`ARMED`、発音終了時だけ`AWAIT`となる。MDX link analysisはPCM activityと混合されたEngine outputを別表示に変更した。

Chromiumの`verify-local-mdx.mjs`で、PDXを必要としない`BOM_01.MDX`へ`DRA00.PDX`を明示的に選択しても、再生開始から1.2秒後までPCM／PDXが`AWAIT`のままであることを確認した。同じ検証で`DRA02.MDX + DRA00.PDX`を再生すると`Active · ch <番号>`を検出してPCM／PDXが`ARMED`となり、停止後に`AWAIT`へ復帰した。WebAssembly単体診断でも、実際のPCM出力ブロックでPCM活動マスクがチャンネル0として得られることを確認した。Vitest 9件、TypeScript型検査、本番ビルドも通過した。デスクトップ全体の画面確認では、追加したPCM activity／Engine outputの2項目がMDX link analysis内に収まり、既存のSignal Deckレイアウトを崩していないことを確認した。

最終WebAssembly診断は、`DRA02.MDX + DRA00.PDX`内に開始15.936秒・継続2.373秒のPCM活動区間があることを示した。待機付きChromium回帰では、再生開始16.100秒後のこの区間でPCM／PDXが`ARMED`のまま、2.500秒後の区間終了後に`AWAIT`へ戻ることを確認した。これにより、時間ベースの保持ではなくADPCM DMA／PCM8 DMAの実際の活動状態による遷移を確認した。

## 2026-08-20 — トランスポートと出力レベル表示

再生デッキの装飾的なランダムバーを撤去し、`Playback position`、百分率、経過済み区間、菱形マーカーから成るトランスポート表示へ変更した。経過時間はAudioContextに同期した`requestAnimationFrame`の更新値から算出し、マーカーはレイアウトを伴わない`translate3d()`で毎フレーム移動する。Chromium回帰では、0.35秒時点と0.80秒時点のマーカー位置を比較して後者が確実に進行することを確認した。

サイドバーの横バーは再生レベルや波形ではなく各エンジンの設定済み出力レベルであることを、`Configured output level`と数値で明示した。操作用スライダーにも`Output level`と百分率を表示した。Chromiumで3つの出力レベル説明が表示されること、Vitest 10件、TypeScript型検査、本番ビルドが通過することを確認した。

## 2026-08-20 — MDXのPDX拡張子重複防止

PDX表示専用の`formatPdxFileName()`を追加し、PDX名がすでに`.PDX`または`.pdx`で終わる場合は拡張子を追加しないようにした。MDX link analysis、ファイル追加案内、再生前の不足・不一致エラー、MDRのPCM不足エラーで共通して使用する。Chromium回帰では、ヘッダーに`DRA00.PDX`を記録したMDXをローカル選択し、案内と`Required PDX`が`DRA00.PDX`となり、`DRA00.PDX.PDX`が一切表示されないことを確認した。Vitest 11件、型検査、本番ビルド、既存のローカルMDX再生回帰も通過した。

## 2026-08-20 — MDRトラック鍵盤とミュート操作

MXDRVのFM／ADPCM／PCM8各トラックから実際のノート値を返す`mdx_player_get_hardware_track_note_raw()`をWebAssemblyへ追加し、OPM・PCMはキーオン中のピッチクラス、GS MIDIはノートオン／オフイベントを鍵盤表示へ接続した。MDR mixerの各トラックには12鍵の`Track keyboard`、発音状態、`MUTE OFF`／`MUTE ON`の切替ボタン、`SOLO`を表示する。`DRA02.MDX + DRA00.PDX`のWebAssembly診断でFMとADPCMの生ノート値が再生に応じて更新されることを確認した。Chromium回帰ではMDR再生開始、鍵盤領域、ミュートのオン・オフ、停止後の待機復帰を確認した。Vitest 13件、型検査、既存MDX回帰、本番ビルドを通過した。

実ブラウザの発音確認には、GS MIDIのCノートを含む最小MDRを用いた。ChromiumでGS 1トラックが`Awaiting`から`Key on`へ遷移し、C鍵がSignal Limeで点灯すること、GS 1の`MUTE ON`で鍵盤が`Muted`になり、解除後に停止すると`Awaiting`へ戻ることを確認した。再生中画面は`test-artifacts/track-mixer-key-on.png`として保存している。

OPM側も、`DRA02.MDX`の実FM／PCM命令列をMDRフレーミングへ組み立て、GS MIDIのCノートを加えた回帰素材で確認した。ChromiumではOPM 1〜8とGS 1が再生中に`Key on`となり、各トラックの実際の発音キーがSignal Limeで点灯した。停止後はOPM 1とGS 1の両方が`Awaiting`へ復帰した。これにより、OPM／PCMのMXDRV状態取得とMIDIイベントの両経路が、トラック鍵盤表示へ反映されることを確認した。

## 2026-08-20 — MDX鍵盤の可視性と再生クロック同期

鍵盤状態の更新がMDR経路に限られ、ローカルMDXでは点灯状態が通知されない不具合を修正した。MDXを選択するとOPM（およびPDX選択時はPCM）のトラックを初期化し、再生デッキ直下の`Live track keys / always visible`で常に見える小型鍵盤を表示する。詳細なMUTE／SOLO操作は既存のTrack matrixへ残した。Chromiumで`DRA02.MDX + DRA00.PDX`を再生し、OPM鍵盤概要の待機・点灯を確認した。

テンポ・ピッチについては、v7とv8のWebAssemblyを同じ48 kHz条件でDRA02へ適用し、計測再生時間、1秒PCMのチェックサム、ピーク値が一致することを確認した。一方、ブラウザのAudioContextが44.1 kHz等の場合にWASMを固定48 kHzで初期化するとクロック不一致が起こり得るため、再生コアを実際の`AudioContext.sampleRate`で初期化するよう修正した。Vitest 14件、型検査、MDX鍵盤回帰、MDRミキサー回帰、既存ローカルMDX回帰、本番ビルドを通過した。

44.1 kHzを指定して生成したChromiumのAudioContextでも、DRA02.MDX＋DRA00.PDXの再生開始、OPM鍵盤点灯、Signal Routing内の`Audio clock / synced`が`44.1 kHz`となることを確認した。これはUI表示とWebAssembly初期化の双方が、同一の実AudioContextクロックを使用する回帰である。

同じ44.1 kHz条件で、DRA02由来のOPM命令列とGS MIDIノートを含むMDRも再生した。MDR再生中に`Audio clock / synced`が`44.1 kHz`を示し、OPM 1の鍵盤が点灯した。これにより、MDXの直接ロード経路とMDR変換後ロード経路の両方で、WebAssembly再生コアがブラウザの実AudioContextクロックに同期することを確認した。

## 2026-08-20 — BPM・Timer-B・再生クロック診断

再生デッキへ`Playback diagnostics`を追加した。MMLは最初の`T`命令をBPMとして表示し、MDR／MDXはWebAssemblyから取得する実行中のOPM Timer-Bレジスタ（0x12）を48 PPQNの四分音符BPM相当へ換算して表示する。AudioContextクロックはWASM初期化に渡す実値を表示する。ChromiumでDRA02.MDX＋DRA00.PDXを再生し、Timer-B `0xE0`、推定`152.6 BPM`、実クロック`44.1 kHz`が同時に更新されることを確認した。Vitest 16件、型検査、MDX／MDR 44.1 kHz回帰、トラックミキサー回帰、本番ビルドを通過した。
