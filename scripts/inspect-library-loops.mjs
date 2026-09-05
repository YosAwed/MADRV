import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import createMidiEvents from "../client/public/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs";
const dir = process.argv[2];
const module = await createMidiEvents({
  wasmBinary: await readFile(
    new URL(
      "../client/public/manus-storage/madrv-midi-events-v4_2facde2d.wasm",
      import.meta.url
    )
  ),
});
const results = [];
for (const name of (await readdir(dir)).filter(n => /\.mdr$/i.test(n)).sort()) {
  const source = await readFile(path.join(dir, name));
  const start = source.indexOf(Buffer.from([13, 10, 26])) + 3;
  const pdx = source.subarray(start, source.indexOf(0, start)).toString();
  const ptr = module._malloc(source.length);
  module.HEAPU8.set(source, ptr);
  try {
    const size = module._madrv_extract_midi(ptr, source.length, 1, 48000);
    const hasLoop = module._madrv_midi_has_song_loop() === 1;
    const loopStart = module._madrv_midi_loop_start_seconds(),
      loopEnd = module._madrv_midi_loop_end_seconds();
    const result = {
      name,
      pdx,
      hasLoop,
      loopStart,
      loopEnd,
      period: loopEnd - loopStart,
      size,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    module._free(ptr);
  }
}
await writeFile(
  "/tmp/madrv-library-loops.json",
  JSON.stringify(results, null, 2)
);
