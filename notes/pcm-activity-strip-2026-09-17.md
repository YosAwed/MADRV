# PCM activity strip prototype

Replace the empty PCM area in track mode with a 30px-high activity strip: a current-state lamp, ON/MUTE indicator and four seconds of reported voice activity moving left (right edge is now). Reuse the existing voice mask and mute state; audio rendering and MIDI are unchanged. Engine mode retains its existing PCM pads.

The timestamped history preserves reported short pulses between 100ms paints and clips held voices at the four-second boundary. It shows activity, not amplitude, sample names or exact note-on events; events not represented in the engine's status reports cannot be reconstructed. Timers are local to mounted strips, are stopped when inactive/muted or unmounted, and do not repaint the whole page. Histories clear on stop, preparation/seek, source change, mute, tab visibility changes and long rendering stalls.

Validation: 219 tests in 19 files passed, including short pulse, sustained voice, gaps and reset history cases. Both TypeScript checks and production build passed (existing chunk-size warning). Generated original PCM8 MDX/PDX fixtures verified eight voices with actual renderer activity in Chromium and WebKit, mute/solo, seek clearing, stop clearing, live source replacement, and 20 combinations of viewport/playlist/settings state. All strips remain 30px tall, with no horizontal overflow. The existing 56-case ordinary-keyboard layout check passed in Chromium. Mobile and split-desktop screenshots were inspected. Physical phone testing remains for the user.

This is a development-branch prototype for staging; production is not changed.

Staging deployed source `72e4f91f328e` as Worker version `999701e1-95d0-451d-a6ae-825c39390d06`. Build metadata was clean and matched that revision. The synthetic PCM8 browser check passed at the public staging URL, including live file replacement after waiting for the asynchronous load to finish. Production still serves the previous desktop-keyboard-fix CSS (`index-TksT0Ud1.css`).
