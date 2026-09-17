# Larger, inverted PCM pads with release fade

Increase the fixed-center PCM number/PAN readout from 12 px / weight 600 to 14 px / weight 700. While sounding, use the selected-button colors (solid #d8ff3e background and #11120f text), including a dark channel label. Keep M/S controls on their dark background so their selected state remains distinct from activity. Fixed slots are retained; no audio or telemetry changes.

At the user's follow-up request, retain the last visible number/PAN during rests and use a 300 ms CSS ease-out transition for background/text/border colors. A new hit lights immediately. Mute and stop bypass the transition and clear the retained readout; source changes and seek preparation also invalidate it. A small local readout state caches actual displayed hits; there are no JS animation timers or continuous frame loops. At most eight small pad surfaces transition only after note-off.

Production build passed with the existing chunk-size warning. Existing `verify-pcm-pads.mjs` passed in Chromium and WebKit using generated fixtures: ordinary PCM, PCM8, routed MDR, fixed number positions, all 20 width/playlist/settings layouts (including 320 px), mute/solo, seek and stop. Mobile WebKit screenshot inspected; enlarged centered values and PAN fit inside the pads. No new unit tests for this styling change.

The browser check also measures the release: the prior sample number remains at onset, 100 ms and 350 ms after note-off; the background passes through an intermediate color and reaches the idle color. Both Chromium and WebKit passed after the fade addition; both TypeScript checks and the build passed.

Development branch: `codex/pcm-pad-contrast`. Production remains unchanged pending release.
