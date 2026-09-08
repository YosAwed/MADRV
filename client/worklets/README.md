# MADRV SoundFont worklet adapter

This adds a small, app-owned, cancellable queue around the existing SoundFont
renderer. It does not change the third-party minified processor or its private
queue, nor does it instantiate a second OPM/PCM renderer.

## Build and upstream pin

Run `pnpm build:soundfont-worklet` (also run before the application build/dev).
`scripts/build-madrv-soundfont-worklet.mjs` resolves the original TypeScript
worklet sources from the source map distributed with `spessasynth_lib 4.3.14`,
then bundles the maintained adapter with the installed `spessasynth_core 4.3.20`.
It requires the exact source-map SHA-256
`7ec50da7d39f360f49526483c20798915b420ed826711083f5638b5d8782064a` and fails closed
when versions or sources change. An upstream upgrade requires reviewing the
adapter/protocol tests before updating this pin. Only runtime modules from that
map are used; no source files are downloaded during the build.

The output is `client/public/manus-storage/madrv-spessasynth-processor.js`.
Both upstream projects use Apache-2.0; their license and project attribution are
included in the output banner. The source-map modules are kept unchanged and the
app adapter is separately maintained in this directory.

## Creation and handshake

1. Load the generated module with `context.audioWorklet.addModule(...)`.
2. Construct `WorkletSynthesizer` using `audioNodeCreators.worklet` to create an
   `AudioWorkletNode` named `madrv-spessasynth-worklet`, forwarding the original
   context and node options. Capture the node/port in that callback.
3. Await the stock synthesizer's `isReady`, then add the sound bank normally.
4. Use the captured port for the app messages below. Add timing listeners with
   `port.addEventListener("message", ...)` (and `start()`); do not replace the
   synthesizer's `port.onmessage`. The stock readiness, bank and control-message
   protocol is unchanged.

## App protocol

- `{ type: "madrv-reset", generation }`: atomically discard all pending app MIDI
  and stop active voices. Clear counters/ownership, retain transport mute state.
  Older resets are ignored. Send this before each new generation's MIDI, even
  if the next song starts immediately.
- `{ type: "madrv-midi", generation, sourceTrack, bytes, targetAt }`: schedule raw
  MIDI bytes at an absolute AudioContext time. Wrong-generation messages are
  ignored. Equal deadlines keep arrival order. The synth receives due events
  with `time: 0`, so its uncancellable private future queue is never used for
  these events.
- `{ type: "madrv-mute", generation, tracks }`: discard pending note messages
  for muted tracks, retain controllers/program changes, suppress future note-ons
  while muted, and send targeted note-offs for notes owned by newly muted tracks.
  Other tracks are not globally stopped. Unmute does not replay cancelled notes.

Ownership uses actual applied MIDI channel/key pairs, not an assumed fixed
track-to-channel mapping. When two tracks share the same channel/key, muting one
does not release the other's note. MIDI cannot give independent control of those
shared voices. Targeted note-offs also follow the instrument's release envelope
and sustain state; this adapter does not globally release a sustain pedal or
terminate other tracks' voices to force a hard mute.

## Timing metrics

The scheduler uses AudioWorklet `currentTime` at each output render quantum,
not main-thread timer arrival as a new musical deadline. Application is quantized
to one render block (normally 128 frames), not claimed to be sample-accurate.
At most four `madrv-midi-timing` messages per second are posted, even across resets:

- `generation`, `appliedCount`, `pendingCount`.
- `lastTargetAt` / `lastAppliedAt`: absolute times for the last applied MIDI event,
  or `null` before one has been applied. These are scheduler application times,
  **not acoustic SoundFont sample attack times**.
- `maxLateSeconds`: largest applied-minus-target difference (includes ordinary
  render-block quantization); `lateCount`: applications over one render quantum
  late, with a 1 microsecond floating-point allowance.
- `receivedLateCount` / `maxReceiptLateSeconds`: events already overdue upon
  reaching the audio thread, before render-block application.

The adapter does not time-stretch songs or shift subsequent deadlines to hide a
late event. Invalid custom messages are ignored and cannot reach the stock
processor's private scheduling path.
