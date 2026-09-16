# Development seek follow-up, 2026-09-17

## Integration and changes

Merged `main` at `f948a78` into the published `codex/playback-seek` branch with merge commit `1ace95e`. The three shared files merged without textual conflicts. This includes the keyboard note-label layout fix and v13 PCM unmute fix; main itself was not modified.

- New MDX playback explicitly clears track mutes in the engine, matching the original behavior. Only seeking preserves the current mute state, including a seek back to zero. This no longer relies on Home clearing mutes on song selection.
- MDR two-pass playback reuses its already measured total when calculating the hardware repeat period, as MDX does. Measurements still finish before starting the renderer.
- The position control stays usable during a seek. Requests are serialized; while one rebuild is running, the latest requested destination replaces any waiting destination. Arrow steps accumulate against the requested position. STOP and source transitions invalidate both the running preparation and its queue through the existing source generation.
- Updated the waveform comparison script to use the v13 core now used by playback.

The seek implementation still renders from the start, so its cost grows with the absolute target position. SoundFont seek restores settings, not sustained voices or reverb history. External MIDI seek remains unavailable.

## Local validation

- Vitest: 216 tests / 18 files passed, including new engine tests for new-playback mute reset and reuse of two-pass measurements for MDX/MDR. Existing tests still verify mute preservation on seeking to zero, cancellation, finite endings and MIDI restoration.
- App and Cloudflare TypeScript checks passed. Cloudflare build passed with the existing chunk-size warning.
- PCM unmute regression passed for standard ADPCM and all eight PCM8 channels against the actual v12/v13 cores.
- Actual v13 WASM seek versus uninterrupted rendering: 8,192 identical samples at each of six positions across one- and two-pass HECTOR87 playback (48 kHz). Silent advancement took 10–962 ms for targets from 1.30 to 112.49 seconds on this machine.
- Local browser UI, desktop and mobile viewport: drag commits once, backward/Home/End work, rapid arrows accumulate 15 seconds with only the active and latest queued rebuild, STOP discards a queued request, no page errors.
- Local actual AudioContext/SoundFont tests, desktop and mobile buffer profiles: hybrid `song.mdr` + `sample.pdx` and GS-only `BIN_M_GS.MDR` passed. MIDI notes continued after seeking and after +500 ms to 0 ms correction changes; SoundFont replacement stayed blocked during preparation; looping and final completion passed. No page errors. Hybrid preparation took 140–162 ms and GS-only preparation 7–11 ms.

Local music and SoundFont fixtures were used only on localhost. Public staging smoke tests use generated original MDX notes.

## Deployment safeguards

The staging account ID remains as a destination identifier and deployment guard, not an authentication secret. `robots.txt` is a crawler instruction, not access control. HTTP `X-Robots-Tag` must be checked separately to confirm the noindex response header. The staging site remains publicly accessible.

The pre-deployment production history reports latest version `f6e5768a-10ac-444b-9ee7-264362fff9e9`, uploaded at `2026-09-16T07:12:34.352Z`. This is the baseline for this follow-up, superseding earlier notes' production baseline.

The quarantined `_to_delete/` directory was retained and excluded using local `.git/info/exclude`; none of its contents were committed.

## Staging verification

- Pushed implementation revision `a630bcdb2e95` to `origin/codex/playback-seek` and deployed its clean build to `madrv-player-staging`.
- Cloudflare staging version: `d4afa3b0-3c59-4991-a7f9-fb1f47235ff6`.
- Public `build-info.json` returned HTTP 200 and the expected revision with `dirty: false`. `/`, `/robots.txt` and `/build-info.json` all returned `X-Robots-Tag: noindex, nofollow, noarchive`; robots.txt also contains `Disallow: /`.
- Public browser smoke test used generated 163-byte MDX only: duration 24.035 s, click to 12.0175 s, ArrowLeft to 7.0175 s, End to READY; no page errors.
- Production deployment history before and after staging deployment was identical, including latest version `f6e5768a-10ac-444b-9ee7-264362fff9e9`. No production deployment was performed.

This deployment record is a documentation-only commit after the deployed implementation revision.
