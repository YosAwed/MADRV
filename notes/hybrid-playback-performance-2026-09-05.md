# Full hybrid playback load (2026-09-05)

Reported symptom: tempo slows and some tracks start late when OPM, PCM and built-in SoundFont MIDI play together on some PCs. The affected PC/browser/song was not specified.

## Findings and changes

- OPM/PCM still uses the existing single main-thread ScriptProcessor renderer. Dense React updates compete with its 2048-frame / 42.7 ms desktop callback budget.
- Every MIDI message previously republished and cloned every track's key arrays, including pitch bends, controllers and setup messages. Ignore messages that do not change keys, coalesce key publication at the existing visual cadence, and retain unchanged track arrays so memoized keyboards can skip rendering. A trailing timer publishes the final note-off even in MIDI-only playback. Stop, mute and listener changes publish immediately and cancel pending work.
- Hardware polling previously scanned all 32 source slots and erased held MIDI keys where the hardware WASM returns -1. Poll only the source tracks assigned to OPM/PCM. A direct Welcome Racer WASM check confirmed hardware notes at source slot 3 and no hardware notes in MIDI slots 16–18. MDX retains its physical 0–15 scan.
- The load advisor's small byte-scan benchmark does not measure sustained synthesis load. A small score with at least 24 combined tracks, including at least 8 hardware and 8 MIDI tracks, now recommends stable playback when the selected destination is built-in SoundFont. This is a conservative workload rule, not a measured CPU-speed estimate. Stable uses the existing 16384-frame buffer and reduced visual update cadence; the longer response latency is explained in the advisor. Manual low-latency selection remains available.
- MIDI message order/timing, SoundFont synthesis quality, polyphony, effects, sample rate and hardware render code are unchanged.
- Destination changes recalculate the advisor from the stored load probe. Both ordinary playback and playlist starts check the actual source synchronously before selecting the audio buffer, so a previous song's profile cannot bypass the dense-track safeguard. Manual presets are respected.

## Browser measurements

Chrome headless on this Mac, production builds, 1440×1000 viewport with all-track keyboards, MJ_RUMI_SC.MDR + its matching PDX, local Roland_SC-55.sf2. The score reports 15 OPM/PCM and 15 MIDI tracks. Each comparison observes 15 seconds after a 3-second warmup. Baseline is commit 867f5c0. CPU throttling is Chrome CDP main-thread throttling: it does not emulate a slower audio thread or a specific physical PC. Callback gaps are scheduling-pressure measurements, not recordings of physical output dropouts or measurements of every track's acoustic onset.

| Condition | Callback gap p95 | Max gap | Gaps > 1.8× buffer budget | DOM mutations | Long tasks |
|---|---:|---:|---:|---:|---:|
| Baseline, 6×, manual low latency | 45.4 ms | 53.4 ms | 0 | 65,725 | 0 |
| Updated, 6×, manual low latency | 45.1 ms | 48.3 ms | 0 | 55,359 | 0 |
| Baseline, 20×, manual low latency | 65.6 ms | 166.8 ms | 3 | 19,562 | 3 |
| Updated, 20×, manual low latency | 68.6 ms | 95.0 ms | 3 | 14,208 | 1 |

Single-run results show reduced UI work, but do not show that telemetry changes alone eliminate late callbacks under severe throttling. The stable-profile check below evaluates the larger buffer. DOM mutation counts at different throttle rates are not directly comparable because delayed/coalesced updates change their count. Sparse OPM/PCM output peak was nonzero in all four runs, with no uncaught page errors. Console callback warnings also include activity around the observation window; use the measured callback-gap count in the table for comparison.

With updated automatic stable selection at 20×, a 90-second run produced 264 callbacks at a 341.3 ms buffer budget; gap p95 367.5 ms, maximum 389.7 ms, no gaps exceeding 1.8× budget, no callback warnings or page errors. Render p95 was 73.6 ms. The larger render blocks themselves exceed the browser's 50 ms long-task threshold, so its 262 long tasks are not evidence of missed 341 ms audio deadlines. This does not guarantee zero audible latency or eliminate limitations of a main-thread renderer on every PC.

## Regression checks

- 99 tests passed across 9 files, including 12 telemetry tests and the dense-hybrid recommendation case. Application and Cloudflare TypeScript checks and production build passed.
- Real browser advisor test: switch SoundFont → mocked external MIDI → SoundFont, retain the correct recommendation; load a lighter source then start the dense playlist entry, assert an actual 16384-frame processor; select manual low latency and replay, assert 2048 frames. The mock checks destination selection only, not a physical MIDI device.
- Welcome Racer portamento, stable profile + 4× CPU throttling: pitch returned to 8192 at 6, 19 and 32 seconds.
- Stable-profile infinite playback of MJ_RUMI_SC and PRIN_GS crossed two actual L boundaries each. Separate OPM/PCM and MIDI output probes remained nonzero, with MIDI note-ons after each boundary, no early termination and no page errors. Observed 123.7 and 171.3 seconds respectively.

Reproduce using local assets (PDX and SoundFont are not bundled into this repository):

```sh
MDR_SOURCE=/path/to/MJ_RUMI_SC.MDR \
MDR_PDX_PATH=/path/to/MJ_RUMI_SC.pdx \
MDR_SF_PATH=/path/to/Roland_SC-55.sf2 \
CPU_THROTTLE=20 PLAYBACK_PRESET=auto DURATION_MS=90000 \
HYBRID_REPORT=/tmp/hybrid-playback.json \
node scripts/measure-hybrid-playback.mjs dist/public
```

## Deployment

Deployed to https://madrv-player.madrv-player-web.workers.dev, version `be9071f7-5ec7-4a4a-8853-7e89f334a7a0`. Public index, main JS (`index-DOwqy8KK.js`) and lazy guide all returned HTTP 200 and exactly matched the local production build.

Production UI smoke: the 30-track score + matching PDX + built-in SoundFont selected automatic stable playback and created the 16384-frame buffer. At 4× throttling over 6 seconds, output was nonzero, max callback gap 343.3 ms versus a 341.3 ms budget, no callback warnings or page errors, and stop worked.
