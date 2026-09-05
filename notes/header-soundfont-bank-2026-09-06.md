# SoundFont bank at the top

Moved the existing SoundFont bank button and its file input into the top header. The picker stays available while the SoundFont/MIDI settings panel is folded. Destination selection, external MIDI help and remote SoundFont loading stay in that panel. Existing input handler, refs, bank name, persistence and missing-bank focus behavior are retained.

Desktop uses the existing 48px header; narrow screens put the bank on a second row. Long names truncate within the available width. Core desktop controls retain their first-screen positions.

Validation: TypeScript/build/whitespace checks, existing 30-track layout/playback script and desktop/touch tooltip script. Confirmed header placement at1366/390, visibility with output settings folded, file loading, missing-bank focus and playback controls. No browser errors. Public HTML/JS/CSS matched the build, and a native file-chooser upload through the top picker successfully loaded Roland_SC-55.sf2 while output settings stayed folded.

Production deployment: `98080dd3-2551-4226-808f-5b1462f25f91`, https://madrv-player.madrv-player-web.workers.dev/.
