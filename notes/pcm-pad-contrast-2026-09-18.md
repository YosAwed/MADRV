# Larger, inverted PCM pad display

Increase the fixed-center PCM number/PAN readout from 12 px / weight 600 to 14 px / weight 700. While sounding, use the selected-button colors (solid #d8ff3e background and #11120f text), including a dark channel label. Keep M/S controls on their dark background so their selected state remains distinct from activity. Idle styling and fixed slots are retained. CSS-only change; no audio or telemetry changes.

Production build passed with the existing chunk-size warning. Existing `verify-pcm-pads.mjs` passed in Chromium and WebKit using generated fixtures: ordinary PCM, PCM8, routed MDR, fixed number positions, all 20 width/playlist/settings layouts (including 320 px), mute/solo, seek and stop. Mobile WebKit screenshot inspected; enlarged centered values and PAN fit inside the pads. No new unit tests for this styling change.

Development branch: `codex/pcm-pad-contrast`. Production remains unchanged pending release.
