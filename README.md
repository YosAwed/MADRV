# MADRV Player — Signal Deck

Browser-based player for **MDR / MDX / PDX** and **MML** on the X68000 sound stack: **OPM (YM2151)**, **PCM (PDX)**, and **GS MIDI** (SoundFont or external MIDI).

Production demo: https://madrv-player.madrv-player-web.workers.dev

## Features

- **Local & remote sources** — drag-and-drop MDR/MDX/PDX, CORS URLs, Google Drive / Dropbox share links
- **MML editor** — compile and play `@OPM` / `@PCM` / `@MIDI` scores in the browser
- **32-track MDR mixer** — per-track mute/solo, live keyboard (OPM/MIDI), PCM pad activity
- **GS MIDI** — built-in SoundFont synth (SpessaSynth) or Web MIDI API output
- **Playback tools** — loop cap, session share links, MP4 export (MML), playback advisor for mobile
- **Cloudflare Workers** deployment with static assets and session API

## Tech stack

| Layer | Stack |
|---|---|
| UI | React 19, Vite 7, Tailwind CSS 4 |
| Server (dev / optional) | Node, tRPC, Drizzle |
| Production | Cloudflare Workers + Assets + Durable Objects |
| Audio cores | WebAssembly (MXDRV / MADRV converter), AudioWorklet, ScriptProcessor fallback |
| Tests | Vitest, Playwright (scripts) |

## Quick start

```bash
pnpm install
pnpm dev          # local dev server (http://127.0.0.1:3000)
pnpm test         # unit tests
pnpm build:cloudflare
pnpm deploy:cloudflare   # requires Cloudflare Wrangler auth
```

### GS MIDI playback

MDR/MDX scores with GS MIDI tracks need either:

1. **SoundFont bank** — load a local SF2/DLS or a CORS-enabled remote URL, or  
2. **External MIDI** — select a Web MIDI output device

## Project layout

```
client/          React UI and playback engine (madrvEngine.ts)
server/          Dev server, tRPC, remote asset proxy
cloudflare/      Workers entry (API + static hosting)
shared/          Shared types and constants
scripts/         Browser regression and diagnostic scripts
client/public/manus-storage/   WASM, worklets, demo catalog
```

## Runtime assets

WebAssembly binaries and audio worklets live under `client/public/manus-storage/`. See `ASSET_REFERENCES.txt` for the full list. These are required for OPM/PCM/MDR MIDI extraction in the browser.

## License & attribution

- **This web adaptation** — Awed (c) 2026, MIT (see `package.json`)
- **Based on** MADRV MUSIC CONVERTER Version 1.10 (c) 1991–92 Konoa
- **OPM / PDX cores** — MXDRVg, X68Sound, portable_mdx (attribution preserved in-app)
- **GS synth** — SpessaSynth (bundled processor under `manus-storage/`)

Source policy: we do **not** redistribute original MADRV source code. Implementation follows published format behavior and our own TypeScript/WebAssembly integration. See `SOURCE_USE_POLICY.md`.

## Author

**YosAwed** — [GitHub](https://github.com/YosAwed)

Contact: yoshiharu.dewa@gmail.com
