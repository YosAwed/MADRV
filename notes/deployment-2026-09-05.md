# Production deployment — 2026-09-05

The user explicitly requested deployment after the loop validation. Deployment succeeded at https://madrv-player.madrv-player-web.workers.dev.

- Worker: madrv-player
- Version: 849d7809-56a2-4244-91cd-e0c1c852d1d1
- Deployed the previously built and validated assets, including startup optimizations and three infinite-loop fixes.
- index.html, main JS (index-CUIvqtET.js), and the lazy guide chunk returned HTTP 200 and matched local build bytes exactly.
- Chrome tested the actual public URL: guide opening, local Roland_SC-55.sf2 + BOMB.MDR, infinite-loop toggle, nonzero OPM PCM output (8192 frames, peak 0.054931640625), and stop. No uncaught page errors.
- Full 15-song/two-boundary coverage was performed locally before deployment; this production smoke test did not repeat that full run.

This supersedes earlier notes stating deployment had not been performed after the earlier approval rejection.
