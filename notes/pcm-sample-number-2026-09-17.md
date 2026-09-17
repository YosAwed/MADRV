# PCM sample identity in the activity strip

Show the zero-based PDX table index as `#000`, `#097`, etc. inside each PCM strip. PCM8 includes `bank * 96`; ordinary ADPCM ignores the PCM8 bank. Active numbers are bright; the last number remains dim between sounds. Stop/seek/preparation and source changes reset the local display latch. The numbers identify selected table entries, even when multiple entries share the same sample data address.

## Core extension

The existing raw-note getter alone cannot identify the sample: PCM8 also needs its bank, and a bank change during a held sound must not relabel that sound. `scripts/build-pcm-sample-core.mjs` checks the complete v13 SHA-256, then adds diagnostic-only locals and calls at the actual ordinary-ADPCM and PCM8 output sites in audited function 46. Eight new WASM globals latch the resolved sample index. All original audio/sequencer instructions and memory are preserved; appended globals retain the existing stack global's index. The exported `get_pcm_sample_number(voice)` reads the latch (voice 0–7, -1 before any trigger). Existing JS glue still works.

While verifying held samples, the existing mask was found to query sustained PCM8 voices 1–7 but omit voice 0, reporting that voice only on its key-on edge. The new read-only `get_pcm_activity_mask` wraps the original mask and also checks voice 0's decoder activity. The original export is preserved. No decoder or audio timing state is changed. The UI engine uses the new export when available and reports sample numbers separately from the existing activity callback, deduplicating unchanged snapshots.

Rebuild with WABT 1.0.39: `WABT_BIN=/path/to/wabt/bin node scripts/build-pcm-sample-core.mjs`. Output is `madrv-mdx-player-v14_09c287f0.wasm`, SHA-256 `09c287f0373a3edcad9181bbc26ca2526c644c1c1a7003c508865761eb8cf8da`; a repeat build reproduced it. The same version-pinned layout constraint as the v13 patch applies: a new base core requires re-auditing.

## Validation

- `verify-pcm-sample-core.mjs`: generated ordinary ADPCM plus every PCM8 voice, banks 0/1/2, sample indices 0/1/95/97/287, a bank change while a tied sample continues, muted notes, and combined OPM/PCM. Rendered audio is bit-identical to v13 in every comparison. The held PCM8 voice 0 activity correction is covered.
- `verify-pcm-unmute.mjs`: the earlier v13 stale-key-on fix still passes all nine modes/channels against the previous core.
- Full 219-test suite passed; the subsequently added PCM publication/reset test passed with the complete 13-test telemetry file. Both TypeScript checks and the production build passed (existing chunk warning).
- Chromium and WebKit passed the generated PCM8 browser check: banks 0–7 including aliased sample data, retained last number, mute/solo, stop, seek, live source selection and 20 viewport/playlist/settings layouts. A generated MDR routed source slots 24–31 to PCM voices 1–8 and displayed the corresponding numbers correctly. No page errors. Screenshots inspected.

This extends the existing staging-only PCM activity prototype. Production remains unchanged.

## Staging deployment

- Deployed clean source `9b11549cc273` on `codex/pcm-activity-strip` to `https://madrv-player-staging.madrv-player-web.workers.dev/`.
- Cloudflare version: `93f0785e-7e7e-419d-964f-1e5777c79c03`.
- Public staging passed the generated-fixture Chromium browser check: all eight PCM sample numbers, routed MDR sources, 20 layout combinations, mute/solo, seek, stop and source replacement, with no page errors.
- `build-info.json` confirmed the clean source revision. The production page still references `index-TksT0Ud1.css`; no production deployment was performed.

## Production release after user acceptance

On 2026-09-17, the user accepted staging and requested production release. Fast-forwarded `main` from `7732316` to `30dfc380b1e4` and pushed it to GitHub, then built and deployed the production configuration.

- URL: `https://madrv-player.madrv-player-web.workers.dev/`
- Worker version: `e58bb416-cd72-4ee0-8b71-a1c358a3a3b6`
- Production assets: `index-B5FNQP1n.js`, `index-CVLkMJ_n.css`; fetched v14 WASM matched the verified SHA-256 above.
- Public production passed the synthetic-fixture Chromium check: eight PCM voices and sample numbers, routed MDR source slots, 20 layout combinations, mute/solo, seek, stop and source changes; no page errors.
- Build succeeded with the existing chunk-size warning. No code changes were made after the staging acceptance. Prior production Worker version for rollback: `82a5c7bf-dcce-4e8d-8308-d42ab4f4d600`.
