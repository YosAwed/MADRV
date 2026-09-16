# PCM unmute: discard stale pending key-ons

The v12 renderer reproduces a delayed sample trigger when a PCM channel is unmuted during a note which began while muted. MXDRV's channel mask skips the hardware update (`L000c66`), leaving the track's `S0016` pending-key-on bit set. Removing the mask sends that old note to the PCM player on the next render tick. This is a queued key-on, not an audio buffer being replayed.

A generated MDX/PDX fixture has two short sample triggers at 0.013333s and 2.765333s. Muting the first and unmuting at 0.501333s makes v12 play at 0.501333s and 2.765333s. v13 stays silent until the second, correctly timed trigger.

## Change and rebuild

`client/wasm/pcm-unmute-channel-mask.wat` replaces only the exported channel-mask setter. For raw PCM channels 8–15 transitioning from muted to audible, it clears pending-key-on bit 0. It preserves the cursor, duration, key-off/tie flags, PCM decoder, OPM channels, all other functions and the export ABI.

The original build sources are not in this repository. The reproducible surgical rebuild therefore starts from the checked-in v12 WASM, verifies its complete SHA-256, replaces function 148, and emits a new content-addressed v13 asset. The WAT records the audited v12 wasm32 layout; a new base core requires a fresh audit. Existing v12 JavaScript glue is retained because the ABI is unchanged. Both current MDR and MDX playback use `MadrvWasmPlayer` and the new binary.

With WABT 1.0.39's `wasm2wat` and `wat2wasm` installed:

```sh
WABT_BIN=/path/to/wabt/bin node scripts/build-pcm-unmute-core.mjs
node scripts/verify-pcm-unmute.mjs
```

Upstream state-machine reference: [portable_mdx mxdrv.cpp](https://github.com/yosshin4004/portable_mdx/blob/master/src/mxdrv/mxdrv.cpp), specifically the channel-mask check before `L000c66`, `L000cbe` and note parsing in `L0011b4`. No upstream source body is redistributed by this patch.

## Validation

The deterministic regression runs actual old/new WASM, using generated original MDX and ADPCM data, and checks audio samples as well as PCM activity. It covers standard ADPCM and every PCM8 voice, repeated mute/unmute, unrelated OPM mask changes, absence of delayed sound, and the next genuine note's timing and audibility. Unmuted waveforms are bit-identical before/after in all nine fixtures.

TypeScript checks (app and Cloudflare) and the Cloudflare production build pass. Existing engine and telemetry tests also pass.

The unused `startMadrvWorklet` path was inspected but is not covered by an end-to-end worklet test: its existing bundled glue is from an older ABI and already fails initialization with the v12 converter/player. Current MDR/MDX playback uses the main-thread renderer; this unrelated dormant path is unchanged.
