# Compact contextual help

The source hero “音源をデッキへ送る。” remains absent. Detailed instructions for source selection, MML, remote URLs/catalogs, playlists/history, SoundFont loading, timing compensation, playback recommendations, sharing, diagnostics, SysEx and export are now available through adjacent info buttons. They are hidden by default, including when their sections are expanded. Essential values, file names, playback state, errors and attribution remain visible.

HelpTooltip uses the existing Radix tooltip component. Hover, keyboard focus, Enter and touch/click open the explanation; Escape, blur and outside interaction close it. Portal positioning avoids shifting the layout and keeps text within the viewport. The source drop area is shorter and the SoundFont picker remains flexible beside its help button. No audio engine or playback handler changed.

Validation:

- `pnpm check`, `pnpm check:cloudflare`, `pnpm test` (99 passing), `pnpm build:cloudflare`, `git diff --check`.
- `verify-help-tooltips.mjs`: desktop Chrome and a 390×844 touch-enabled Chrome context; helpers hidden initially, hover/focus/Enter/tap and dismissal, no file picker activation or parent collapse, stable panel bounds, bounded tooltip content, required-input notice still visible, and all 17 available help controls open successfully.
- `verify-compact-layout.mjs`: MJ_RUMI_SC.MDR + matching PDX + Roland_SC-55.sf2, 30 tracks; actual OPM/PCM and built-in MIDI playback, folding during playback, state persistence, missing-bank reveal, playlist/source controls and guide. No horizontal overflow at 390/960/1366/1440/1920 widths; default loaded view fits 1366×768. No browser errors.
- Updated hybrid performance verification to read the advisor reason from its tooltip. SoundFont/external destination switching, light-to-dense playlist transition (16384-frame automatic buffer), and manual low-latency selection (2048) passed. This short regression run is not a Windows performance benchmark.

Deployment: Cloudflare Worker `madrv-player`, version `43567eef-a091-433d-b97b-dbaf4826e73f`. Main asset `index-BaQN5BtL.js`, stylesheet `index-BEKR3dMV.css`. Public URL: https://madrv-player.madrv-player-web.workers.dev/.

Post-deployment verification: public HTML, main JS, CSS and lazy guide returned HTTP 200 and matched the local build byte-for-byte. The full tooltip interaction check passed on the production URL for desktop and touch contexts without browser errors.
