import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";
import createMidiEvents from "../client/public/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Pass MDR files to inspect.");
const code = await transform(await readFile(new URL("../client/src/lib/mdrTrackLoops.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { extendMdrTrackLoops } = await import(`data:text/javascript;base64,${Buffer.from(code.code).toString("base64")}`);
const module = await createMidiEvents({ wasmBinary: await readFile(new URL("../client/public/manus-storage/madrv-midi-events-v4_2facde2d.wasm", import.meta.url)) });
function extract(source, loops) {
  const pointer = module._malloc(source.length);
  module.HEAPU8.set(source, pointer);
  try {
    const size = module._madrv_extract_midi(pointer, source.length, loops, 125000);
    assert.ok(size > 0);
    const target = module._malloc(size);
    try {
      assert.equal(module._madrv_copy_midi(target, size), size);
      const view = new DataView(module.HEAPU8.buffer, target, size);
      const events = [];
      for (let index = 0, offset = 4; index < view.getUint32(0, true); index++) {
        const at = Number(view.getBigUint64(offset, true)) / 1e6;
        const sourceTrack = view.getUint32(offset + 8, true);
        const length = view.getUint32(offset + 12, true);
        events.push({ at, sourceTrack, bytes: [...module.HEAPU8.subarray(target + offset + 16, target + offset + 16 + length)] });
        offset += 16 + length;
      }
      return { events, end: Math.max(module._madrv_midi_loop_end_seconds(), ...events.map(event => event.at), 0) };
    } finally { module._free(target); }
  } finally { module._free(pointer); }
}
const results = [];
for (const path of paths) {
  const source = await readFile(path);
  const two = extract(source, 2);
  const three = extract(source, 3);
  const four = extract(source, 4);
  const cases = [];
  for (const [loops, raw] of [[2, two], [3, three], [4, four]]) {
    const fixed = extendMdrTrackLoops(raw.events, two.events, three.events, raw.end);
    const changed = [];
    for (const track of new Set(raw.events.map(event => event.sourceTrack))) {
      const original = raw.events.filter(event => event.sourceTrack === track);
      const repaired = fixed.filter(event => event.sourceTrack === track);
      assert.deepEqual(repaired.slice(0, original.length), original, "Existing intro and notes must be preserved");
      assert.ok(repaired.every(event => event.at <= raw.end));
      if (repaired.length > original.length) changed.push({ track, before: original.at(-1)?.at, after: repaired.at(-1)?.at, added: repaired.length - original.length });
    }
    cases.push({ loops, songEnd: raw.end, changed });
  }
  results.push({ path, cases });
}
const out = process.env.TRACK_LOOP_REPORT ?? "/tmp/madrv-track-loop-report.json";
await writeFile(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ files: results.length, changedFiles: results.filter(result => result.cases.some(value => value.changed.length)).map(result => result.path), report: out }));
