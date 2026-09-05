# Compact UI restoration (2026-09-05)

The user reported that the previously deployed folding sections and dense layout had regressed. The pre-update production HTML saved on September 5 at 08:40 references `index-ZWj3_xrU.js` / `index-DcwYrgRc.css`, different from the GitHub baseline used for the earlier deployment. The old production version was `9a0808b2-080d-4c12-86e2-0afcbf6ddeca` (September 3). No corresponding folding UI source was found in Git history, reflog, remote PRs or the bounded local project search; the old asset URLs now return the SPA fallback. This restores the requested behavior, rather than claiming an exact recovery of the unavailable old UI.

## Layout behavior to preserve

- Transport, source title, position, volume, loop count and notices remain visible at the top. The transport stays available while expanded sections scroll.
- Independent desktop columns use the available width, without the old empty engine sidebar or a source column stretched to match a tall MIDI sidebar.
- Source, SoundFont and output levels open by default. Playlist, source metadata, timing, advisor, sharing, diagnostics, SysEx, export, attribution and keyboard sections each fold independently and retain their state across reloads.
- Closed panels unmount their content, including the expensive keyboard view. Input values and playback remain in Home, so folding does not discard edits or stop sound.
- The missing-SoundFont prompt reveals and focuses the bank panel even if it was saved closed.
- Smaller screens stack the columns and scroll vertically; no horizontal page overflow. Expanded matrices have their own bounded scrolling area.
- Previous handlers and controls remain accessible, including local/folder upload, remote catalogs, MML, MIDI destination/timing, GS commands, playlists, share, export, format guide and attribution. Audio engine/scheduling changes from the preceding fixes are retained unchanged.

## Verification

Chrome on macOS, local production build with MJ_RUMI_SC.MDR + matching PDX + Roland_SC-55.sf2, 30 detected tracks:

| Viewport | Page height | Page width | Content bottom |
|---|---:|---:|---:|
| 1366 × 768 | 768 | 1366 | 718 |
| 1440 × 900 | 900 | 1440 | 718 |
| 1920 × 1080 | 1080 | 1920 | 674 |
| 960 × 740 | 974 | 960 | 974 |
| 390 × 844 | 1615 | 390 | 1615 |

The previous production initial page was 3609 px tall at 1440 × 900. The new desktop default fits without vertical scrolling; opening details intentionally expands it. This is not Windows-native verification.

Browser checks cover keyboard Enter to toggle, saved open/closed states, MML retention across folding, missing-bank reveal/focus, actual hardware audio during 30-track built-in SoundFont playback, folding while playing, matrix mount/unmount and bus view, stop, all detail sections, playlist add, remote inputs/catalog, and format guide. No uncaught page errors. 99 existing tests, application and Cloudflare type checks, production build, and diff whitespace checks pass.

Run with local assets and a Vite preview or production URL:

```sh
MDR_SOURCE=/path/to/MJ_RUMI_SC.MDR \
MDR_PDX_PATH=/path/to/MJ_RUMI_SC.pdx \
MDR_SF_PATH=/path/to/Roland_SC-55.sf2 \
MADRV_E2E_BASE_URL=http://127.0.0.1:4173 \
node scripts/verify-compact-layout.mjs
```

The script saves viewport screenshots and a JSON report under `/tmp/madrv-compact-ui` by default. Keep its desktop bounds and interaction checks when changing the layout or optimizing playback.

## Production

Deployed to https://madrv-player.madrv-player-web.workers.dev as version `8c163cbe-274f-45e1-83be-dabc07be15be`. Public index, JS (`index-CCzt_fjM.js`), CSS (`index-BjB8Ana0.css`) and lazy guide exactly match the local build. The full browser check above also passed against production, with the same viewport bounds, audible hardware output and no page errors.

The hybrid advisor check also passed after adapting its optional-panel navigation: destination switching updates the recommendation; a dense playlist entry creates a 16384-frame buffer; manual low latency still creates 2048 frames.
