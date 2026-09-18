# PCM PAD: decay while sounding

Branch: `codex/pcm-pad-decay`.

Each actual PCM key-on immediately restores the bright PAD, then fades to a still-visible olive background over 1,800 ms. Note-off fades from its current displayed color to the existing idle appearance in 300 ms. Sample number/PAN remain centered and retained after release; stop/mute clears immediately. Browser-managed animations avoid per-frame React state changes and JS animation timers. M/S controls keep their own background.

A readonly per-voice key-on counter is exported by v16 WASM and captured alongside sample/PAN in the existing 2,048-frame audio-clock visual queue. It increments at the existing sample latch after actual ADPCM/PCM8 output triggers, including consecutive identical samples. This avoids inferring attacks from sample-number or activity-mask changes. Only independent diagnostic globals are added; the renderer's audio and sequencer memory remain untouched. Counters are compared as unsigned values; source/stop/seek/mute generation handling uses the existing visual cancellation path.

Build: `WABT_BIN=/tmp/madrv-wasm-inspect/node_modules/wabt/bin node scripts/build-pcm-trigger-core.mjs` (WABT 1.0.39).
WASM: `madrv-mdx-player-v16_865de60b.wasm`, SHA-256 `865de60b706d5b3287ec9bba8736f2bfc249d6f892e164e95d69493fa6902ad7`.

Validation:
- `verify-pcm-trigger-core.mjs`: 36 ordinary/PCM8 voice/PAN cases, three consecutive identical notes counted exactly once each, other voices unchanged; every rendered audio sample bit-identical to v15.
- `verify-pcm-pad-decay.mjs`: Chrome + WebKit, mobile viewport; held-note decay, same-note retrigger with no observed inactive gap, 300 ms release, retained number and immediate stop cancellation; both ordinary PCM and PCM8.
- `verify-pcm-pads.mjs`: Chrome + WebKit regression passed (ordinary/PCM8/routed MDR, PAN, centered digits, release, mute/solo/seek, 20 layout combinations).
- 223 tests / 19 files; normal and Cloudflare TypeScript checks; Cloudflare build passed (existing chunk-size warning).

Generated fixtures only. No actual phone performance measurement. Production is not changed by this branch.
