import { readFile, writeFile } from "node:fs/promises";
import createMidiEvents from "../client/public/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs";
const module = await createMidiEvents({
  wasmBinary: await readFile(
    new URL(
      "../client/public/manus-storage/madrv-midi-events-v4_2facde2d.wasm",
      import.meta.url
    )
  ),
});
const source = await readFile(process.argv[2]);
const p = module._malloc(source.length);
module.HEAPU8.set(source, p);
const size = module._madrv_extract_midi(p, source.length, 1, 48000);
const t = module._malloc(size);
module._madrv_copy_midi(t, size);
const b = module.HEAPU8.slice(t, t + size),
  v = new DataView(b.buffer);
const events = [];
let offset = 4;
for (let i = 0; i < v.getUint32(0, true); i++) {
  const at = Number(v.getBigUint64(offset, true)) / 1e6;
  offset += 8;
  const track = v.getUint32(offset, true);
  offset += 4;
  const n = v.getUint32(offset, true);
  offset += 4;
  const bytes = Array.from(b.subarray(offset, offset + n));
  offset += n;
  events.push({ at, track, bytes });
}
module._free(p);
module._free(t);
await writeFile(
  "/tmp/madrv-portamento-events.json",
  JSON.stringify(events, null, 2)
);
let bend = 8192;
for (const e of events.filter(e => (e.bytes[0] & 15) === 0)) {
  if ((e.bytes[0] & 240) === 224) bend = e.bytes[1] + e.bytes[2] * 128;
  if (
    (e.bytes[0] & 240) === 144 ||
    ((e.bytes[0] & 240) === 224 && bend === 8192)
  )
    console.log(JSON.stringify({ ...e, bend }));
}
