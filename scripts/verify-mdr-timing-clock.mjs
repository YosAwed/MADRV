import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import createConverter from "../client/public/manus-storage/madrv-converter-v4_28935c58.mjs";
import createPlayer from "../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";
import createMidi from "../client/public/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs";

// Direct-WASM clock regression; no browser, device, external service or copied user fixtures.
// The supplied score must have the same note-on sequence in the selected OPM and MIDI tracks.
// Defaults match PRIN_GS: OPM A (0), MIDI a (16), displayed OPM notes one octave below MIDI.
const sourcePath = process.env.MDR_CLOCK_SOURCE;
if (!sourcePath) throw new Error("Set MDR_CLOCK_SOURCE to a matching OPM/MIDI score such as PRIN_GS.MDR.");
const pdxPath = process.env.MDR_CLOCK_PDX;
const seconds = Number(process.env.MDR_CLOCK_SECONDS ?? 600);
const hardwareTrack = Number(process.env.MDR_CLOCK_OPM_TRACK ?? 0);
const midiTrack = Number(process.env.MDR_CLOCK_MIDI_TRACK ?? 16);
const octaveCorrection = Number(process.env.MDR_CLOCK_NOTE_OFFSET ?? 12);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error("MDR_CLOCK_SECONDS must be within 0–3600 seconds.");
if (!Number.isInteger(hardwareTrack) || hardwareTrack < 0 || hardwareTrack > 7
  || !Number.isInteger(midiTrack) || midiTrack < 0 || midiTrack > 31
  || !Number.isInteger(octaveCorrection) || Math.abs(octaveCorrection) > 127) throw new Error("Invalid track selection or note offset.");
const publicAsset = name => new URL(`../client/public/manus-storage/${name}`, import.meta.url);
const converter = await createConverter({ wasmBinary: await readFile(publicAsset("madrv-converter-v4_f7f66741.wasm")) });
const player = await createPlayer({ wasmBinary: await readFile(publicAsset("madrv-mdx-player-v12_2d6b7625.wasm")) });
const midi = await createMidi({ wasmBinary: await readFile(publicAsset("madrv-midi-events-v4_2facde2d.wasm")) });
const source = await readFile(sourcePath);
const pdx = pdxPath ? await readFile(pdxPath) : new Uint8Array();
const copy = (module, bytes) => {
  const pointer = module._malloc(bytes.length);
  module.HEAPU8.set(bytes, pointer);
  return pointer;
};

const converterSource = copy(converter, source);
const convertedSize = converter._madrv_convert_mdr(converterSource, source.length);
converter._free(converterSource);
if (convertedSize <= 0) throw new Error("MDR to MDX conversion failed.");
const converted = converter._malloc(convertedSize);
if (converter._madrv_copy_converted(converted, convertedSize) !== convertedSize) throw new Error("Converted MDX copy failed.");
const mdxPointer = copy(player, converter.HEAPU8.slice(converted, converted + convertedSize));
converter._free(converted);
const pdxPointer = pdx.length ? copy(player, pdx) : 0;
if (player._mdx_player_init(48_000) !== 0 || player._mdx_player_load(mdxPointer, convertedSize, pdxPointer, pdx.length) !== 0) throw new Error("OPM player load failed.");
player._free(mdxPointer);
if (pdxPointer) player._free(pdxPointer);
const onePass = player._mdx_player_measure(1, 0) / 1000;
player._mdx_player_play(0);
const renderFrames = 128;
const renderPointer = player._malloc(renderFrames * 4);
const hardwareNotes = [];
let previousNote = null;
const renderStartedAt = performance.now();
try {
  for (let block = 0; block < Math.ceil(seconds * 48_000 / renderFrames); block += 1) {
    if (player._mdx_player_render(renderPointer, renderFrames) < 0) throw new Error("OPM render failed.");
    const rawNote = player._mdx_player_get_hardware_track_note_raw(hardwareTrack);
    const note = rawNote < 0 ? null : Math.floor(rawNote / 64) + 3 + octaveCorrection;
    if (note !== previousNote) {
      if (note !== null) hardwareNotes.push({ at: (block + 1) * renderFrames / 48_000, note });
      previousNote = note;
    }
  }
} finally { player._free(renderPointer); }
const renderCostMs = performance.now() - renderStartedAt;
if (!hardwareNotes.length) throw new Error("No OPM notes in selected track.");

