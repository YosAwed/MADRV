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

Generated fixtures only. No actual phone performance measurement. The initial validation above was performed before production deployment.

Staging deployment: source `e37d941be068` (clean), Worker `madrv-player-staging`, version `5150e502-2193-4c54-8f08-6818956b2f3e`. Public `build-info.json` confirms the branch/revision. At that staging checkpoint, main and the production Worker were unchanged.
The generated-fixture decay/retrigger/release/stop browser check also passed on the deployed staging URL for ordinary PCM and PCM8.


## Production release

Following explicit user approval, main was fast-forwarded to `752a455` and pushed. The production build passed and Cloudflare Worker `madrv-player` was deployed as version `4ca2690c-549d-4839-9a4f-8fb19630c9b9` (previous version `a3a583ff-20ca-4043-ad50-55e76b093ee3`).

Public HTML, JS `index-Pcx2Vs9Z.js`, CSS `index-BPvtbby2.css`, and v16 WASM matched the local production build byte for byte. The generated-fixture Chrome check at the production URL passed for ordinary PCM and PCM8: held-note decay, same-note retrigger without an inactive gap, 300 ms release, retained sample number and immediate stop cancellation. No browser errors were reported. No user music files were used.
