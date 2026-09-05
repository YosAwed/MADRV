# Performance improvements (2026-09-05)

Baseline: GitHub main at e8e608d. Production was not changed: deployment execution approval was rejected.

## Changes

- Fetch remote score and optional PDX concurrently, including cloud-share proxy requests. Previously the PDX request waited for the entire score response.
- Download and initialize the converter and player WASM modules concurrently on first MDR playback. Reuse existing module instances on subsequent loads.
- Load FormatGuideDialog and its UI dependencies when opened. Initial main JS decreases from 626.34 KB / 190.40 KB gzip to 587.37 KB / 177.67 KB gzip (6.2% / 6.7%). SoundFont synth remains a separate dynamic chunk.
- Memoize active tracks and per-engine groups. Stable active-track props allow the existing memoized ChannelNoteState to skip renders when only unrelated playback state changes.

## Validation

- 79 tests passed across 7 files; TypeScript application and Cloudflare checks passed; production build passed; git diff --check passed.
- Chrome headless with 4x CPU throttling, local baseline and improved production builds: format guide loaded; BOMB.MDR playback produced nonzero OPM output; stop worked; no uncaught page errors. Both builds produced peak 0.054931640625 over the first 8192 observed output frames. This confirms output presence, not full-song bit equivalence or external MIDI timing.
- Converter/player WASM requests started 42.7 ms apart before, 1.2 ms apart after, confirming concurrent startup. This is a single local run, not a general speedup percentage.
- Browser FCP varied (772 ms vs 432 ms); remote default SoundFont startup is asynchronous, so do not treat these single-run figures as a controlled production latency benchmark.
- Remote source/PDX parallelization was reviewed and typechecked; Google Drive/Dropbox credentials and real PDX pairs were not tested.

Reproduce browser checks with an available OPM MDR fixture (hybrid MIDI tracks need the default online SoundFont):

```sh
MDR_OPM_SOURCE=/path/to/song.mdr node scripts/verify-performance.mjs /path/to/baseline/public dist/public
```

## Deployment

Cloudflare authentication and existing madrv-player deployment history were readable. Prior latest deployment: 9a0808b2-080d-4c12-86e2-0afcbf6ddeca. A separate direct API subdomain lookup failed, so that lookup did not verify the account's workers.dev subdomain.

The requested wrangler deploy command was rejected at execution approval and did not run. No production success is claimed. Before resuming deployment, confirm the target remains https://madrv-player.madrv-player-web.workers.dev and verify the deployed assets afterwards.
