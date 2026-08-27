# ブラウザ再生実装の調査メモ

## 2026-08-20 — 再生エンジンの方向性

| 候補 | 確認できた事項 | 本サービスでの扱い |
|---|---|---|
| mpxadrv | macOS向けネイティブCLIで、mdxmini・FluidSynth・CoreAudio／CoreMIDIに依存する。MDRのリモートカタログとMDR/PDXのURLペアというデータモデルは参照できる。 | MADRV互換性の仕様・カタログ形式の参照元として使用する。静的Webアプリへはそのまま移植できない。 |
| webMDX | mdxmini/pdmminiのエミュレータロジックをJavaScriptで実行し、Web Audio経由でMDXを再生する実例。MDXファイルのドラッグ＆ドロップに対応する。 | MDX/PDX向けのブラウザ再生候補。ライセンスとソース構成を確認してから採用可否を決定する。 |
| WASM MDXPlayer | ブラウザでMDX/PDX/ZIPのドロップ再生、再生・停止・フェード、スペクトラムとループ／テンポ表示を実現している。 | WebAssembly移植の実現性を裏付ける参考実装。MDR固有トラックの再生は別途実装または変換が必要。 |

## 設計上の結論

本Webサービスは、通常のMMLをブラウザ内のWeb Audioオシレーターで即時再生する。MADRVのMDR／PDX再生は、CORSで取得したバイト列をWebAssemblyベースのMDX互換デコーダへ渡す。mpxadrvが扱う32トラックMDRのMIDI部分は、タイミング付きイベント列としてWebAssemblyから抽出し、Web MIDIまたはブラウザ内シンセでOPM／PCM再生と並行送出する。有限ループ回数のOPM／PDXレンダリングはブラウザで実動検証済みである。

## 3系統再生の追加要件

MADRVの再生パイプラインは、OPM（YM2151）によるFM音源、PDXによるPCM音源、GS音源を要するMIDIの3系統を共通の再生クロックに同期させる。MIDI系統はWeb MIDI出力を利用できる場合には接続済みのGS互換ハードウェアへ送出し、それ以外ではユーザーが指定したGS対応SoundFontをブラウザ内のSoundFontシンセへ読み込む。SoundFontの配布・内蔵はライセンス確認が必要なため、初期実装ではURLまたはローカルファイルをユーザー自身が指定する方式を優先する。

## GS MIDIの実装方針

GeneralUser GSはGM／GS互換で、259の音色プリセットと11のドラムキットを備えるSoundFontバンクとして公開されている。一方で、SoundFont 2.01モジュレーター対応のシンセサイザーを前提としており、すべてのSoundFontプレーヤーで同じ音にはならない。そのため、ブラウザ内シンセにはSF2/DLSおよびWeb Audioに最適化された`spessasynth_lib`を採用候補とし、GS対応SoundFontはユーザーがローカルファイルまたはCORS許可済みURLから指定できるようにする。物理GS音源を利用したい場合は、Web MIDI APIでMIDIイベントをそのまま出力する経路を提供する。

SpessaSynthの公開アプリはApache-2.0ライセンスで、SoundFont2ベースのリアルタイムシンセサイザーとしてWeb MIDI API、ローカル／リモートMIDI再生、GeneralUser GSの同梱例を示している。個別ライブラリである`spessasynth_lib`はWeb Audio向けのラッパーとして案内されているため、画面実装ではなくライブラリ側を依存関係として用いる。

GS MIDIの出力先は、ブラウザ内のSoundFontシンセサイザーと、Web MIDI APIで検出した外部MIDI機器の二者択一とする。外部出力中はMIDIノート、コントロール変更、リセットおよびAll Notes Offを選択機器へ送信し、OPMとPCMは引き続きブラウザ内のミックスへ出力する。出力先の取得にはユーザー操作でWeb MIDIアクセスを要求し、利用不可のブラウザでは内蔵SoundFontを継続使用する。

## OPM／PCMの実装方針

公開されているWASM MDXPlayerは、MDX／PDX／ZIPのローカル読み込み、YM2151（OPM）およびADPCM系の可視化・再生をブラウザで実現している。このページは`https://goroman.github.io/mdx/assets/index-BZsYhho_.js`を読み込む単一のバンドルとして配信されているが、ソースリポジトリとライセンスを確認できていないため、この成果物を本サービスの依存物としてコピーまたは直接組み込むことはしない。

