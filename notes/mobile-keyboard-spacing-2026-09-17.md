# Compact keyboard rows on narrow screens

The user reported excessive scrolling between keyboard strips on phones. Below the existing 1000px deck-container breakpoint, each track reserved a separate 38px controls row plus the keyboard, padding and gaps (90px total). General paragraph margins also added space to track/engine labels.

Keep the existing two-row label/keyboard arrangement, place mute/solo controls in the right column spanning both rows, and reduce row padding/gap. Remove paragraph margins on narrow track and engine labels. The keyboard remains 30px high and mute/solo targets remain 30 × 38px. Wide desktop rules and playback logic are unchanged. This trades 60px of keyboard width for approximately 30px less height per track.

Validation used an original generated eight-track MDX on a local production-build preview. Desktop Chromium and WebKit passed at widths 320, 390, 430, 768 and 1366px: no document horizontal overflow or page errors, mute and solo toggle on/off via touch. At widths up to 768px each track is 59.59px instead of 90px, saving approximately 243px over eight tracks. At 1366px, track height remains 46px and keyboard width remains 812px. Track and engine screenshots were inspected. This is browser viewport validation, not physical phone testing. Cloudflare build passed with the existing large-chunk warning.
