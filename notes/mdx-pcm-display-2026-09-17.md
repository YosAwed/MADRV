# Ordinary MDX PCM rows and mobile activity gaps

User reported that non-PCM8 MDX (e.g. BOS15.MDX) showed eight PCM rows and an uninterrupted activity bar. They clarified that sample numbers do change. BOS15.MDX was not available locally; reproduction used an original synthetic nine-track MDX with short alternating ADPCM hits and rests.

## Reproduction

`MADRV_DIAGNOSE=1 MADRV_E2E_BASE_URL=https://madrv-player.madrv-player-web.workers.dev node scripts/verify-adpcm-display.mjs` on the previous production release produced 8 PCM rows, 1 activity range, 1 ON transition and 0 OFF transitions over five seconds. That fixture's end-of-buffer snapshot also happened to alias its alternating sample numbers. This is independent of Android CSS: the mobile profile renders 16384 frames per callback but previously published PCM state only at the end of each callback.

## Fix

- Build MDX mixer rows from the source's bounded offset table: ordinary nine-track MDX gets one PCM row; a valid sixteen-track table retains eight. Do not search raw bytes for E8 because arguments may contain that byte. Local selection, later PDX attachment, remote selection and playlist selection all use the helper.
- Capture PCM activity and resolved sample numbers in the existing 2048-frame internal render slices. Deliver immutable snapshots alongside OPM keyboard snapshots on the audio playback clock. A future snapshot must not read the player's newer sample state when it is delivered.
- PCM snapshots are invalidated by mute/solo changes, including unmute. Stop/seek already clear the shared visual queue and playback generation.
- The WASM binary, mixer, outer audio-buffer size and audio clock remain unchanged. The strip continues to show activity, so uninterrupted sounds still form an uninterrupted range; this is not a waveform or a separate marker for every sample trigger. Resolution remains about 43 ms at 48 kHz.

## Validation

- All 223 tests in 19 files passed; both TypeScript checks passed. A stronger buffered-hit mute regression subsequently passed with the complete 55-test playback file. Production build passed with the existing chunk-size warning.
- Chromium and WebKit with mobile viewport/touch/display scale: one PCM row, both sample numbers, approximately 30 ON/OFF transitions over five seconds, and 23 separate ranges in the rolling four-second history. Stop clears the history. Generated files only.
- Existing PCM8/MDR Chromium and WebKit checks passed: eight banked sample identities, routed MDR source slots, 20 layout combinations, mute/solo, seek, stop and source replacement. No browser page errors.
- Android hardware and the user's BOS15.MDX remain to be checked on staging. No production deployment for this follow-up fix.

## Staging deployment

Clean source `022d528d7fd7` on `codex/mdx-pcm-display` deployed to `https://madrv-player-staging.madrv-player-web.workers.dev/` as version `b24974cf-5fe5-4280-93cd-8d96c571c17b`. Public Chromium checks passed for ordinary ADPCM (one row, 30 ON/OFF transitions, 24 separate history ranges) and the full PCM8/routed-MDR check. Inspected the ordinary ADPCM screenshot. Build metadata matched the source and production still served `index-B5FNQP1n.js`.
