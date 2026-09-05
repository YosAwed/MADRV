# サンプル再生確認（2026-09-05）

対象: MDRSAMPLEのMDR 19曲。wfang.pdx不足のEX_WFANG4_SC.MDRはユーザー指定により対象外。残り18曲を変更前・変更後で確認。

Chrome headless、付属Roland_SC-55.sf2使用。再生開始から音声を検知した後12秒を観測し、停止を確認。曲末・ループ・外部MIDI・全パートの音色一致は未確認。MML/MUSは元ソースとして扱い、ブラウザの簡易MMLでコンパイルしていない。

| 曲 | 改善版の音声 | 再生経路 | 変更前と経路一致 |
|---|---|---|---|
| BELL20_SC.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| BOMB.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| CLI01_SC.MDR | あり | MIDIフォールバック | 一致 |
| CLI15_SC.MDR | あり | MIDIフォールバック | 一致 |
| CLI19SC_.MDR | あり | MIDIフォールバック | 一致 |
| CLI19_SC.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| CONTROL.MDR | あり | GS MIDI | 一致 |
| DQ29A_SC.MDR | あり | MIDIフォールバック | 一致 |
| D_Re_EDGS.MDR | あり | MIDIフォールバック | 一致 |
| ED1_SC_ぜくせくす.MDR | あり | MIDIフォールバック | 一致 |
| ED1_SC_ぜくせくす2.MDR | あり | MIDIフォールバック | 一致 |
| LCM_GS.MDR | あり | GS MIDI | 一致 |
| MJ_RUMI_SC.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| PHELD_SC_.MDR | あり | MIDIフォールバック | 一致 |
| PRIN_GS.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| SDI_ENDING.MDR | あり | GS MIDI | 一致 |
| SOUL_GS.MDR | あり | OPM + MIDI（PDXは指定曲のみ） | 一致 |
| V9_SC.MDR | あり | MIDIフォールバック | 一致 |

18曲すべてで音声出力あり、ページ例外なし。6曲はOPMを含む経路、3曲はMIDI専用、9曲は既存のMIDIフォールバック。フォールバック9曲はOPMを含む完全再生が確認できた意味ではない。今回の変更前でも同じ経路だった。

改善版の最初の走査では全曲にMJ_RUMI_SC.pdxを添付したため、EX_WFANG4_SC.MDRの測定は無効として除外した。その他の対象曲でPDX名指定があるのはMJ_RUMI_SC.MDRのみで、対応PDXは一致。テストスクリプトは必要PDXの照合と不足時スキップへ修正済み。波形の厳密比較や速度比較にはこの走査を使わない。

本番デプロイは実行承認が拒否されたため未実施。
