import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import converterFactory from "../client/public/manus-storage/madrv-converter-v4_28935c58.mjs";
import playerFactory from "../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";
const dir = process.argv[2],
  names = await readdir(dir);
const converter = await converterFactory({
  wasmBinary: await readFile(
    new URL(
      "../client/public/manus-storage/madrv-converter-v4_f7f66741.wasm",
      import.meta.url
    )
  ),
});
const player = await playerFactory({
  wasmBinary: await readFile(
    new URL(
      "../client/public/manus-storage/madrv-mdx-player-v12_2d6b7625.wasm",
      import.meta.url
    )
  ),
});
const loops = JSON.parse(
  await readFile("/tmp/madrv-library-loops.json", "utf8")
);
const results = [];
for (const song of loops.filter(s => s.hasLoop)) {
  const pdxName = names.find(n => n.toLowerCase() === song.pdx.toLowerCase());
  if (song.pdx && !pdxName) continue;
  const source = await readFile(path.join(dir, song.name));
  const ptr = converter._malloc(source.length);
  converter.HEAPU8.set(source, ptr);
  let result = { name: song.name, midiPeriod: song.period };
  try {
    const size = converter._madrv_convert_mdr(ptr, source.length);
    if (size <= 0) throw new Error("converter failed");
    const converted = converter._malloc(size);
    converter._madrv_copy_converted(converted, size);
    const data = converter.HEAPU8.slice(converted, converted + size);
    converter._free(converted);
    player._mdx_player_init(48000);
    const p = player._malloc(size);
    player.HEAPU8.set(data, p);
    const pdx = pdxName
      ? await readFile(path.join(dir, pdxName))
      : new Uint8Array();
    const pp = pdx.length ? player._malloc(pdx.length) : 0;
    if (pp) player.HEAPU8.set(pdx, pp);
    try {
      if (player._mdx_player_load(p, size, pp, pdx.length) !== 0)
        throw new Error("load failed");
      result.onePass = player._mdx_player_measure(1, 0) / 1000;
      result.twoPass = player._mdx_player_measure(2, 0) / 1000;
      result.hardwarePeriod = result.twoPass - result.onePass;
      result.periodDeltaMs = (result.hardwarePeriod - song.period) * 1000;
      if (song.name === "BOMB.MDR") {
        const output = player._malloc(4096 * 4);
        const peak = () => {
          let peak = 0;
          for (let block = 0; block < 48; block++) {
            player._mdx_player_render(output, 4096);
            for (const v of player.HEAP16.subarray(
              output >> 1,
              (output >> 1) + 8192
            ))
              peak = Math.max(peak, Math.abs(v));
          }
          return peak;
        };
        player._mdx_player_play(0);
        player._mdx_player_measure(2, 0);
        result.peakAfterLateMeasure = peak();
        player._mdx_player_play(0);
        result.peakAfterRestart = peak();
        player._free(output);
      }
    } finally {
      player._free(p);
      if (pp) player._free(pp);
    }
  } catch (e) {
    result.error = String(e);
  } finally {
    converter._free(ptr);
  }
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  "/tmp/madrv-hardware-loops.json",
  JSON.stringify(results, null, 2)
);
