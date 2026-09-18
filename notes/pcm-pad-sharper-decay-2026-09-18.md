# Faster, darker PCM PAD decay and bold PAN

Branch: `codex/pcm-pad-sharper-decay`.

Held-note decay changes from 1,800 ms to 900 ms (same ease-out curve). Its final background changes from `#667634` to `#35451f`, foreground to `#d2dcc5`, and border to `#536735`, increasing contrast with the next bright key-on. Note-off remains 300 ms. PAN wave/arrow SVG stroke increases from 1.8 to 2.6. Dimensions, centered number box, breakpoints, playback engine and trigger detection are unchanged.

Validation: normal TypeScript check and Cloudflare build passed. The existing decay browser check now verifies the darker final color and that it is reached by the one-second observation. Generated fixtures only; no user music files used.

Chrome + WebKit decay checks passed for ordinary PCM and PCM8, including same-note retrigger, 300 ms release, and immediate stop. Chrome PAD regression passed for ordinary/PCM8/routed MDR, PAN, fixed digits, five-digit non-overlap across 20 layout combinations, mute/solo/seek, zero browser errors. Mobile screenshot visually inspected for bold PAN strokes.
