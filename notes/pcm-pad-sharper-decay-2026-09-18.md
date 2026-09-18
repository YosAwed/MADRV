# Faster, darker PCM PAD decay and bold PAN

Branch: `codex/pcm-pad-sharper-decay`.

Held-note decay changes from 1,800 ms to 900 ms (same ease-out curve). Its final background changes from `#667634` to `#35451f`, foreground to `#d2dcc5`, and border to `#536735`, increasing contrast with the next bright key-on. Note-off remains 300 ms. PAN wave/arrow SVG stroke increases from 1.8 to 2.6. Dimensions, centered number box, breakpoints, playback engine and trigger detection are unchanged.

Validation: normal TypeScript check and Cloudflare build passed. The existing decay browser check now verifies the darker final color and that it is reached by the one-second observation. Generated fixtures only; no user music files used.

Chrome + WebKit decay checks passed for ordinary PCM and PCM8, including same-note retrigger, 300 ms release, and immediate stop. Chrome PAD regression passed for ordinary/PCM8/routed MDR, PAN, fixed digits, five-digit non-overlap across 20 layout combinations, mute/solo/seek, zero browser errors. Mobile screenshot visually inspected for bold PAN strokes.

Staging deployment: source `02fd80c225c8` (clean), Worker version `8d8ebe3a-c0f7-41b6-9e7b-3327f064df0a`. Public HTML, build-info, JS and CSS matched the staging build byte for byte. At this staging checkpoint, production was unchanged.


## Production release

Following explicit user approval, main was fast-forwarded to `be1df73` and pushed. Production build passed and Worker `madrv-player` was deployed as version `20870aba-599f-4b6d-9d7f-5b25b87bf16e` (previous version `b1168cfb-f733-44f5-a551-63b4a8166176`).

Public HTML, JS `index-Dl8gv8MN.js`, and CSS `index-Di_VW3rs.css` matched the local production build byte for byte. The generated-fixture Chrome check passed at the production URL for ordinary PCM and PCM8: dark held-note color by the one-second observation, same-note retrigger, 300 ms release, retained number and immediate stop. Browser errors: zero. No user music files used.
