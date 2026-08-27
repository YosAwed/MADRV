import { readFile } from "node:fs/promises";
import createConverter from "/home/ubuntu/madrv-wasm/build/madrv-converter-v4.mjs";
import createPlayer from "/home/ubuntu/madrv-wasm/build/madrv-mdx-player-v12.mjs";
import createMidiEvents from "/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.mjs";

const sourcePath = process.env.MDR_SOURCE_PATH ?? "/home/ubuntu/upload/BOMB.MDR";
const source = new Uint8Array(await readFile(sourcePath));
const converterWasm = await readFile("/home/ubuntu/madrv-wasm/build/madrv-converter-v4.wasm");
const playerWasm = await readFile("/home/ubuntu/madrv-wasm/build/madrv-mdx-player-v12.wasm");
const midiWasm = await readFile("/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.wasm");
const converter = await createConverter({ wasmBinary: converterWasm });
const player = await createPlayer({ wasmBinary: playerWasm });
const midi = await createMidiEvents({ wasmBinary: midiWasm });

function copyTo(module, bytes) {
  const pointer = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

const converterSource = copyTo(converter, source);
let hardwareDurationSeconds;
let hardwareNoLoopDurationSeconds;
let hardwareTwoLoopDurationSeconds;
let playheadSamples = [];
try {
  const convertedSize = converter._madrv_convert_mdr(converterSource, source.byteLength);
  if (convertedSize <= 0) throw new Error("MDR conversion failed");
  const convertedPointer = converter._malloc(convertedSize);
  try {
    if (converter._madrv_copy_converted(convertedPointer, convertedSize) !== convertedSize) throw new Error("MDR conversion copy failed");
    const mdxPointer = copyTo(player, converter.HEAPU8.slice(convertedPointer, convertedPointer + convertedSize));
    try {
      if (player._mdx_player_init(48_000) !== 0 || player._mdx_player_load(mdxPointer, convertedSize, 0, 0) !== 0) throw new Error("MXDRV player initialization failed");
      hardwareNoLoopDurationSeconds = player._mdx_player_measure(0, 0) / 1000;
      hardwareDurationSeconds = player._mdx_player_measure(1, 0) / 1000;
      hardwareTwoLoopDurationSeconds = player._mdx_player_measure(2, 0) / 1000;
      player._mdx_player_play(0);
      const renderPointer = player._malloc(48_000 * 2 * 2);
      try {
        for (let second = 0; second <= 100; second += 1) {
          if (second > 0 && player._mdx_player_render(renderPointer, 48_000) < 0) throw new Error("MXDRV render failed");
          playheadSamples.push(player._mdx_player_get_play_at_ms());
        }
      } finally {
        player._free(renderPointer);
      }
    } finally {
      player._free(mdxPointer);
    }
  } finally {
    converter._free(convertedPointer);
  }
} finally {
  converter._free(converterSource);
}

const midiSource = copyTo(midi, source);
let finalMidiSeconds = 0;
let midiLoopStartSeconds = -1;
let midiLoopEndSeconds = -1;
let hasMidiSongLoop = false;
try {
    const size = midi._madrv_extract_midi(midiSource, source.byteLength, 1, 48_000);
    hasMidiSongLoop = midi._madrv_midi_has_song_loop() === 1;
    midiLoopStartSeconds = midi._madrv_midi_loop_start_seconds();
    midiLoopEndSeconds = midi._madrv_midi_loop_end_seconds();
  const pointer = midi._malloc(size);
  try {
    if (midi._madrv_copy_midi(pointer, size) !== size) throw new Error("MIDI event copy failed");
    const bytes = midi.HEAPU8.slice(pointer, pointer + size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(0, true);
    let offset = 4;
    for (let index = 0; index < count; index += 1) {
      finalMidiSeconds = Math.max(finalMidiSeconds, Number(view.getBigUint64(offset, true)) / 1_000_000);
      offset += 8;
      offset += 4;
      const messageLength = view.getUint32(offset, true);
      offset += 4 + messageLength;
    }
  } finally {
    midi._free(pointer);
  }
} finally {
  midi._free(midiSource);
}

const playheadDrops = playheadSamples.flatMap((value, index) => index > 0 && value < playheadSamples[index - 1] ? [{ second: index, before: playheadSamples[index - 1], after: value }] : []);
console.log(JSON.stringify({ sourcePath, hardwareNoLoopDurationSeconds, hardwareDurationSeconds, hardwareTwoLoopDurationSeconds, hardwareLoopCycleSeconds: hardwareTwoLoopDurationSeconds - hardwareDurationSeconds, finalMidiSeconds, midiTailSeconds: finalMidiSeconds - hardwareDurationSeconds, hasMidiSongLoop, midiLoopStartSeconds, midiLoopEndSeconds, midiLoopCycleSeconds: midiLoopEndSeconds - midiLoopStartSeconds, playheadSamples, playheadDrops }));
