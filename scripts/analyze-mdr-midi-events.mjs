import { readFile } from "node:fs/promises";
import createMadrvMidiModule from "/home/ubuntu/madrv-wasm/build/madrv-midi-events-v3.mjs";

const sourcePath = process.env.MDR_MIDI_SOURCE ?? "/home/ubuntu/upload/BOMB.MDR";
const sampleRate = Number(process.env.MDR_MIDI_SAMPLE_RATE ?? "48000");
const source = new Uint8Array(await readFile(sourcePath));
const wasmFile = await readFile("/home/ubuntu/madrv-wasm/build/madrv-midi-events-v3.wasm");
const wasmBinary = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength);
const module = await createMadrvMidiModule({ wasmBinary });
const sourcePointer = module._malloc(source.length);

try {
  module.HEAPU8.set(source, sourcePointer);
  const size = module._madrv_extract_midi(sourcePointer, source.length, 1, sampleRate);
  if (size <= 0) throw new Error(`MIDI extraction failed: ${size}`);
  const target = module._malloc(size);
  try {
    if (module._madrv_copy_midi(target, size) !== size) throw new Error("MIDI event copy failed");
    const bytes = module.HEAPU8.slice(target, target + size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(0, true);
    let offset = 4;
    const events = [];
    for (let index = 0; index < count; index += 1) {
      const microseconds = Number(view.getBigUint64(offset, true)); offset += 8;
      const sourceTrack = view.getUint32(offset, true); offset += 4;
      const length = view.getUint32(offset, true); offset += 4;
      const message = Array.from(bytes.slice(offset, offset + length)); offset += length;
      events.push({ seconds: microseconds / 1_000_000, sourceTrack, message });
    }
    const tracks = Object.entries(Object.groupBy(events, (event) => event.sourceTrack)).map(([sourceTrack, trackEvents]) => ({
      sourceTrack: Number(sourceTrack),
      count: trackEvents?.length ?? 0,
      firstSeconds: trackEvents?.[0]?.seconds ?? 0,
      lastSeconds: trackEvents?.at(-1)?.seconds ?? 0,
      preview: trackEvents?.slice(0, 8),
    }));
    const noteOns = events.filter((event) => (event.message[0] ?? 0) >= 0x90 && (event.message[0] ?? 0) <= 0x9f && (event.message[2] ?? 0) > 0);
    console.log(JSON.stringify({ sourcePath, sampleRate, eventCount: count, firstNoteOns: noteOns.slice(0, 48), tracks }, null, 2));
  } finally {
    module._free(target);
  }
} finally {
  module._free(sourcePointer);
}
