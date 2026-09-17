# Touch seek release ordering, 2026-09-17

## Report and reproduction

The user reported on iPhone Chrome that the first tap moved the seek marker but left the music playing at its previous position; a second tap then sought to the first tap's position. Both MDX and MDR with internal SoundFont were affected. Main merge remains on hold pending the user's device retest.

The shared PlaybackPosition control previously stored a native range input's onChange value in a draft, then committed that draft on pointerup. It therefore assumed the input notification preceded pointerup. Delaying that notification until after pointerup in a real WebKit touch test reproduced the exact one-operation lag: the first tap made zero seek calls, and the second committed the first tap's target (46.5349 seconds). This is evidence of the event-order dependency, not a captured event trace from the user's iPhone. Normal touch in the installed desktop WebKit build did not reproduce the issue without the delayed notification.

The earlier full-page mobile viewport test used mouse dragging, so it missed this touch-specific path.

## Fix

Pointer input now belongs to the visible track and its existing 34 px hit area. The native range remains available for keyboard and accessibility semantics but does not receive pointer hit tests. On release the track calculates the target from that release's coordinates; it no longer commits a potentially stale native-input draft. Pointer capture keeps drags working when the finger leaves the track, values are clamped to its endpoints, and pointer cancellation/lost capture discard the draft. Touch-action is disabled only on the usable track so the browser does not take over a seek gesture for scrolling. Keyboard navigation and the existing serialized seek queue are retained.

This change is shared by MDX and MDR and does not change the audio renderer, SoundFont restoration, or MIDI scheduler.

## Verification

- 216 Vitest tests / 18 files passed; app and Cloudflare TypeScript checks passed.
- Cloudflare build passed with the existing chunk-size warning.
- New `scripts/verify-playback-position-touch.mjs`: actual touchscreen taps in Chromium and WebKit, with normal and deferred native input notifications. First/second taps, drag-only preview, one release commit, captured release outside the bounds, cancellation, Home/End/arrows and disabled behavior passed without page errors. Chromium additionally passed actual touch drag/touchCancel via its browser protocol.
- Full app with local fixtures and real AudioContext: WebKit MDX (HECTOR87 + PDX), WebKit hybrid MDR (song.mdr + sample.pdx + GeneralUser-GS.sf2), and Chromium hybrid MDR passed. Real first and second touchscreen taps each caused one engine seek and the expected position. Existing drag, rapid keyboard queue, Home/End, natural completion and STOP cancellation checks also passed. No page errors.
- The full-app browser script now optionally accepts a SoundFont and WebKit selection, and its mobile mode uses touchscreen taps before the existing transport checks.
- Public staging smoke now uses touchscreen taps with generated original MDX only; no local song/SoundFont files are sent to the public origin.

Example local regression commands (WebKit downloaded into a temporary browser cache):

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/madrv-playwright node scripts/verify-playback-position-touch.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/madrv-playwright MADRV_BROWSER=webkit MADRV_MOBILE=1 node scripts/verify-playback-seek-browser.mjs /path/to/song.mdr /path/to/bank.pdx /path/to/bank.sf2
```

Desktop WebKit automation does not replace a retest on the user's physical iPhone.

## Staging deployment

Implementation `e21b5a3e2189` was pushed to `origin/codex/playback-seek` and deployed as a clean staging build. Cloudflare staging version: `c44d47b5-9446-4d44-a039-c3ac8e53d4c0`.

The public mobile touch smoke test displayed the expected revision and passed: generated MDX duration 24.035 s, first tap to 12.0976 s, second tap to 6.0488 s, ArrowLeft to 1.0488 s, End to READY; no page errors. Production deployment histories captured immediately before and after were identical. No main merge or production deployment was performed.