本実装では、MDRのヘッダー、PDX名、32本のトラック境界を`mpxadrv/src/mdr.cpp`に準拠して解析し、現在選択されたファイルがFM／PCM／MIDIのいずれを含むかを表示する。MDRはMDX互換データへ変換し、portable_mdx由来のMXDRV／X68SoundコアをWebAssembly化してOPM／PDXをブラウザ内でレンダリングする。MML入力、GS MIDI、およびCORS経由のMDR／PDX取得も同じローカル再生経路へ渡す。

webMDXのソースを確認した結果、MDX再生の基盤であるmdxminiはGPL-2.0を含み、プロジェクト自身のREADMEは基礎となるFM音源生成コードについて商用利用に作者の事前同意が必要となる可能性を説明している。そのため、ライセンスの確認なしに本サービスへ同ソースまたは成果物を組み込まない。OPM／PDXを含むMDRの完全再生は、互換性・再配布条件が確定したWebAssemblyコアを選定してから実装する。

## 取得時のデータモデル

リモート読み込みは、単一のMDR URLと任意のPDX URLを直接指定する方法、およびmpxadrvに準じたJSONカタログのURLを指定する方法の両方を提供する。いずれも`fetch`で取得し、HTTPエラー、CORS失敗、形式不正、PDX不足を別々に表示する。リモートURLおよび取得バイト列はサーバーへ送信せず、ブラウザのメモリ内のみで処理する。

## Google Drive共有リンクの扱い

Google Driveで共有を有効にしたMDR／PDX／JSONは、Driveの標準共有URLからファイルIDを抽出して、ブラウザ向けの直接ダウンロードURLへ正規化できる。ただし、共有設定は閲覧・ダウンロード権限を与えるだけで、JavaScriptの`fetch`に必要な`Access-Control-Allow-Origin`を保証しない。Google公式のDrive APIでバイト列を取得する経路は`files.get`に`alt=media`を付けた認可済みリクエストであり、共有リンクだけを静的フロントエンドから読む方式とは別物である。したがってWeb版は、公開共有リンクの正規化と実際の取得診断を提供し、CORS応答がない場合はローカル保存後のドラッグ＆ドロップ、またはCORSヘッダーを制御できる公開ストレージの利用へ安全に誘導する。Google Workspaceへのログイン連携や利用者の私有ファイルへの代理アクセスは初期版では行わない。

## 共有セッションとストレージ取得プロキシ

共有セッションは、公開MDR／PDX／SoundFont URL、ループ回数、最大書き出し秒数、出力モードなど、楽曲データそのものを含まない状態だけをURLパラメータに保存する。受信者は共有リンクを開くと同じ入力値と設定を復元できるが、ブラウザの自動再生制限に従い、再生開始は本人の操作とする。ローカルファイル、外部MIDI機器ID、GS診断ログ、SoundFontのバイト列は共有URLへ含めない。

Google DriveおよびDropboxの共有リンクは、公開取得を前提に同一アプリのサーバーから取得する。これにより受信ブラウザがストレージ側のCORS応答を直接必要としない。一方で任意URLへのプロキシはSSRFや無制限転送を生むため、許可ホストを`drive.google.com`、`drive.usercontent.google.com`、`www.dropbox.com`、`dl.dropboxusercontent.com`等に限定し、HTTPSのみ、リダイレクトごとの再検証、最大256 MB、プライベートIP・localhost拒否、認証情報・Cookie非送信、GET専用とする。Dropbox公式は共有リンクへの`dl=1`追加でダウンロードを強制できると説明している。Google Driveは共有設定とダウンロード許可が必要であり、ログイン済みの私有ファイルやダウンロード制限付きファイルをアプリが迂回することはしない。

## クレジット表記

フッターには、`Based on MADRV MUSIC CONVERTER Version 1.10 (c)1991,92 Konoa` および `Web adaptation by Awed (c)2026` を併記する。前者はmpxadrvリポジトリの起動時帰属表記に準拠し、後者は本Webサービスの実装者クレジットとして明示する。

## ループと書き出し