const extract = timingRate => {
  const sourcePointer = copy(midi, source);
  const startedAt = performance.now();
  const size = midi._madrv_extract_midi(sourcePointer, source.length, 1, timingRate);
  const extractionCostMs = performance.now() - startedAt;
  midi._free(sourcePointer);
  if (size <= 0) throw new Error("MIDI extraction failed.");
  const target = midi._malloc(size);
  if (midi._madrv_copy_midi(target, size) !== size) throw new Error("MIDI copy failed.");
  const bytes = midi.HEAPU8.slice(target, target + size);
  midi._free(target);
  const view = new DataView(bytes.buffer);
  const eventCount = view.getUint32(0, true);
  const contentHash = createHash("sha256");
  const notes = [];
  let offset = 4;
  let finalEventAt = 0;
  for (let index = 0; index < eventCount; index += 1) {
    finalEventAt = Number(view.getBigUint64(offset, true)) / 1_000_000;
    offset += 8;
    const track = view.getUint32(offset, true);
    contentHash.update(bytes.subarray(offset, offset + 8)); // Source track and length, excluding timestamp.
    offset += 4;
    const messageLength = view.getUint32(offset, true);
    offset += 4;
    const message = bytes.subarray(offset, offset + messageLength);
    offset += messageLength;
    contentHash.update(message);
    if (track === midiTrack && (message[0] & 0xf0) === 0x90 && message[2] > 0) notes.push({ at: finalEventAt, note: message[1] });
  }
  const loopStart = midi._madrv_midi_loop_start_seconds();
  const loopEnd = midi._madrv_midi_loop_end_seconds();
  const hasLoop = midi._madrv_midi_has_song_loop() === 1 && loopStart >= 0 && loopEnd > loopStart;
  const period = hasLoop ? loopEnd - loopStart : undefined;
  const expanded = hasLoop ? notes.filter(note => note.at < loopEnd) : [...notes];
  if (hasLoop) {
    if (period < 0.1) throw new Error("Loop too short for this sequence-comparison diagnostic.");
    const loopNotes = notes.filter(note => note.at >= loopStart && note.at < loopEnd);
    for (let cycle = 1; loopEnd + (cycle - 1) * period < seconds; cycle += 1) {
      for (const note of loopNotes) expanded.push({ ...note, at: note.at + cycle * period });
    }
  }
  return { timingRate, extractionCostMs, eventCount, eventContentHash: contentHash.digest("hex"), finalEventAt, loopStart, loopEnd, period, expanded };
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const runs = [48_000, 125_000].map(timingRate => {
  const { expanded, ...extraction } = extract(timingRate);
  const pairs = [];
  const mismatches = [];
  for (let index = 0; index < Math.min(hardwareNotes.length, expanded.length); index += 1) {
    const hardware = hardwareNotes[index];
    const event = expanded[index];
    if (hardware.note !== event.note) mismatches.push({ index, hardware, event });
    else pairs.push({ index, scoreSeconds: event.at, hardwareSeconds: hardware.at, differenceMs: (hardware.at - event.at) * 1000 });
  }
  const buckets = Array.from({ length: Math.ceil(seconds / 60) }, (_, minute) => {
    const values = pairs.filter(pair => pair.scoreSeconds >= minute * 60 && pair.scoreSeconds < (minute + 1) * 60).map(pair => pair.differenceMs);
    return { minute, count: values.length, meanMs: mean(values), minMs: values.length ? Math.min(...values) : null, maxMs: values.length ? Math.max(...values) : null };
  });
  const values = pairs.map(pair => pair.differenceMs);
  const xMean = mean(pairs.map(pair => pair.scoreSeconds)) ?? 0;
  const yMean = mean(values) ?? 0;
  const denominator = pairs.reduce((sum, pair) => sum + (pair.scoreSeconds - xMean) ** 2, 0);
  const slopeMsPerMinute = denominator ? pairs.reduce((sum, pair) => sum + (pair.scoreSeconds - xMean) * (pair.differenceMs - yMean), 0) / denominator * 60 : null;
  return { ...extraction, matchedNotes: pairs.length, hardwareNotes: hardwareNotes.length, midiNotes: expanded.length,
    mismatches: mismatches.length, firstMismatches: mismatches.slice(0, 3), first: pairs.slice(0, 3), last: pairs.slice(-3),
    differenceRangeMs: values.length ? Math.max(...values) - Math.min(...values) : null, slopeMsPerMinute, buckets };
});
console.log(JSON.stringify({ sourcePath, seconds, nativeSampleRate: 48_000, probeFrames: renderFrames, hardwareTrack, midiTrack,
  noteOffsetForMatchingOnly: octaveCorrection, onePassSeconds: onePass, renderCostMs, runs,
  note: "OPM raw key-state transitions sampled by rendered frame index; not a SoundFont audio-onset or browser scheduling measurement." }));
if (runs.some(run => run.mismatches || run.matchedNotes !== hardwareNotes.length)) throw new Error("Selected tracks are not a complete matching melody; timing conclusions are invalid.");
if (runs[0].eventContentHash !== runs[1].eventContentHash || runs[0].eventCount !== runs[1].eventCount) throw new Error("Changing the timing resolution altered MIDI content/order.");
if (runs[1].differenceRangeMs > renderFrames / 48_000 * 1000 + 0.01) throw new Error("Precise MIDI timestamps still drift beyond one probe block.");
