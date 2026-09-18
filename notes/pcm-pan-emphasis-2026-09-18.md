# PCM PAN emphasis

Branch: `codex/pcm-pan-emphasis`.

PADs show inward arrows around the sample number and a pair of curved wave marks on the sounding side(s): `))>5<` left, `))>5<((` center, `>5<((` right. Muted/no-output/unknown PAN hides the marks as appropriate; note-off retains the last displayed number and PAN as before.

Inline SVG uses the existing foreground color, so the key-on and release fades apply to both number and marks. Side marks are absolutely positioned in the existing readout and scale to its available width. The fixed 5ch number box, font size, PAD dimensions, column breakpoints and M/S controls are unchanged. No playback code changed.

Validation: normal TypeScript check and Cloudflare build passed. Chrome and WebKit's existing generated-fixture PAD check passed, extended to verify left/center/right wave visibility and non-overlap with the maximum supported five-digit sample number at all 20 layout combinations (320/390/768/1366/1920 px, playlist and settings states). It also checks ordinary PCM, PCM8, routed MDR, fixed digit coordinates, fade, mute, solo and seek. Mobile and desktop screenshots visually inspected. Fixtures are generated; no user music uploaded.

Staging: source `c1b0e87c10da` (clean), Worker version `21bdaa21-a520-44fd-9228-b74048d2e08d`. Public HTML, build-info, JS and CSS matched the staging build byte for byte. Main/production remain on the prior PCM decay release.