MADRVの無限ループは、そのままファイル出力へ渡さない。再生画面でループ回数または最大書き出し時間を明示的に指定し、書き出しは必ず有限のスコアに展開する。ブラウザではWeb Audioの出力をMediaStreamへ分岐し、Signal Deckの静止・波形ビジュアルをCanvasの映像トラックとして合成する。MP4対応のMediaRecorderが利用できる場合は音声付きMP4を保存し、対応しない環境ではWebMへのフォールバックを明示してユーザーに形式を通知する。

## 提供されたMADRV原典ソースの確認結果

`MADRVSRC.LZH`にはMADRVのアセンブリ実装（`MADRV.S`、`MAC.S`、`MAC_PLAY.S`）が、`MADRVFUNC.Lzh`にはFunction Callの補助実装（`MDXCTRL.S`、`MDXLOAD.S`、`FILESEARCH.S`等）が含まれている。`MADRV.S`のMIDI経路は、プログラム変更（`CMD_FD`）、パン（`CMD_FC`）、音量、ピッチベンド、コントロール変更をFIFO経由で送出する。リピート処理は開始位置のワークエリアを保存し、復帰時にOPM全キーオフとMIDI All Offを行ってからクロックとループカウンターを復元する。これはWeb版で「有限ループ上限を設け、ループ境界でAll Notes Offを送出する」方針の原典根拠となる。

原典のREADMEにはソース転載禁止の旨が記載されているため、公開Webアプリへ原典ソースを組み込まない。挙動確認・独立実装の参照としてのみ利用し、WebAssemblyコアは別途再配布条件が確認できる実装を選定する。

## GS SysExの根拠

Roland公式サポートは、各シーケンスの先頭でGS Resetを送ることを案内し、バイト列を`F0 41 10 42 12 40 00 7F 00 41 F7`として公開している。GS Partの受信On／Offも公式のDT1メッセージとして公開されている。Web版では、このGS ResetとPart Rx On／Offを外部Web MIDI出力へ送出し、内蔵SoundFont側にはチャンネルリセット、MIDIメッセージ、および`systemExclusive`を適用する。パッチはBank Select MSB／LSBとProgram Change、レベルはCC#7として同一Partへ送る。MDRのGS SysExはmpxadrvのスケジューラが抽出したタイミング付きバイト列を外部機器と内蔵SoundFontへ共通送出する。出典: Roland Support「PMA-5: Sending a GS Reset」および「Part Rx On/Off System Exclusive Messages for Roland GS Instruments」。

## Function CallとWeb側制御の対応

`MDXCTRL.S`のTRAP #4 Function Callは、2=再生開始、3=停止、4=再開、7=状態取得、9=フェードアウト、11=OPM割込み回数ベースの再生時計、14=フェード速度設定である。Web版では再生／停止、再生時刻表示、有限ループ上限、終了時のAll Notes Offを提供し、OPM／PDXはWeb Audioクロック、MIDI／SysExは変換済みのマイクロ秒スケジュールで同期する。ハードウェア固有のステータス応答やフェード速度の実測確認は、物理GS音源および対象MDRを接続した環境で追加検証する。

## WebAssemblyコアの帰属と配布上の注意

OPM／PDXレンダリングにはportable_mdx由来のMXDRVg／X68Soundコアを使用する。portable_mdxのREADMEは、Yosshin作成部分にApache-2.0を適用し、MXDRVg／MXDRV.X由来部分は明確なライセンス文書が存在しないため「X68的defaultのフリーソフトウェア扱い」と説明している。一方、X68Sound.dll由来部分については、改変・改変物公開・組込み・配布を自由とする使用許諾を記載している。アプリの画面クレジットではMXDRVg、X68Sound、portable_mdxを明記し、提供されたMADRV原典ソースは転載禁止の記載に従って公開バンドルへ含めない。

## 参照先

1. https://github.com/YosAwed/mpxadrv
2. https://www.wothke.ch/webMDX/
3. https://goroman.github.io/mdx/
4. https://github.com/ad-si/GeneralUser
5. https://github.com/spessasus/SpessaSynth
6. https://developers.google.com/workspace/drive/api/guides/manage-downloads
7. https://support.google.com/drive/answer/2494822
8. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
9. https://help.dropbox.com/share/force-download
