import { readFile } from "node:fs/promises";
import createMidiEvents from "/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.mjs";

const sourcePath = process.env.MDR_MIDI_SOURCE ?? "/home/ubuntu/upload/BOMB.MDR";
const sampleRate = Number(process.env.MDR_MIDI_SAMPLE_RATE ?? "48000");
const source = new Uint8Array(await readFile(sourcePath));
const wasmBinary = await readFile("/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.wasm");
const module = await createMidiEvents({ wasmBinary });
const pointer = module._malloc(source.byteLength);
module.HEAPU8.set(source, pointer);

try {
  const size = module._madrv_extract_midi(pointer, source.byteLength, 1, sampleRate);
  if (size <= 0) throw new Error(`MDR MIDI extraction failed: ${size}`);
  const target = module._malloc(size);
  try {
    if (module._madrv_copy_midi(target, size) !== size) throw new Error("MDR MIDI event copy failed.");
    const bytes = module.HEAPU8.slice(target, target + size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eventCount = view.getUint32(0, true);
    let offset = 4;
    let gsResetCount = 0;
    let lastEventSeconds = 0;
    const gsReset = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
    for (let index = 0; index < eventCount; index += 1) {
      const microseconds = Number(view.getBigUint64(offset, true)); offset += 8;
      offset += 4;
      const length = view.getUint32(offset, true); offset += 4;
      const message = Array.from(bytes.slice(offset, offset + length)); offset += length;
      lastEventSeconds = Math.max(lastEventSeconds, microseconds / 1_000_000);
      if (message.length === gsReset.length && message.every((value, messageIndex) => value === gsReset[messageIndex])) gsResetCount += 1;
    }
    const hasSongLoop = module._madrv_midi_has_song_loop() === 1;
    const loopWindow = hasSongLoop ? {
      startSeconds: module._madrv_midi_loop_start_seconds(),
      endSeconds: module._madrv_midi_loop_end_seconds(),
    } : null;
    console.log(JSON.stringify({ sourcePath, sampleRate, eventCount, lastEventSeconds, loopWindow, gsResetCount }));
  } finally {
    module._free(target);
  }
} finally {
  module._free(pointer);
}
