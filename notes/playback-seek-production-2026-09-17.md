# Playback seek production release — 2026-09-17

The user confirmed the touch fix on their physical iPhone, then explicitly requested integration into main and production deployment.

## Source and deployment

- Fetched origin and confirmed no newer main/development commits were missing locally.
- Fast-forwarded main from `f948a78` to tested development revision `9968b649c962e239589480b7ea0a0816d0365427` and pushed origin/main. The source tree exactly matched codex/playback-seek.
- Built the production-mode Cloudflare assets from main. Build passed with the existing chunk-size warning, and rebuilding the SoundFont worklet produced no source changes.
- Deployed with the explicit production configuration `wrangler.jsonc`, empty Wrangler environment and existing account `349436871b6d236eb4ede3c2c625770f`.
- Production Worker: `madrv-player`.
- URL: https://madrv-player.madrv-player-web.workers.dev/
- New Cloudflare version: `40c1c6ef-e7b6-445c-8f73-cc1503e459c4`.
- Previous version, recorded before deployment: `f6e5768a-10ac-444b-9ee7-264362fff9e9`.
- No staging deployment was made during this release.

The unchanged source had already passed 216 tests, both TypeScript checks, waveform checks, Chromium/WebKit audio and touch regressions, staging smoke checks, and the user's iPhone retest. See the follow-up and touch notes for scope and remaining seek limitations.

## Production verification

HTTP 200 responses for index.html, the main JavaScript, CSS, v13 player WASM and SoundFont worklet matched the local production build byte for byte. No staging noindex header was present on those responses. Main JavaScript SHA-256: `7bb86104e154bb76e34ec89624cd90fd4972167b35db7494885a0f6a64b173a6`.

A fresh browser context at the production URL had no staging banner. The mobile touch smoke test used only generated original 163-byte MDX (no user song or SoundFont files):

- Duration: 24.035 seconds.
- First tap: 12.0976 seconds.
- Second tap: 6.0488 seconds.
- ArrowLeft: 1.0488 seconds.
- End: READY at the final position.
- No uncaught page errors.

This file is a documentation-only record added after deployment; the deployed source revision is recorded above.
