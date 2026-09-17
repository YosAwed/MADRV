# Compact keyboard rows on narrow screens

The user reported excessive scrolling between keyboard strips on phones. Below the existing 1000px deck-container breakpoint, each track reserved a separate 38px controls row plus the keyboard, padding and gaps (90px total). General paragraph margins also added space to track/engine labels.

Keep the existing two-row label/keyboard arrangement, place mute/solo controls in the right column spanning both rows, and reduce row padding/gap. Remove paragraph margins on narrow track and engine labels. The keyboard remains 30px high and mute/solo targets remain 30 × 38px. Wide desktop rules and playback logic are unchanged. This trades 60px of keyboard width for approximately 30px less height per track.

Validation used an original generated eight-track MDX on a local production-build preview. Desktop Chromium and WebKit passed at widths 320, 390, 430, 768 and 1366px: no document horizontal overflow or page errors, mute and solo toggle on/off via touch. At widths up to 768px each track is 59.59px instead of 90px, saving approximately 243px over eight tracks. At 1366px, track height remains 46px and keyboard width remains 812px. Track and engine screenshots were inspected. This is browser viewport validation, not physical phone testing. Cloudflare build passed with the existing large-chunk warning.

## Production release

After the user's explicit deployment request, source commit `ecf31d8` was fast-forwarded into main and pushed. Production build passed and Cloudflare Worker `madrv-player` was deployed as version `5658ffc9-5035-459c-997f-3b8a676cf7d3` (previous version `74b0f58a-e8be-4515-b893-b7ab3f2619c8`). Public HTML, JS, CSS, player WASM and SoundFont worklet matched the local production build byte for byte. The generated-fixture check at the production URL passed all five viewport sizes, preserved mute/solo target sizes and touch toggles, and reported no page errors or horizontal overflow. No user music files were used.

## Follow-up: squeezed desktop keyboards

The user reported keyboards squeezed to the right on PC. Reproduced with a playlist beside the matrix: at 1366px viewport width, keyboards were only 183.25px wide. The responsive query measured the enclosing library (playlist plus matrix), so it selected a one-line layout even when the matrix itself was narrow. The earlier desktop check omitted the side-by-side playlist state; its desktop conclusion was incomplete.

Made the matrix panel its own named inline-size container and based its responsive layout on that panel. At the same desktop layout, keyboard width is now 599.25px. Phone rows remain 59.59px high with 280px keyboards at 390px viewport width. Added `scripts/verify-keyboard-panel-layout.mjs` to cover seven viewport widths, playlist presence, settings visibility and both matrix modes (56 cases per browser), checking usable keyboard width, containment, control overlap, button target size and touch toggles. Chromium and WebKit passed locally; build passed with the existing chunk-size warning. All fixtures are generated original MDX data.
