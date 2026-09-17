# PCM pads with fixed-position sample number and PAN

Replace the PCM history UI with persistent pads grouped in one PCM bank in both matrix modes. Ordinary MDX shows one pad; PCM8 shows eight, including idle voices. Wide panels show eight columns; panels up to 650 px show four columns (two rows for PCM8). Each pad retains M/S controls; when several MDR source tracks share a hardware voice, its controls act on the group.

The user confirmed left `>10`, center `>10<`, right `10<`. Numbers are decimal, zero-based including PCM8 bank offsets. A native monospace font, tabular figures, right alignment and a fixed five-character number box keep each digit position stable. Both PAN marker slots retain their width when hidden. Idle/muted pads show a dash and remain in place; active pads light up. There is no activity-history animation in this UI.

## PAN telemetry

`build-pcm-pan-core.mjs` verifies the full v14 hash and appends diagnostic-only PAN globals/functions to the existing WASM. Audited function 46 captures the actual final ADPCMOUT/PCM8_SUB mode at sample trigger: low bits 1=left, 2=right, 3=both, 0=neither. This follows the actual output mode rather than relabeling a held sample when a later score command changes the next note's PAN. Existing audio code and memory are preserved; numeric function/global indices are retained. Export `get_pcm_pan(voice)` is read with sample identities in each existing 2048-frame visual slice and queued for the corresponding audio time. Mute/solo/stop/seek invalidate buffered PAN together with the other PCM state.

Rebuild with WABT 1.0.39 via `WABT_BIN=/path/to/wabt/bin node scripts/build-pcm-pan-core.mjs`. Artifact `madrv-mdx-player-v15_6c603674.wasm`, SHA-256 `6c603674d2119458d8badcaf71716db25656249a8f8fa5cea68a881d71280438`; a repeat build reproduced it.

## Validation

- 36 core cases: ordinary ADPCM and all eight PCM8 voices, each PAN setting, subsequent PAN command while a tied sample is held. Getter matches the nonzero left/right output channels; every output sample is bit-identical to v14. Prior stale-key-on/unmute regression passes all nine channel/mode cases against the v15 engine URL.
- Full 223 tests passed. The subsequently extended PCM queued-snapshot test, now also checking PAN and mute invalidation, passed with the complete 55-test playback file. Both TypeScript checks and production build passed (existing chunk-size warning).
- `verify-pcm-pads.mjs` supersedes the old history-oriented UI checks. Generated synthetic files only: ordinary MDX, eight-bank PCM8, MDR routed source slots 24–31, both matrix modes, idle/stop pad persistence, sample/PAN values, M/S, seek, and 20 width/playlist/settings layouts. Fixed number-box coordinates are checked across timed active/inactive and digit-count transitions. Chromium and WebKit passed; mobile and desktop screenshots inspected. Physical Android confirmation remains with the user.

This is a new development branch `codex/pcm-pan-pads`; production remains on the previously verified ordinary-MDX history fix until release is requested.

## Staging deployment

Clean source `d5f8e3b82ea7` deployed to `https://madrv-player-staging.madrv-player-web.workers.dev/` as version `fb547537-ba75-4635-b721-83a171d07721`. Public Chromium and final local WebKit checks passed all pad/PAN/fixed-number/layout and playback cases after the grouped-control adjustment. Production still serves `index-CVWpVxLs.js`. Main remains unchanged.
