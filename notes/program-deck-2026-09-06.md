# Program Deck and first-screen controls

Track matrix now belongs to the Program Deck section with playback controls and track activity. It is open by default and remains present before a source is loaded. The existing panel ID, keyboard-mode preference, mute/solo handlers and saved explicit open/closed choices are preserved.

On wide desktops, Program Deck gets the central wide column. Source, playlist, sharing and export sit to its left; SoundFont/MIDI selection, bus levels and advanced controls sit to its right. Playlist, sharing and export also default open. Source tabs use shorter visual labels while keeping their accessible names. Track rows scroll inside the matrix while its toolbar stays outside the scrolling list; the transport is the only sticky element. Narrow layouts use two or one columns.

Side-panel layout fixes keep playlist titles, copy-link controls, export duration and diagnostic help buttons usable at narrow widths. Detailed explanations remain in tooltips. Audio engine code is unchanged, and JSX handler/ref comparisons confirmed none were lost during the move.

Validation:

- TypeScript and Cloudflare checks; 99 existing unit tests passed; Cloudflare build and whitespace check passed.
- Real Chrome playback of MJ_RUMI_SC.MDR with matching PDX and Roland_SC-55.sf2 (30 tracks). Verified first-screen source, play/loop/master, SoundFont/output levels, playlist, matrix, sharing and export controls; first-track mute/solo and last-track reachability; folding while playing; saved panel and matrix-mode state; source reload and playlist add.
- Default loaded views fit 1366×768, 1440×900 and 1920×1080 without document scrolling. No horizontal document overflow at 960×740 or 390×844; smaller screens use vertical scrolling. Track keyboard strips preserve their own horizontal scrolling on narrow screens.
- Desktop and touch tooltip checks passed, including focus/hover/tap/dismissal, stable layout, notices and 18 help controls. Expanded diagnostic information was checked for overlapping controls.

Deployment: Cloudflare Worker `madrv-player`, version `a32389da-4ec0-4cff-852a-7a42d850f132`, https://madrv-player.madrv-player-web.workers.dev/. Main asset `index-WkS9ojrq.js`, stylesheet `index-Bz8hLSUw.css`. Public HTML, JS, CSS and lazy guide returned HTTP 200 and matched the build byte-for-byte. Both full layout/playback and tooltip interaction scripts passed again on production, with no browser errors.
